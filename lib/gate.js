/**
 * Per-route admission queue in front of one token bucket.
 *
 * The queue exists because a bucket alone is not enough. If every waiter polled
 * it independently, N requests arriving together would each compute nearly the
 * same remaining delay and be released in the same instant — a burst that is
 * exactly what the limiter is meant to prevent. Granting tokens in arrival
 * order instead holds the release rate at exactly `requestsPerWindow /
 * windowMs`, so a saturated route hands out one request per interval no matter
 * how many are waiting.
 *
 * @module dsh-llm-rate-limit/gate
 */
import { TokenBucket } from "./bucket.js";
/**
 * The default scheduler: a monotonic clock with Node timers.
 *
 * @returns a scheduler backed by `performance.now()` and `setTimeout`.
 */
export function defaultScheduler() {
    return {
        now: () => performance.now(),
        schedule: (fn, ms) => {
            const timer = setTimeout(fn, ms);
            return () => { clearTimeout(timer); };
        },
    };
}
/** One route's limiter: a token bucket behind a FIFO admission queue. */
export class Gate {
    /** The route this gate limits; a bucket and a queue serve exactly one route. */
    route;
    limit;
    scheduler;
    bucket;
    queue = [];
    /** Cancels the one pending grant timer, if any. */
    cancelPending;
    /** Reentrancy guard: a nested pump records intent instead of recursing. */
    pumping = false;
    pumpRequested = false;
    disposed = false;
    /**
     * @param limit - resolved profile owning the rate, burst, and bounds.
     * @param scheduler - clock and timer; defaults to the monotonic real one.
     */
    constructor(limit, scheduler = defaultScheduler()) {
        this.route = limit.route;
        this.limit = limit;
        this.scheduler = scheduler;
        this.bucket = new TokenBucket({ capacity: limit.burstSize, refillPerMs: limit.requestsPerWindow / limit.windowMs }, scheduler.now());
    }
    /**
     * Ask for one token, waiting in line behind earlier requests.
     *
     * A free token is taken only when nobody is queued, which is what keeps the
     * order fair: a late arrival never overtakes a request that is already
     * waiting, even in the instant a token happens to be free.
     * @param signal - cancellation for the wait; absent means uninterruptible.
     * @returns how the request was settled.
     */
    acquire(signal) {
        if (this.disposed)
            return Promise.resolve({ kind: 'refused', reason: 'disposed' });
        if (signal?.aborted === true)
            return Promise.resolve({ kind: 'aborted' });
        const now = this.scheduler.now();
        if (this.queue.length === 0 && this.bucket.tryAcquire(now)) {
            return Promise.resolve({ kind: 'granted', waitedMs: 0 });
        }
        // Every refusal below happens before anything is queued, so a refused
        // request leaves no trace on the queue or the bucket.
        if (this.limit.onExhausted === 'reject') {
            return Promise.resolve({ kind: 'refused', reason: 'on-exhausted' });
        }
        if (this.limit.maxWaitMs === 0 || this.queue.length >= this.limit.maxQueueDepth) {
            return Promise.resolve({
                kind: 'refused',
                reason: this.limit.maxWaitMs === 0 ? 'wait-timeout' : 'queue-full',
            });
        }
        return new Promise((resolve) => {
            const waiter = { enqueuedAt: now, resolve, signal, onAbort: undefined };
            if (signal !== undefined) {
                waiter.onAbort = () => {
                    const index = this.queue.indexOf(waiter);
                    // Already granted and settled: leave the outcome alone.
                    if (index < 0)
                        return;
                    this.queue.splice(index, 1);
                    this.settle(waiter, { kind: 'aborted' });
                    // The head moved, so whoever is now first may already be grantable.
                    this.pump();
                };
                signal.addEventListener('abort', waiter.onAbort, { once: true });
            }
            this.queue.push(waiter);
            this.pump();
        });
    }
    /**
     * Detach a waiter's abort listener and hand it its outcome.
     *
     * Settlement never rejects: an aborted or timed-out request is a settled
     * outcome the caller routes on, not an exception thrown across the waterfall.
     */
    settle(waiter, outcome) {
        if (waiter.signal !== undefined && waiter.onAbort !== undefined) {
            waiter.signal.removeEventListener('abort', waiter.onAbort);
            waiter.onAbort = undefined;
        }
        waiter.resolve(outcome);
    }
    /**
     * Grant tokens to as many queued requests as the bucket allows, in order.
     *
     * Refuses any head that has spent its whole wait budget first, so a request
     * that cannot be served in time fails instead of holding the line behind it.
     */
    drain() {
        for (;;) {
            const head = this.queue[0];
            if (head === undefined)
                return;
            const now = this.scheduler.now();
            if (now - head.enqueuedAt >= this.limit.maxWaitMs) {
                this.queue.shift();
                this.settle(head, { kind: 'refused', reason: 'wait-timeout' });
                continue;
            }
            if (!this.bucket.tryAcquire(now))
                return;
            this.queue.shift();
            this.settle(head, { kind: 'granted', waitedMs: now - head.enqueuedAt });
        }
    }
    /**
     * Run one drain pass and re-arm the grant timer.
     *
     * A nested call only records that another pass is owed. `drain` settles
     * waiters, and settling a promise can in principle re-enter through an abort
     * listener, so the loop is bounded rather than recursive.
     */
    pump() {
        if (this.pumping) {
            this.pumpRequested = true;
            return;
        }
        this.pumping = true;
        try {
            do {
                this.pumpRequested = false;
                this.drain();
            } while (this.pumpRequested);
        }
        finally {
            this.pumping = false;
        }
        this.arm();
    }
    /**
     * Hold at most one timer, set for the moment the head becomes grantable.
     *
     * The delay is floored at 1ms because the bucket answers sub-millisecond when
     * a token is nearly there, and a zero-delay timer would spin instead of wait.
     */
    arm() {
        this.cancelPending?.();
        this.cancelPending = undefined;
        if (this.disposed || this.queue.length === 0)
            return;
        const delay = Math.max(1, this.bucket.waitMs(this.scheduler.now()));
        this.cancelPending = this.scheduler.schedule(() => {
            this.cancelPending = undefined;
            this.pump();
        }, delay);
    }
    /**
     * Read the queue without disturbing it.
     * @returns queue depth, the head's wait, and whether the gate is disposed.
     */
    snapshot() {
        return Object.freeze({
            route: this.route,
            depth: this.queue.length,
            nextTokenMs: this.queue.length === 0 ? 0 : Math.max(0, this.bucket.waitMs(this.scheduler.now())),
            disposed: this.disposed,
        });
    }
    /**
     * Refuse everything queued and admit nothing further.
     *
     * Called from the plugin's dispose effect, so an unload does not leave a
     * caller waiting on a gate that will never grant. Queued waiters settle as
     * `disposed` rather than `aborted`, because no request of theirs asked to stop.
     */
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.cancelPending?.();
        this.cancelPending = undefined;
        for (const waiter of this.queue.splice(0)) {
            this.settle(waiter, { kind: 'refused', reason: 'disposed' });
        }
    }
}
//# sourceMappingURL=gate.js.map