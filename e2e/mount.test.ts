/**
 * Integration test for the MOUNTING path, against the real harness.
 *
 * Every other test here builds the limiter with `new RateLimiter(ctx, ...)`.
 * That skips the one step production never skips: Cordis instantiating the class
 * through `ctx.plugin`, resolving its `static inject`, validating its `Config`,
 * and driving the fiber to ACTIVE. A plugin whose inject names a service the
 * host does not provide is dropped there with no error at all �?the fiber never
 * activates, no namespace is ever served, and nothing anywhere says why.
 *
 * That failure is silent and total, so it is worth a test that uses the real
 * path rather than a hand-built one.
 *
 * Run with cwd at the harness checkout: that is what lets tsx resolve
 * `@deepseek-ai/*` through the harness tsconfig path table.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'

import { RateLimiter } from '../src/index.ts'

const OFF = ReasoningEffortId('off')

/** FiberState.ACTIVE. A const enum cannot be imported under type stripping. */
const ACTIVE = 2

/** Answers every request at once, so a test only ever observes gating. */
class CountingAdapter extends LlmAdapter {
  admitted = 0

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      reasoning: { efforts: [{ id: OFF, name: 'Off' }], defaultEffort: OFF },
    }
  }

  override async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.admitted += 1
    yield { type: 'text-delta', index: 0, text: 'ok' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Drain one request to completion, returning how the stream ended. */
async function drain(ctx: Context, model: string): Promise<string> {
  let terminal = 'none'
  for await (const chunk of ctx.llm.stream({
    provider: 'probe',
    model,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  })) {
    if (chunk.type === 'finish') terminal = chunk.reason.kind
  }
  return terminal
}

describe('mounting through ctx.plugin', () => {
  test('the class activates when its injected service is present', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['probe'], new CountingAdapter())

    // The production path: Cordis instantiates the class, resolves `inject`,
    // validates the Config, and drives the fiber to ACTIVE.
    const fiber = await ctx.plugin(RateLimiter, { purposeScope: 'conversation' })

    assert.ok(ctx.llmRateLimit !== undefined, 'the service was registered on the context')
    assert.equal(fiber.state, ACTIVE, 'the fiber reached ACTIVE rather than waiting on a service')
    await ctx.fiber.dispose()
  })

  test('a config from a bundle patch is accepted and applied', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const adapter = new CountingAdapter()
    ctx.llm.registerAdapter(['probe'], adapter)

    // Exactly the shape cordis.patch.yml ships, resolved to plain values.
    const fiber = await ctx.plugin(RateLimiter, {
      purposeScope: 'conversation',
      providers: { probe: { requestsPerWindow: 30, windowMs: 60_000, burstSize: 1, maxQueueDepth: 4, maxWaitMs: 5_000 } },
    })

    assert.equal(fiber.state, ACTIVE)
    assert.notEqual(ctx.llmRateLimit, undefined)

    // The gate must actually hold: burstSize 1 means the second request waits.
    await drain(ctx, 'm')
    assert.equal(adapter.admitted, 1)
    await ctx.fiber.dispose()
  })

  test('an unknown route is not limited, so a default config is a no-op', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const adapter = new CountingAdapter()
    ctx.llm.registerAdapter(['probe'], adapter)

    const fiber = await ctx.plugin(RateLimiter, { providers: {} })
    assert.equal(fiber.state, ACTIVE)

    // Two requests, no queueing: the whitelist means nothing is limited.
    await drain(ctx, 'm')
    await drain(ctx, 'm')
    assert.equal(adapter.admitted, 2, 'nothing was held back')
    await ctx.fiber.dispose()
  })
})