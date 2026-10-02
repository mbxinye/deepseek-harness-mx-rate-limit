/**
 * Token-bucket request limiting for DeepSeek Harness model calls.
 *
 * The plugin intercepts `llm/stream`, the waterfall every model call passes
 * through, and admits requests through a per-route FIFO gate in front of a token
 * bucket. Queuing is the point: a request that waits is one the provider never
 * sees, so the limiter prevents the 429 instead of reacting to it.
 *
 * It is the preventive half of a pair. `@deepseek-ai/dsh-llm-retry` is the
 * reactive half and already retries `RATE_LIMIT`; the terminal chunk this plugin
 * emits carries `providerRetryAfterMs` so a refusal that still happens hands
 * over to that executor rather than duplicating its backoff.
 *
 * @module dsh-llm-rate-limit
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

import { Config, limitForRoute, plainConfig } from './config.ts'
import type { ResolvedProviderLimit } from './config.ts'
import { Gate } from './gate.ts'
import type { GateScheduler, GateSnapshot } from './gate.ts'

export type {
  Options,
  PlainConfig,
  ProviderRateLimit,
  PurposeScope,
  ResolvedProviderLimit,
} from './config.ts'
export {
  Config,
  DEFAULT_MAX_QUEUE_DEPTH,
  DEFAULT_MAX_WAIT_MS,
  DEFAULT_REQUESTS_PER_WINDOW,
  DEFAULT_WINDOW_MS,
  limitForRoute,
  plainConfig,
  resolveProviderLimit,
} from './config.ts'
export { TokenBucket, MAX_TIMER_DELAY_MS } from './bucket.ts'
export { Gate, defaultScheduler } from './gate.ts'
export type { AcquireOutcome, GateScheduler, GateSnapshot, RefusalReason } from './gate.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The mounted rate limiter, readable so a UI can show queue depth. */
    llmRateLimit: RateLimiter
  }
}

/** Non-serializable hooks that make queue timing deterministic in tests. */
export interface RateLimiterInternals {
  /** Clock and timer for every gate this instance creates. */
  scheduler?: GateScheduler
}

/** A route's live queue state, for a settings page or a diagnostic. */
export interface RouteSnapshot extends GateSnapshot {
  /** Sustained rate the route is held to. */
  readonly requestsPerWindow: number
  readonly windowMs: number
}

/**
 * The terminal chunk a refused request ends on.
 *
 * A plugin-produced failure still obeys the stream contract: exactly one
 * terminal `finish` chunk, and nothing after it. `providerRetryAfterMs` is the
 * seam to `dsh-llm-retry`, which prefers it over its own local backoff.
 */
function terminalChunk(options: GenerateOptions, message: string, waitMs?: number): StreamChunk {
  return {
    type: 'finish',
    reason: {
      kind: 'error',
      failure: {
        code: 'RATE_LIMIT',
        message: `llm-rate-limit: ${message} (provider "${options.provider}")`,
        ...waitMs === undefined ? {} : { providerRetryAfterMs: Math.max(1, Math.ceil(waitMs)) },
      },
    },
  }
}

/** The terminal chunk a cancelled request ends on. */
function abortedChunk(options: GenerateOptions): StreamChunk {
  return {
    type: 'finish',
    reason: {
      kind: 'aborted',
      failure: {
        code: 'ABORTED',
        message: `llm-rate-limit: cancelled while queued for provider "${options.provider}"`,
      },
    },
  }
}

/**
 * One queue entry: the profile that produced it and the gate serving it.
 *
 * The signature is what makes a settings edit take effect. Volatile config means
 * a profile can change under a live gate, so each request compares the resolved
 * profile and rebuilds the gate when it differs.
 */
interface GateEntry {
  readonly signature: string
  readonly limit: ResolvedProviderLimit
  readonly gate: Gate
}

/**
 * Stable text for one resolved profile.
 *
 * Every behavior-affecting field is included, so any edit that changes what the
 * gate does produces a different signature and a fresh gate. Routes with equal
 * policies still get separate gates, since one queue per route is the unit that
 * bounds memory.
 */
function signatureOf(limit: ResolvedProviderLimit): string {
  return JSON.stringify([
    limit.enabled,
    limit.requestsPerWindow,
    limit.windowMs,
    limit.burstSize,
    limit.onExhausted,
    limit.maxQueueDepth,
    limit.maxWaitMs,
  ])
}

/**
 * Rate limiting for model calls, exposed as a service so a UI can read queue depth.
 *
 * Mount this after `llm` and any provider adapter. It is inert until a route is
 * named in `providers`: the dict is a whitelist, so enabling the plugin for one
 * free tier never slows the paid route beside it.
 */
export class RateLimiter extends Service {
  /** The model service whose waterfall this plugin wraps. */
  static inject = ['llm']

  /** Configuration schema; every field is volatile so the UI can edit it live. */
  static Config = Config

  private readonly gates = new Map<string, GateEntry>()
  /** Aborted on disposal so queued requests fail fast instead of hanging. */
  private readonly lifetime = new AbortController()
  private readonly scheduler: GateScheduler | undefined

