import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { MAX_TIMER_DELAY_MS, TokenBucket } from '../src/bucket.ts'

/** NIM's free tier: 30 requests per 60s window. */
const NIM: { capacity: number; refillPerMs: number } = {
  capacity: 30,
  refillPerMs: 30 / 60_000,
}

describe('TokenBucket construction', () => {
  test('starts full so an idle client may burst its whole allowance', () => {
    const bucket = new TokenBucket(NIM, 0)
    assert.equal(bucket.available(0), 30)
  })

  test('rejects a capacity that is not a positive safe integer', () => {
    for (const capacity of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => new TokenBucket({ capacity, refillPerMs: 1 }, 0),
        { name: 'TypeError' },
        `capacity ${String(capacity)} must be refused`,
      )
    }
  })

  test('rejects a refill rate that is not positive and finite', () => {
    for (const refillPerMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => new TokenBucket({ capacity: 1, refillPerMs }, 0),
        { name: 'TypeError' },
        `refillPerMs ${String(refillPerMs)} must be refused`,
      )
    }
  })

  test('refuses a rate too slow to yield a token within any timer Node honors', () => {
    // One token would take longer than MAX_TIMER_DELAY_MS; a waiter would hang
    // past every bound, so this is refused up front instead.
    assert.throws(
      () => new TokenBucket({ capacity: 1, refillPerMs: 1 / (MAX_TIMER_DELAY_MS + 1) }, 0),
      { name: 'RangeError' },
    )
  })

  test('accepts the slowest rate that still yields a token inside one timer', () => {
    const bucket = new TokenBucket({ capacity: 1, refillPerMs: 1 / MAX_TIMER_DELAY_MS }, 0)
    assert.equal(bucket.tryAcquire(0), true, 'spend the only token so a wait is owed')
    assert.equal(bucket.waitMs(0), MAX_TIMER_DELAY_MS)
  })
})

describe('TokenBucket admission', () => {
  test('admits exactly `capacity` requests then refuses', () => {
    const bucket = new TokenBucket(NIM, 0)
    for (let i = 0; i < 30; i++) {
      assert.equal(bucket.tryAcquire(0), true, `request ${i} must be admitted`)
    }
    assert.equal(bucket.tryAcquire(0), false, 'the 31st burst request must be refused')
  })

  test('a refused request consumes nothing', () => {
    const bucket = new TokenBucket({ capacity: 1, refillPerMs: 0.001 }, 0)
    assert.equal(bucket.tryAcquire(0), true)
    assert.equal(bucket.available(0), 0)
    assert.equal(bucket.tryAcquire(0), false)
    assert.equal(bucket.tryAcquire(0), false)
    assert.equal(bucket.available(0), 0, 'repeated refusals must not drive tokens negative')
  })
})

describe('TokenBucket refill', () => {
  test('refills at the configured rate over the window', () => {
    const bucket = new TokenBucket(NIM, 0)
    for (let i = 0; i < 30; i++) bucket.tryAcquire(0)
    assert.equal(bucket.available(0), 0)

    // Half a window later, half the allowance has accrued.
    assert.equal(bucket.available(30_000), 15)
    // A full window later, a full allowance is back.
    assert.equal(bucket.available(60_000), 30)
  })

  test('caps the reservoir at capacity however long the bucket sits idle', () => {
    const bucket = new TokenBucket(NIM, 0)
    assert.equal(bucket.available(10 * 60_000), 30, 'ten idle minutes is still one allowance')
  })

  test('accrual is continuous, not stepwise per window', () => {
    const bucket = new TokenBucket({ capacity: 10, refillPerMs: 1 / 1000 }, 0)
    for (let i = 0; i < 10; i++) bucket.tryAcquire(0)
    // One token per second: 2.5s in, 2 whole tokens plus a fraction.
    const available = bucket.available(2500)
    assert.ok(available > 2 && available < 3, `expected 2 < x < 3, got ${available}`)
  })

  test('a zero-length span neither creates nor destroys tokens', () => {
    const bucket = new TokenBucket({ capacity: 5, refillPerMs: 0.01 }, 1000)
    assert.equal(bucket.tryAcquire(1000), true)
    assert.equal(bucket.available(1000), 4)
    assert.equal(bucket.available(1000), 4, 'repeating the same reading must be idempotent')
  })

  test('a non-monotonic reading cannot rewind the bucket', () => {
    const bucket = new TokenBucket({ capacity: 5, refillPerMs: 0.01 }, 1000)
    for (let i = 0; i < 5; i++) bucket.tryAcquire(1000)
    // An earlier reading than the base must not hand back tokens.
    assert.equal(bucket.tryAcquire(500), false)
    assert.equal(bucket.available(500), 0)
  })
})

describe('TokenBucket waitMs', () => {
  test('is 0 while a token is held', () => {
    const bucket = new TokenBucket(NIM, 0)
    assert.equal(bucket.waitMs(0), 0)
  })

  test('reports the time until the next token at the configured rate', () => {
    const bucket = new TokenBucket(NIM, 0)
    for (let i = 0; i < 30; i++) bucket.tryAcquire(0)
    // One token per 2000ms at 30 per 60s.
    assert.equal(bucket.waitMs(0), 2000)
  })

  test('shrinks as the bucket refills and reaches 0 exactly when one token lands', () => {
    const bucket = new TokenBucket(NIM, 0)
    for (let i = 0; i < 30; i++) bucket.tryAcquire(0)
    assert.equal(bucket.waitMs(1000), 1000)
    assert.equal(bucket.waitMs(1999), 1)
    assert.equal(bucket.waitMs(2000), 0, 'at the token instant there is no wait left')
  })

  test('never answers sub-millisecond, which would spin instead of wait', () => {
    // 1e9 tokens per millisecond is near the float64 boundary: the computed
    // delay is far below 1ms, but a waiter re-polling that fast is a busy loop.
    const bucket = new TokenBucket({ capacity: 1, refillPerMs: 1e9 }, 0)
    assert.equal(bucket.tryAcquire(0), true)
    assert.ok(bucket.waitMs(0) >= 1, 'waitMs must floor at 1ms')
  })

  test('waitMs does not consume a token', () => {
    const bucket = new TokenBucket(NIM, 0)
    for (let i = 0; i < 30; i++) bucket.tryAcquire(0)
    bucket.waitMs(0)
    bucket.waitMs(0)
    assert.equal(bucket.available(0), 0, 'asking twice must not spend a token')
  })
})

describe('TokenBucket sustained throughput', () => {
  test('admits exactly requestsPerWindow over a window when paced one per interval', () => {
    const bucket = new TokenBucket(NIM, 0)
    const intervalMs = 60_000 / 30
    let admitted = 0
    for (let i = 0; i < 30; i++) {
      if (bucket.tryAcquire(i * intervalMs)) admitted++
    }
    assert.equal(admitted, 30, 'pacing one request per interval admits the whole allowance')
  })

  test('refuses immediately after the allowance is spent, admitting one per interval', () => {
    const bucket = new TokenBucket(NIM, 0)
    for (let i = 0; i < 30; i++) bucket.tryAcquire(0)
    // Token bucket, not a fixed window: the 31st request is refused right away
    // rather than being held until a window boundary, then admitted once a
    // single interval's worth of refill has accrued.
    assert.equal(bucket.tryAcquire(0), false, 'the allowance is spent')
    assert.equal(bucket.tryAcquire(1999), false, 'one interval has not elapsed yet')
    assert.equal(bucket.tryAcquire(2000), true, 'exactly one interval admits exactly one token')
    assert.equal(bucket.tryAcquire(2000), false, 'and that token is spent too')
  })
})