import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  Config,
  DEFAULT_REQUESTS_PER_WINDOW,
  DEFAULT_WINDOW_MS,
  limitForRoute,
  plainConfig,
  resolveProviderLimit,
} from '../src/config.ts'
import type { PurposeScope } from '../src/config.ts'
import { MAX_TIMER_DELAY_MS } from '../src/bucket.ts'

describe('Config schema defaults', () => {
  test('an empty section limits nothing and defaults to limiting conversation only', () => {
    const parsed = plainConfig(Config({}))
    assert.deepEqual(parsed.providers, {})
    assert.equal(parsed.purposeScope, 'conversation')
    assert.equal(parsed.enabled, true)
  })

  test('a route named with no fields adopts the documented free-tier rate', () => {
    const nim = plainConfig(Config({ providers: { nim: {} } })).providers.nim
    assert.ok(nim)
    assert.equal(nim.requestsPerWindow, DEFAULT_REQUESTS_PER_WINDOW)
    assert.equal(nim.windowMs, DEFAULT_WINDOW_MS)
  })

  test('no field can express a wait bound, so nothing can shed load', () => {
    // The profile is two numbers wide. A queue depth, a wait budget or a
    // fail-fast switch would all have to surface as a RATE_LIMIT refusal, and
    // dsh-llm-retry retries that by default -- so each one would manufacture
    // another request for the same quota instead of relieving it.
    const nim = plainConfig(Config({ providers: { nim: {} } })).providers.nim
    assert.deepEqual(Object.keys(nim ?? {}).sort(), ['enabled', 'requestsPerWindow', 'windowMs'])
  })

  test('volatile fields are live references, so plainConfig is what callers read', () => {
    const parsed = Config({ providers: { nim: {} } })
    assert.equal(typeof parsed.providers.get, 'function', 'a volatile field is a ref, not a value')
    // The dict is volatile as a whole, so its profile entries are already
    // materialized with every inner default rather than left partial.
    assert.deepEqual(parsed.providers.get().nim, {
      enabled: true,
      requestsPerWindow: DEFAULT_REQUESTS_PER_WINDOW,
      windowMs: DEFAULT_WINDOW_MS,
    })
  })

  test('refuses an unknown purposeScope at the schema boundary', () => {
    assert.throws(() => Config({ purposeScope: 'compaction' as PurposeScope }))
  })

  test('purposeScope accepts both classes', () => {
    assert.equal(plainConfig(Config({ purposeScope: 'all' })).purposeScope, 'all')
    assert.equal(plainConfig(Config({ purposeScope: 'conversation' })).purposeScope, 'conversation')
  })

  test('refuses an unknown purposeScope', () => {
    assert.throws(() => Config({ purposeScope: 'compaction' as PurposeScope }))
  })
})

describe('Config schema rejections', () => {
  test('refuses a non-positive request rate', () => {
    for (const requestsPerWindow of [0, -1, 1.5]) {
      assert.throws(
        () => Config({ providers: { nim: { requestsPerWindow } } }),
        { name: 'ValidationError' },
        `requestsPerWindow ${String(requestsPerWindow)} must be refused`,
      )
    }
  })

  test('refuses a window shorter than 100ms', () => {
    assert.throws(() => Config({ providers: { nim: { windowMs: 99 } } }))
  })

  test('refuses a window no timer can hold', () => {
    assert.throws(() => Config({ providers: { nim: { windowMs: 2_147_483_648 } } }))
  })
})

describe('resolveProviderLimit', () => {
  test('adopts the request rate as the burst allowance by default', () => {
    const limit = resolveProviderLimit('nim', { requestsPerWindow: 30 })
    assert.equal(limit.burstSize, 30, 'the whole quota is spendable as one burst')
  })

  test('honours an explicit burst allowance', () => {
    const limit = resolveProviderLimit('nim', { requestsPerWindow: 30, burstSize: 5 })
    assert.equal(limit.burstSize, 5)
    assert.equal(limit.requestsPerWindow, 30, 'burst and sustained rate stay independent')
  })

  test('stamps the route from the dict key', () => {
    assert.equal(resolveProviderLimit('nim', {}).route, 'nim')
  })

  test('is immutable so a resolved limit cannot be edited under a live gate', () => {
    const limit = resolveProviderLimit('nim', {})
    assert.throws(() => {
      ;(limit as { burstSize: number }).burstSize = 999
    }, TypeError)
  })

  test('the slowest admissible rate still yields a token within one timer', () => {
    // One token per MAX_TIMER_DELAY_MS. No recheck is needed after validation
    // because these bounds cannot produce a slower rate than the bucket allows.
    const limit = resolveProviderLimit('nim', { requestsPerWindow: 1, windowMs: MAX_TIMER_DELAY_MS })
    assert.equal(limit.requestsPerWindow, 1)
    assert.equal(limit.windowMs, MAX_TIMER_DELAY_MS)
  })

  test('refuses a window longer than a timer can hold', () => {
    assert.throws(
      () => resolveProviderLimit('nim', { requestsPerWindow: 1, windowMs: MAX_TIMER_DELAY_MS + 1 }),
      { name: 'ValidationError' },
    )
  })
})

describe('limitForRoute whitelist', () => {
  const config = plainConfig(Config({
    providers: { nim: { requestsPerWindow: 30 }, 'deepseek-official': { enabled: false } },
  }))

  test('limits a named route', () => {
    assert.equal(limitForRoute(config, 'nim')?.requestsPerWindow, 30)
  })

  test('leaves an unnamed route unlimited, so a paid route is never slowed', () => {
    assert.equal(limitForRoute(config, 'openai'), undefined)
  })

  test('honours a per-route disabled profile', () => {
    assert.equal(limitForRoute(config, 'deepseek-official'), undefined)
  })

  test('the master switch parks every route without deleting profiles', () => {
    const parked = { ...config, enabled: false }
    assert.equal(limitForRoute(parked, 'nim'), undefined)
    assert.equal(limitForRoute(parked, 'openai'), undefined)
  })

  test('a settings edit is visible on the next snapshot', () => {
    // The gate re-reads per request precisely so this holds: no stale snapshot.
    const edited = plainConfig(Config({ providers: { nim: { requestsPerWindow: 10 } } }))
    assert.equal(limitForRoute(config, 'nim')?.requestsPerWindow, 30)
    assert.equal(limitForRoute(edited, 'nim')?.requestsPerWindow, 10)
  })
})