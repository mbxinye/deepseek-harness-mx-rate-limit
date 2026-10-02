import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { resolveProviderLimit } from '../src/config.ts'
import { Gate } from '../src/gate.ts'
import type { AcquireOutcome } from '../src/gate.ts'
import { ManualScheduler } from './helpers/scheduler.ts'

/** NIM free tier: 30 per 60s, so one token every 2000ms. */
const nim = (over: Parameters<typeof resolveProviderLimit>[1] = {}) =>
  resolveProviderLimit('nim', { requestsPerWindow: 30, windowMs: 60_000, ...over })

describe('Gate immediate admission', () => {
  test('admits while the burst allowance lasts', async () => {
    const scheduler = new ManualScheduler()
    const gate = new Gate(nim({ burstSize: 3 }), scheduler)

    for (let i = 0; i < 3; i++) {
      assert.deepEqual(await gate.acquire(), { kind: 'granted', waitedMs: 0 })
    }
    assert.equal(gate.snapshot().depth, 0, 'a granted request never touched the queue')
  })

  test('the first exhausted request queues rather than failing', async () => {
    const scheduler = new ManualScheduler()
    const gate = new Gate(nim({ burstSize: 1 }), scheduler)

    assert.deepEqual(await gate.acquire(), { kind: 'granted', waitedMs: 0 })
    const queued = gate.acquire()
    await scheduler.settle()
    assert.equal(gate.snapshot().depth, 1, 'the request is waiting, not refused')
    assert.equal(gate.snapshot().nextTokenMs, 2000)

    scheduler.advance(2000)
    assert.deepEqual(await queued, { kind: 'granted', waitedMs: 2000 })
  })

  test('onExhausted reject fails fast without queueing', async () => {
    const scheduler = new ManualScheduler()
    const gate = new Gate(nim({ burstSize: 1, onExhausted: 'reject' }), scheduler)

    assert.deepEqual(await gate.acquire(), { kind: 'granted', waitedMs: 0 })
    assert.deepEqual(
      await gate.acquire(),
      { kind: 'refused', reason: 'on-exhausted' },
    )
    assert.equal(gate.snapshot().depth, 0, 'a refused request leaves no trace')
  })

  test('maxWaitMs 0 makes every exhausted request refuse', async () => {
    const scheduler = new ManualScheduler()
    const gate = new Gate(nim({ burstSize: 1, maxWaitMs: 0 }), scheduler)

    await gate.acquire()
    assert.deepEqual(await gate.acquire(), { kind: 'refused', reason: 'wait-timeout' })
  })
})

describe('Gate FIFO order', () => {
  test('releases in arrival order, one token per interval', async () => {
    const scheduler = new ManualScheduler()
    // burstSize 1 drains instantly, so every later request must queue.
    const gate = new Gate(nim({ burstSize: 1 }), scheduler)
    await gate.acquire()

    const order: number[] = []
    const waits: number[] = []
    const settled: Array<Promise<void>> = []
    for (let i = 1; i <= 4; i++) {
      settled.push(gate.acquire().then((outcome) => {
        order.push(i)
        if (outcome.kind === 'granted') waits.push(outcome.waitedMs)
      }))
    }
    await scheduler.settle()
    assert.deepEqual(order, [], 'nobody is served while the bucket is empty')

    // One token every 2000ms, granted strictly in arrival order.
    for (let tick = 1; tick <= 4; tick++) {
      scheduler.advance(2000)
      await scheduler.settle()
    }
    await Promise.all(settled)

    assert.deepEqual(order, [1, 2, 3, 4], 'arrival order is preserved exactly')
    assert.deepEqual(waits, [2000, 4000, 6000, 8000], 'each waits one more interval than the last')
  })

  test('a late arrival never overtakes a queued request', async () => {
    const scheduler = new ManualScheduler()
    const gate = new Gate(nim({ burstSize: 1 }), scheduler)
    await gate.acquire()

    const first = gate.acquire().then(o => (o.kind === 'granted' ? 'first' : o.kind))
    await scheduler.settle()
    // A token frees up before the first request is served.
    scheduler.advance(2000)
    await scheduler.settle()
    const second = gate.acquire().then(o => (o.kind === 'granted' ? 'second' : o.kind))
    await scheduler.settle()

    assert.equal(await first, 'first', 'the earlier request took the token that arrived')
    assert.equal(gate.snapshot().depth, 1, 'the late arrival is still queued behind it')
    scheduler.advance(2000)
    await scheduler.settle()
    assert.equal(await second, 'second')
  })

  test('concurrent arrivals are served one per interval, not all at once', async () => {
    const scheduler = new ManualScheduler()
    const gate = new Gate(nim({ burstSize: 1 }), scheduler)
    await gate.acquire()

    const results: AcquireOutcome[] = []
    const pending = Array.from({ length: 5 }, () =>
      gate.acquire().then((outcome) => { results.push(outcome) }))

    // Grant one interval's worth; exactly one request may be released.
    scheduler.advance(2000)
    await scheduler.settle()
    assert.equal(results.length, 1, 'a simultaneous release would defeat the limiter')

    scheduler.advance(10_000)
    await scheduler.settle()
    await Promise.all(pending)
    assert.equal(results.length, 5, 'all five are eventually served')
  })
})