  /**
   * @param ctx - plugin context owning the listener and the live gates.
   * @param config - validated configuration; volatile fields are read per request.
   * @param internals - non-serializable deterministic hooks for tests.
   */
  constructor(ctx: Context, private readonly config: Config, internals: RateLimiterInternals = {}) {
    super(ctx, 'llmRateLimit')
    this.scheduler = internals.scheduler

    const removeListener = ctx.on('llm/stream', (options, next): AsyncIterable<StreamChunk> => {
      const entry = this.admit(options)
      if (entry === undefined) return next()
      return this.gated(options, next, entry)
      // `global: true` is required, not defensive: `llm/stream` dispatches with
      // the LlmRuntime as `thisArg`, and `Service[symbols.filter]` compares
      // isolate-scope labels. A plugin row mounted in a different scope than the
      // `llm` service would otherwise be filtered out silently — installed, with
      // no error, and never limiting anything.
    }, { global: true })

    // One effect owns the whole teardown so it unwinds in a deliberate order:
    // stop admitting first, then fail what is already waiting, then drop state.
    ctx.effect(() => async () => {
      removeListener()
      this.lifetime.abort(new Error('llm-rate-limit disposed'))
      for (const entry of this.gates.values()) entry.gate.dispose()
      this.gates.clear()
    }, 'llm-rate-limit: dispose listener, abort waits, drain gates')
  }

  /**
   * Resolve the route's gate, rebuilding it when its profile changed.
   *
   * Called on every request rather than once at mount, because a volatile field
   * can be edited from the settings UI without a remount and a gate pinned to a
   * stale profile would keep applying the old policy.
   * @param options - the model request naming the route.
   * @returns the gate to admit through, or undefined when nothing limits it.
   */
  private admit(options: GenerateOptions): GateEntry | undefined {
    const config = plainConfig(this.config)
    const limit = limitForRoute(config, options.provider)
    // An unnamed route, a disabled profile, or the master switch all read the
    // same here: no limit, so the request is not touched at all.
    if (limit === undefined) return undefined
    // Auxiliary calls share the provider's quota but not the user's patience:
    // compaction and session-title must not spend the budget the conversation
    // needs, and a queued title only delays the first screen.
    if (config.purposeScope === 'conversation' && options.purpose !== undefined) return undefined

    const signature = signatureOf(limit)
    const existing = this.gates.get(options.provider)
    if (existing !== undefined && existing.signature === signature) return existing
    // The old gate is closed so its queued requests settle as `disposed` rather
    // than waiting on a policy the user has just changed.
    existing?.gate.dispose()
    const gate = new Gate(limit, this.scheduler)
    const entry: GateEntry = { signature, limit, gate }
    this.gates.set(options.provider, entry)
    return entry
  }

  /**
   * Wrap one request in its route's admission wait.
   *
   * The wait lives inside the generator rather than in the listener, because
   * `llm/stream` is a waterfall that is *not* awaited: a listener returning a
   * promise would break the declared `AsyncIterable<StreamChunk>` and the
   * `LlmRuntime.stream()` return type. A synchronously created generator keeps
   * the wait lazy and the contract intact.
   * @param options - the request being admitted.
   * @param next - the downstream `llm/stream` chain.
   * @param entry - the gate serving this route.
   * @returns a stream that yields the provider's chunks once a token is held.
   */
  private gated(
    options: GenerateOptions,
    next: () => AsyncIterable<StreamChunk>,
    entry: GateEntry,
  ): AsyncIterable<StreamChunk> {
    const { gate, limit } = entry
    const logger = this.ctx.logger('llm-rate-limit')
    // A generator body has its own `this`, so everything it needs is captured
    // here rather than reached through the instance.
    const lifetime = this.lifetime.signal
    return (async function* (): AsyncIterable<StreamChunk> {
      // A request cancelled while waiting must not spend a token another request
      // is owed, so the caller's cancellation and the plugin's own disposal are
      // fused into one signal the queue can watch.
      const signal = options.signal === undefined
        ? lifetime
        : AbortSignal.any([options.signal, lifetime])
      const outcome = await gate.acquire(signal)
      if (outcome.kind === 'aborted') {
        yield abortedChunk(options)
        return
      }
      if (outcome.kind === 'refused') {
        // The refusal carries the profile's own wait budget so `dsh-llm-retry`
        // can pace the retry, rather than falling back to a blind local backoff.
        yield terminalChunk(options, describeRefusal(outcome.reason, limit), limit.maxWaitMs)
        return
      }
      if (outcome.waitedMs > 0) {
        logger.debug('queued a %s request on "%s" for %dms', limit.route, options.model, outcome.waitedMs)
      }
      yield* next()
    })()
  }

  /**
   * Read every live route's queue state.
   * @returns detached snapshots keyed by route id, in mount order.
   */
  snapshots(): Map<string, RouteSnapshot> {
    const result = new Map<string, RouteSnapshot>()
    for (const [route, entry] of this.gates) {
      const { depth, nextTokenMs, disposed } = entry.gate.snapshot()
      result.set(route, Object.freeze({
        route,
        depth,
        nextTokenMs,
        disposed,
        requestsPerWindow: entry.limit.requestsPerWindow,
        windowMs: entry.limit.windowMs,
      }))
    }
    return result
  }
}

/**
 * Name the reason in the message that reaches neither the model nor the user.
 * @param reason - machine reason from the gate.
 * @param limit - the profile that produced it.
 * @returns a sentence fragment for the terminal chunk.
 */
function describeRefusal(reason: string, limit: ResolvedProviderLimit): string {
  const budget = `${String(limit.requestsPerWindow)} requests per ${String(limit.windowMs)}ms`
  switch (reason) {
    case 'queue-full':
      return `refused, ${budget} exhausted and ${String(limit.maxQueueDepth)} requests are already waiting`
    case 'wait-timeout':
      return `refused, no token within ${String(limit.maxWaitMs)}ms at ${budget}`
    case 'on-exhausted':
      return `refused, ${budget} exhausted`
    case 'disposed':
      return 'refused, the rate limiter was disposed before a token was free'
    default:
      return `refused (${reason}) at ${budget}`
  }
}

export default RateLimiter