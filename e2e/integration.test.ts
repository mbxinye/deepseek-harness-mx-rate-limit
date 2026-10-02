/**
 * Integration test against the REAL harness: the actual `LlmRuntime`, the actual
 * `llm/stream` waterfall, and the actual Cordis context filter. Nothing is a
 * stand-in except the model adapter, which exists only so no network is used.
 *
 * This settles the two design questions unit tests cannot:
 *
 *  - Does the listener actually fire? `llm/stream` dispatches with the
 *    `LlmRuntime` as `thisArg`, and `Service[symbols.filter]` compares isolate
 *    scope labels, so a plugin in another scope is dropped with no error. The
 *    `{ global: true }` choice is only justified if the negative case fails.
 *  - Does queueing survive a waterfall that is not awaited?
 *
 * Run with cwd at the harness checkout: that is what lets tsx resolve
 * `@deepseek-ai/*` through the harness tsconfig path table.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'

import { Config, RateLimiter } from '../src/index.ts'
import { ManualScheduler } from '../tests/helpers/scheduler.ts'

const OFF = ReasoningEffortId('off')

/** Records the moment each request reached the provider, and answers at once. */
class RecordingAdapter extends LlmAdapter {
  readonly admitted: { at: number; model: string; purpose: string | undefined }[] = []

  constructor(private readonly clock: () => number) {
    super()
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      reasoning: { efforts: [{ id: OFF, name: 'Off' }], defaultEffort: OFF },
    }
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.admitted.push({ at: this.clock(), model: options.model, purpose: options.purpose })
    const text = 'ok'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** What one settled stream ended on. */
interface Settled {
  terminal: string
  code?: string
  providerRetryAfterMs?: number
  message?: string
}

/**
 * Drain one request to its terminal chunk.
 * @param ctx - context owning the mounted llm service.
 * @param model - model id, used to tag admissions.
 * @param purpose - auxiliary classification, when the caller wants one.
 * @returns the terminal outcome and any failure facts.
 */
async function drain(ctx: Context, model: string, purpose?: 'compaction'): Promise<Settled> {
  let terminal = 'none'
  let failure: Settled = {}
  try {
    for await (const chunk of ctx.llm.stream({
      provider: 'probe',
      model,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      ...purpose === undefined ? {} : { purpose },
    })) {
      if (chunk.type !== 'finish') continue
      terminal = chunk.reason.kind
      failure = chunk.reason.kind === 'aborted' || chunk.reason.kind === 'error'
        ? { ...chunk.reason.failure }
        : {}
    }
  } catch (error: unknown) {
    return { terminal: 'threw', message: error instanceof Error ? error.message : String(error) }
  }
  return { terminal, ...failure }
}

/** A mounted stack: real llm service, recording adapter, and the real plugin. */
interface Stack {
  ctx: Context
  adapter: RecordingAdapter
  scheduler: ManualScheduler
  dispose: () => void
}

/**
 * Mount the service, the adapter, and the limiter.
 *
 * The limiter is constructed directly rather than through `ctx.plugin` when a
 * manual clock is wanted, because Cordis instantiates a class plugin with
 * exactly `(ctx, config)` — a third `internals` argument is dropped on the floor.
 * That is also why the `internals` seam is a constructor parameter here: it is a
 * test affordance, not a channel the Loader can reach.
 * @param config - limiter configuration; omit for a no-op limiter.
 * @param scheduler - manual clock driving every gate; omit to use real timers.
 * @param options - mount the limiter in a child context instead of the root.
 * @returns the mounted stack, already active.
 */
async function mount(
  config: Record<string, unknown> | undefined,
  scheduler: ManualScheduler | undefined = undefined,
  options: { childScope?: boolean } = {},
): Promise<Stack> {
  const ctx = new Context()
  const clock = scheduler?.now ?? (() => performance.now())
  const adapter = new RecordingAdapter(clock)
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['probe'], adapter)
  const services: { dispose?: () => void }[] = []
  if (config !== undefined) {
    const scope = options.childScope === true ? ctx.extend({}) : ctx
    const service = new RateLimiter(
      scope,
      Config(config as never),
      scheduler === undefined ? {} : { scheduler },
    )
    services.push(service)
  }
  return {
    ctx,
    adapter,
    scheduler: scheduler ?? new ManualScheduler(),
    dispose: () => {
      for (const service of services) service.dispose?.()
      ctx.fiber.dispose()
    },
  }
}