describe('Gate queue bounds', () => {
  test('refuses beyond maxQueueDepth without disturbing the queue', async () => {
    const scheduler = new ManualScheduler()
    const gate = new Gate(nim({ burstSize: 1, maxQueueDepth: 2 }), scheduler)
    await gate.acquire()

    const first = gate.acquire()
    const second = gate.acquire()
    await scheduler.settle()
    assert.equal(gate.snapshot().depth, 2)

    assert.deepEqual(
      await gate.acquire(),
      { kind: 'refused', reason: 'queue-full' },
      'the third arrival has nowhere to wait',
    )
    assert.equal(gate.snapshot().depth, 2, 'the queue still holds exactly the two admitted')

    scheduler.advance(4000)
    await scheduler.settle()
    assert.deepEqual(await first, { kind: 'granted', waitedMs: 2000 })
    assert.deepEqual(await second, { kind: 'granted', waitedMs: 4000 })
  })

  test('refuses a request whose budget expires before its turn', async () => {
    const scheduler = new ManualScheduler()
    // One token per 1000ms (60/min), burstSize 1, maxWaitMs 2500. All three
    // requests enqueue at t=0, so the third has already spent its whole budget
    // by the time it reaches the front and must fail rather than wait on.
    const gate = new Gate(nim({ requestsPerWindow: 60, windowMs: 60_000, burstSize: 1, maxWaitMs: 2500 }), scheduler)
    await gate.acquire()

    const first = gate.acquire()
    const second = gate.acquire()
    const third = gate.acquire()
    await scheduler.settle()

    scheduler.advance(1000)
    await scheduler.settle()
    assert.deepEqual(await first, { kind: 'granted', waitedMs: 1000 })

    scheduler.advance(1000)
    await scheduler.settle()
    assert.deepEqual(await second, { kind: 'granted', waitedMs: 2000 })

    // Third is now head at t=2000 with 2000ms waited, still inside budget, but
    // the bucket is empty again. At t=3000 its wait hits the 2500ms budget.
    scheduler.advance(1000)
    await scheduler.settle()
    assert.deepEqual(
      await third,
      { kind: 'refused', reason: 'wait-timeout' },
      'a request that cannot be served within its budget fails instead of waiting forever',
    )
    assert.equal(gate.snapshot().depth, 0)
  })

  test('a refused arrival does not consume a token', async () => {
    const scheduler = new ManualScheduler()
    const gate = new Gate(nim({ burstSize: 2, maxQueueDepth: 0 }), scheduler)

    await gate.acquire()
    await gate.acquire()
    assert.deepEqual(await gate.acquire(), { kind: 'refused', reason: 'queue-full' })
    // The bucket is untouched, so the next interval's single token is intact
    // and is handed over with no wait at all.
    scheduler.advance(2000)
    assert.deepEqual(await gate.acquire(), { kind: 'granted', waitedMs: 0 })
  })
})

describe('Gate cancellation', () => {
  test('an aborted wait settles as aborted and leaves the queue', async () => {
    const scheduler = new ManualScheduler()
    const gate = new Gate(nim({ burstSize: 1 }), scheduler)
    await gate.acquire()

    const controller = new AbortController()
    const queued = gate.acquire(controller.signal)
    await scheduler.settle()
    assert.equal(gate.snapshot().depth, 1)

    controller.abort()
    assert.deepEqual(await queued, { kind: 'aborted' })
    assert.equal(gate.snapshot().depth, 0, 'the aborted waiter left the queue')
  })

  test('an already-aborted signal never queues', async () => {
    const scheduler = new ManualScheduler()
    const gate = new Gate(nim({ burstSize: 1 }), scheduler)
    await gate.acquire()

    assert.deepEqual(await gate.acquire(AbortSignal.abort()), { kind: 'aborted' })
    assert.equal(gate.snapshot().depth, 0)
  })

  test('aborting the head promotes the next request', async () => {
    const scheduler = new ManualScheduler()
    const gate = new Gate(nim({ burstSize: 1 }), scheduler)
    await gate.acquire()

    const controller = new AbortController()
    const head = gate.acquire(controller.signal)
    const next = gate.acquire()
    await scheduler.settle()
    assert.equal(gate.snapshot().depth, 2)

    controller.abort()
    assert.deepEqual(await head, { kind: 'aborted' })

    // The promoted request is now first, so the next token goes to it.
    scheduler.advance(2000)
    await scheduler.settle()
    const outcome = await next
    assert.equal(outcome.kind, 'granted')
    assert.equal(outcome.kind === 'granted' ? outcome.waitedMs : -1, 2000)
  })

  test('aborting after a grant does not change the settled outcome', async () => {
    const scheduler = new ManualScheduler()
    const gate = new Gate(nim({ burstSize: 1 }), scheduler)
    const controller = new AbortController()

    assert.deepEqual(await gate.acquire(controller.signal), { kind: 'granted', waitedMs: 0 })
    controller.abort()
    await scheduler.settle()
    assert.equal(gate.snapshot().depth, 0, 'a late abort on a settled waiter is inert')
  })
})

