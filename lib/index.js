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
import { Service } from '@deepseek-ai/cordis';
import { Config, limitForRoute, plainConfig } from "./config.js";
import { Gate } from "./gate.js";
export { Config, DEFAULT_MAX_QUEUE_DEPTH, DEFAULT_MAX_WAIT_MS, DEFAULT_REQUESTS_PER_WINDOW, DEFAULT_WINDOW_MS, limitForRoute, plainConfig, resolveProviderLimit, } from "./config.js";
export { TokenBucket, MAX_TIMER_DELAY_MS } from "./bucket.js";
export { Gate, defaultScheduler } from "./gate.js";
/**
 * The terminal chunk a refused request ends on.
 *
 * A plugin-produced failure still obeys the stream contract: exactly one
 * terminal `finish` chunk, and nothing after it. `providerRetryAfterMs` is the
 * seam to `dsh-llm-retry`, which prefers it over its own local backoff.
 */
function terminalChunk(options, message, waitMs) {
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
    };
}
/** The terminal chunk a cancelled request ends on. */
function abortedChunk(options) {
    return {
        type: 'finish',
        reason: {
            kind: 'aborted',
            failure: {
                code: 'ABORTED',
                message: `llm-rate-limit: cancelled while queued for provider "${options.provider}"`,
            },
        },
    };
}
/**
 * Stable text for one resolved profile.
 *
 * Every behavior-affecting field is included, so any edit that changes what the
 * gate does produces a different signature and a fresh gate. Routes with equal
 * policies still get separate gates, since one queue per route is the unit that
 * bounds memory.
 */
function signatureOf(limit) {
    return JSON.stringify([
        limit.enabled,
        limit.requestsPerWindow,
        limit.windowMs,
        limit.burstSize,
        limit.onExhausted,
        limit.maxQueueDepth,
        limit.maxWaitMs,
    ]);
}
/**
 * Rate limiting for model calls, exposed as a service so a UI can read queue depth.
 *
 * Mount this after `llm` and any provider adapter. It is inert until a route is
 * named in `providers`: the dict is a whitelist, so enabling the plugin for one
 * free tier never slows the paid route beside it.
 */
export class RateLimiter extends Service {
    config;
    /** The model service whose waterfall this plugin wraps. */
    static inject = ['llm'];
    /** Configuration schema; every field is volatile so the UI can edit it live. */
    static Config = Config;
    gates = new Map();
    /** Aborted on disposal so queued requests fail fast instead of hanging. */
    lifetime = new AbortController();
    scheduler;
    /**
     * @param ctx - plugin context owning the listener and the live gates.
     * @param config - validated configuration; volatile fields are read per request.
     * @param internals - non-serializable deterministic hooks for tests.
     */
    constructor(ctx, config, internals = {}) {
        super(ctx, 'llmRateLimit');
        this.config = config;
        this.scheduler = internals.scheduler;
        const removeListener = ctx.on('llm/stream', (options, next) => {
            const entry = this.admit(options);
            if (entry === undefined)
                return next();
            return this.gated(options, next, entry);
            // `global: true` is required, not defensive: `llm/stream` dispatches with
            // the LlmRuntime as `thisArg`, and `Service[symbols.filter]` compares
            // isolate-scope labels. A plugin row mounted in a different scope than the
            // `llm` service would otherwise be filtered out silently — installed, with
            // no error, and never limiting anything.
        }, { global: true });
        // One effect owns the whole teardown so it unwinds in a deliberate order:
        // stop admitting first, then fail what is already waiting, then drop state.
        ctx.effect(() => async () => {
            removeListener();
            this.lifetime.abort(new Error('llm-rate-limit disposed'));
            for (const entry of this.gates.values())
                entry.gate.dispose();
            this.gates.clear();
        }, 'llm-rate-limit: dispose listener, abort waits, drain gates');
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
    admit(options) {
        const config = plainConfig(this.config);
        const limit = limitForRoute(config, options.provider);
        // An unnamed route, a disabled profile, or the master switch all read the
        // same here: no limit, so the request is not touched at all.
        if (limit === undefined)
            return undefined;
        // Auxiliary calls share the provider's quota but not the user's patience:
        // compaction and session-title must not spend the budget the conversation
        // needs, and a queued title only delays the first screen.
        if (config.purposeScope === 'conversation' && options.purpose !== undefined)
            return undefined;
        const signature = signatureOf(limit);
        const existing = this.gates.get(options.provider);
        if (existing !== undefined && existing.signature === signature)
            return existing;
        // The old gate is closed so its queued requests settle as `disposed` rather
        // than waiting on a policy the user has just changed.
        existing?.gate.dispose();
        const gate = new Gate(limit, this.scheduler);
        const entry = { signature, limit, gate };
        this.gates.set(options.provider, entry);
        return entry;
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
    gated(options, next, entry) {
        const { gate, limit } = entry;
        const logger = this.ctx.logger('llm-rate-limit');
        // A generator body has its own `this`, so everything it needs is captured
        // here rather than reached through the instance.
        const lifetime = this.lifetime.signal;
        return (async function* () {
            // A request cancelled while waiting must not spend a token another request
            // is owed, so the caller's cancellation and the plugin's own disposal are
            // fused into one signal the queue can watch.
            const signal = options.signal === undefined
                ? lifetime
                : AbortSignal.any([options.signal, lifetime]);
            const outcome = await gate.acquire(signal);
            if (outcome.kind === 'aborted') {
                yield abortedChunk(options);
                return;
            }
            if (outcome.kind === 'refused') {
                // The refusal carries the profile's own wait budget so `dsh-llm-retry`
                // can pace the retry, rather than falling back to a blind local backoff.
                yield terminalChunk(options, describeRefusal(outcome.reason, limit), limit.maxWaitMs);
                return;
            }
            if (outcome.waitedMs > 0) {
                logger.debug('queued a %s request on "%s" for %dms', limit.route, options.model, outcome.waitedMs);
            }
            yield* next();
        })();
    }
    /**
     * Read every live route's queue state.
     * @returns detached snapshots keyed by route id, in mount order.
     */
    snapshots() {
        const result = new Map();
        for (const [route, entry] of this.gates) {
            const { depth, nextTokenMs, disposed } = entry.gate.snapshot();
            result.set(route, Object.freeze({
                route,
                depth,
                nextTokenMs,
                disposed,
                requestsPerWindow: entry.limit.requestsPerWindow,
                windowMs: entry.limit.windowMs,
            }));
        }
        return result;
    }
}
/**
 * Name the reason in the message that reaches neither the model nor the user.
 * @param reason - machine reason from the gate.
 * @param limit - the profile that produced it.
 * @returns a sentence fragment for the terminal chunk.
 */
function describeRefusal(reason, limit) {
    const budget = `${String(limit.requestsPerWindow)} requests per ${String(limit.windowMs)}ms`;
    switch (reason) {
        case 'queue-full':
            return `refused, ${budget} exhausted and ${String(limit.maxQueueDepth)} requests are already waiting`;
        case 'wait-timeout':
            return `refused, no token within ${String(limit.maxWaitMs)}ms at ${budget}`;
        case 'on-exhausted':
            return `refused, ${budget} exhausted`;
        case 'disposed':
            return 'refused, the rate limiter was disposed before a token was free';
        default:
            return `refused (${reason}) at ${budget}`;
    }
}
export default RateLimiter;
//# sourceMappingURL=index.js.map