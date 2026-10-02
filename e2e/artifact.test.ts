/**
 * Verifies the SHIPPED artifact, not the source tree.
 *
 * `lib/index.js` is what a profile actually loads, and it differs from
 * `src/index.ts` in the ways that break installs: relative specifiers were
 * rewritten to `.js`, and the code is plain JavaScript with no type stripping to
 * rely on. A source-only test would pass while the install path failed.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'

const LIB = pathToFileURL(
  resolve(process.cwd(), '..', 'deepseek-harness-mx-rate-limit', 'lib', 'index.js'),
).href

const mod = await import(LIB)
const { Context } = await import('@deepseek-ai/cordis')
const { LlmAdapter, LlmRuntime, ReasoningEffortId } = await import('@deepseek-ai/dsh-llm')

const OFF = ReasoningEffortId('off')

class CountingAdapter extends LlmAdapter {
  admitted = 0

  override async resolveModel(provider, model) {
    return { provider, id: model, name: model, reasoning: { efforts: [{ id: OFF, name: 'Off' }], defaultEffort: OFF } }
  }

  override async * stream() {
    this.admitted += 1
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'ok' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

test('the built lib/index.js loads and exports the plugin', () => {
  assert.equal(typeof mod.RateLimiter, 'function', 'RateLimiter must be exported')
  assert.equal(typeof mod.default, 'function', 'a default export is what the Loader looks for')
  assert.equal(mod.name, undefined, 'a class plugin needs no name export')
  assert.equal(typeof mod.Config, 'function', 'the config schema must ride along')
})

test('the built artifact mounts on the real llm service and limits a route', async () => {
  const ctx = new Context()
  const adapter = new CountingAdapter()
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['probe'], adapter)
  const scope = ctx.extend({})
  new mod.RateLimiter(scope, mod.Config({
    providers: { probe: { burstSize: 1, requestsPerWindow: 30, windowMs: 60_000 } },
  }))

  const drain = async (model) => {
    let terminal
    let code
    for await (const chunk of ctx.llm.stream({
      provider: 'probe',
      model,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    })) {
      if (chunk.type === 'finish') {
        terminal = chunk.reason.kind
        if ('failure' in chunk.reason) code = chunk.reason.failure?.code
      }
    }
    return { terminal, code }
  }

  assert.deepEqual(await drain('a'), { terminal: 'stop', code: undefined })

  // Nothing is refused any more, so "the built artifact limits" is observed as a
  // wait: one token per 2000ms at 30 per 60s means the second request cannot
  // arrive sooner. Real timers here, because this suite is about the shipped
  // artifact rather than a seam.
  const started = performance.now()
  assert.deepEqual(await drain('b'), { terminal: 'stop', code: undefined })
  const waited = performance.now() - started
  assert.ok(waited >= 1000, `expected the built artifact to hold the second request, waited ${Math.round(waited)}ms`)
  assert.equal(adapter.admitted, 2, 'the held request reached the provider once a token was free')
  ctx.fiber.dispose()
})