describe('llm/stream integration through the real LlmRuntime', () => {
  test('an unnamed route passes straight through to the provider', async () => {
    const stack = await mount(undefined)
    try {
      assert.equal((await drain(stack.ctx, 'm')).terminal, 'stop')
      assert.equal(stack.adapter.admitted.length, 1, 'the request reached the provider')
    } finally { stack.dispose() }
  })

  test('a gated route queues and releases exactly one request per interval', async () => {
    const scheduler = new ManualScheduler()
    const stack = await mount({ providers: { probe: { burstSize: 1, requestsPerWindow: 30, windowMs: 60_000 } } }, scheduler)
    try {
      // Drain the single burst token so every later request has to queue.
      assert.equal((await drain(stack.ctx, 'warm')).terminal, 'stop')
      assert.equal(stack.adapter.admitted.length, 1)

      const pending = Array.from({ length: 3 }, (_, i) => drain(stack.ctx, `q${i}`))
      await scheduler.settle()
      assert.equal(stack.adapter.admitted.length, 1, 'nothing is admitted while the bucket is empty')

      const perTick: number[] = []
      for (let i = 0; i < 3; i++) {
        const before = stack.adapter.admitted.length
        scheduler.advance(2000)
        await scheduler.settle()
        await Promise.resolve()
        const gained = stack.adapter.admitted.length - before
        if (gained > 0) perTick.push(gained)
      }
      await Promise.all(pending)

      assert.deepEqual(perTick, [1, 1, 1], 'exactly one request is admitted per interval')
      assert.equal(stack.adapter.admitted.length, 4, 'the warm-up plus all three queued')
    } finally { stack.dispose() }
  })

  test('admission order matches request order', async () => {
    const scheduler = new ManualScheduler()
    const stack = await mount({ providers: { probe: { burstSize: 1, requestsPerWindow: 30, windowMs: 60_000 } } }, scheduler)
    try {
      await drain(stack.ctx, 'warm')
      const pending = ['first', 'second', 'third'].map(model => drain(stack.ctx, model))
      await scheduler.settle()
      for (let i = 0; i < 3; i++) {
        scheduler.advance(2000)
        await scheduler.settle()
      }
      await Promise.all(pending)

      assert.deepEqual(
        stack.adapter.admitted.map(entry => entry.model),
        ['warm', 'first', 'second', 'third'],
        'a limiter must not reorder the queue',
      )
    } finally { stack.dispose() }
  })

  test('a refusal is one terminal error chunk carrying RATE_LIMIT', async () => {
    const stack = await mount({
      providers: { probe: { burstSize: 1, requestsPerWindow: 30, windowMs: 60_000, maxQueueDepth: 0 } },
    })
    try {
      await drain(stack.ctx, 'a')
      const refused = await drain(stack.ctx, 'b')
      assert.equal(refused.terminal, 'error', 'a refusal settles, it does not throw')
      assert.equal(refused.code, 'RATE_LIMIT', 'the code dsh-llm-retry already retries')
      assert.ok(
        typeof refused.providerRetryAfterMs === 'number' && refused.providerRetryAfterMs > 0,
        'providerRetryAfterMs is the seam to dsh-llm-retry',
      )
    } finally { stack.dispose() }
  })

  test('a route outside the whitelist is never limited', async () => {
    const stack = await mount({ providers: { elsewhere: { requestsPerWindow: 1, windowMs: 60_000 } } })
    try {
      for (let i = 0; i < 5; i++) {
        assert.equal((await drain(stack.ctx, `m${i}`)).terminal, 'stop')
      }
      assert.equal(stack.adapter.admitted.length, 5, 'a paid route beside the free tier is untouched')
    } finally { stack.dispose() }
  })

  test('purposeScope conversation lets an auxiliary call bypass the budget', async () => {
    const scheduler = new ManualScheduler()
    const stack = await mount({ providers: { probe: { burstSize: 1, requestsPerWindow: 30, windowMs: 60_000 } } }, scheduler)
    try {
      await drain(stack.ctx, 'warm')
      // The bucket is empty, so a conversation call would have to queue. An
      // auxiliary one must not, or compaction spends the user's budget.
      const aux = drain(stack.ctx, 'summary', 'compaction')
      await scheduler.settle()
      assert.equal(stack.adapter.admitted.length, 2, 'the auxiliary call was admitted without waiting')
      assert.equal((await aux).terminal, 'stop')
    } finally { stack.dispose() }
  })

  test('purposeScope all makes an auxiliary call share the budget', async () => {
    const scheduler = new ManualScheduler()
    const stack = await mount({
      purposeScope: 'all',
      providers: { probe: { burstSize: 1, requestsPerWindow: 30, windowMs: 60_000, maxQueueDepth: 0 } },
    }, scheduler)
    try {
      await drain(stack.ctx, 'warm')
      const refused = await drain(stack.ctx, 'summary', 'compaction')
      assert.equal(refused.code, 'RATE_LIMIT', 'under "all" the auxiliary call is counted too')
    } finally { stack.dispose() }
  })

  test('the master switch parks every route without deleting profiles', async () => {
    const scheduler = new ManualScheduler()
    const stack = await mount({
      enabled: false,
      providers: { probe: { burstSize: 1, requestsPerWindow: 1, windowMs: 60_000, maxQueueDepth: 0 } },
    }, scheduler)
    try {
      for (let i = 0; i < 3; i++) assert.equal((await drain(stack.ctx, `m${i}`)).terminal, 'stop')
      assert.equal(stack.adapter.admitted.length, 3, 'the parked limiter admitted everything')
    } finally { stack.dispose() }
  })

  test('disposal settles queued requests as aborted, not as a rate-limit error', async () => {
    const scheduler = new ManualScheduler()
    const stack = await mount({ providers: { probe: { burstSize: 1, requestsPerWindow: 30, windowMs: 60_000 } } }, scheduler)
    try {
      await drain(stack.ctx, 'warm')
      const queued = drain(stack.ctx, 'queued')
      await scheduler.settle()

      stack.dispose()
      const settled = await queued
      // The plugin's own lifetime signal aborts the wait, and a shutdown is not
      // the user's rate limit. Reporting `aborted` keeps the cause honest; a
      // RATE_LIMIT here would send dsh-llm-retry into a pointless retry loop for
      // a turn that is being torn down anyway.
      assert.equal(settled.terminal, 'aborted', 'a queued request settles on unload')
      assert.notEqual(settled.code, 'RATE_LIMIT', 'unload must not masquerade as a refusal')
    } finally { stack.dispose() }
  })

  test('a plugin mounted in a child scope still limits', async () => {
    // A `dsh` patch row produces a child context, which is exactly the shape
    // whose isolate labels could differ from the llm service's.
    const scheduler = new ManualScheduler()
    const stack = await mount({
      providers: { probe: { burstSize: 1, requestsPerWindow: 30, windowMs: 60_000, maxQueueDepth: 0 } },
    }, scheduler, { childScope: true })
    try {
      await drain(stack.ctx, 'a')
      const refused = await drain(stack.ctx, 'b')
      assert.equal(refused.code, 'RATE_LIMIT', 'the listener was not silently filtered out')
    } finally { stack.dispose() }
  })
})