describe('Gate disposal', () => {
  test('disposal refuses everything queued', async () => {
    const scheduler = new ManualScheduler()
    const gate = new Gate(nim({ burstSize: 1 }), scheduler)
    await gate.acquire()

    const first = gate.acquire()
    const second = gate.acquire()
    await scheduler.settle()

    gate.dispose()
    assert.deepEqual(await first, { kind: 'refused', reason: 'disposed' })
    assert.deepEqual(await second, { kind: 'refused', reason: 'disposed' })
    assert.equal(gate.snapshot().depth, 0)
  })

  test('a disposed gate admits nothing further', async () => {
    const scheduler = new ManualScheduler()
    const gate = new Gate(nim({ burstSize: 5 }), scheduler)
    gate.dispose()
    assert.deepEqual(await gate.acquire(), { kind: 'refused', reason: 'disposed' })
  })

  test('disposal cancels the pending timer', async () => {
    const scheduler = new ManualScheduler()
    const gate = new Gate(nim({ burstSize: 1 }), scheduler)
    await gate.acquire()
    void gate.acquire()
    await scheduler.settle()
    assert.equal(scheduler.pendingTimers, 1, 'a grant was scheduled')

    gate.dispose()
    assert.equal(scheduler.pendingTimers, 0, 'nothing is left armed after disposal')
  })

  test('disposal is idempotent', async () => {
    const scheduler = new ManualScheduler()
    const gate = new Gate(nim(), scheduler)
    gate.dispose()
    gate.dispose()
    assert.equal(gate.snapshot().disposed, true)
  })
})

describe('Gate timer hygiene', () => {
  test('holds at most one timer however many waiters queue', async () => {
    const scheduler = new ManualScheduler()
    const gate = new Gate(nim({ burstSize: 1 }), scheduler)
    await gate.acquire()

    const pending = Array.from({ length: 6 }, () => gate.acquire())
    await scheduler.settle()
    assert.equal(scheduler.pendingTimers, 1, 'one timer serves the whole queue')

    scheduler.advance(12_000)
    await scheduler.settle()
    await Promise.all(pending)
  })

  test('arms no timer once the queue drains', async () => {
    const scheduler = new ManualScheduler()
    const gate = new Gate(nim({ burstSize: 1 }), scheduler)
    await gate.acquire()
    const queued = gate.acquire()
    await scheduler.settle()
    assert.equal(scheduler.pendingTimers, 1)

    scheduler.advance(2000)
    await scheduler.settle()
    assert.equal(scheduler.pendingTimers, 0, 'an empty queue needs no timer')
    assert.deepEqual(await queued, { kind: 'granted', waitedMs: 2000 })
  })
})

describe('Gate snapshot', () => {
  test('reports the queue depth and the head wait', async () => {
    const scheduler = new ManualScheduler()
    const gate = new Gate(nim({ burstSize: 1 }), scheduler)
    await gate.acquire()

    assert.deepEqual(gate.snapshot(), { route: 'nim', depth: 0, nextTokenMs: 0, disposed: false })

    void gate.acquire()
    await scheduler.settle()
    const queued = gate.snapshot()
    assert.equal(queued.depth, 1)
    assert.equal(queued.nextTokenMs, 2000)
    assert.equal(queued.route, 'nim')
  })

  test('is immutable so a UI cannot edit live gate state', () => {
    const scheduler = new ManualScheduler()
    const gate = new Gate(nim(), scheduler)
    assert.throws(() => {
      ;(gate.snapshot() as { depth: number }).depth = 99
    }, TypeError)
  })
})