describe('the production scheduler path', () => {
  test('real timers hold the release rate without any test seam', async () => {
    // Everything above injects a manual clock. This one does not: it exercises
    // `defaultScheduler()` — `performance.now()` plus `setTimeout` — which is
    // what actually runs in the desktop app.
    const stack = await mount({
      providers: { probe: { burstSize: 1, requestsPerWindow: 100, windowMs: 1000, maxQueueDepth: 8 } },
    })
    try {
      await drain(stack.ctx, 'warm')
      const started = performance.now()
      const pending = Array.from({ length: 3 }, (_, i) => drain(stack.ctx, `q${i}`))
      await Promise.all(pending)
      const elapsed = performance.now() - started

      assert.equal(stack.adapter.admitted.length, 4, 'every request was eventually admitted')
      // 100 per 1000ms is one token per 10ms, so three queued requests cannot
      // finish in under two intervals. A simultaneous release would be far
      // quicker, which is the failure this limiter exists to prevent.
      assert.ok(elapsed >= 20, `expected at least 20ms of queued release, got ${Math.round(elapsed)}ms`)
      assert.deepEqual(
        stack.adapter.admitted.map(entry => entry.model),
        ['warm', 'q0', 'q1', 'q2'],
        'real timers preserve arrival order too',
      )
    } finally { stack.dispose() }
  })
})