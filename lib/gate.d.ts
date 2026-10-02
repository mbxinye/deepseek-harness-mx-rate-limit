/**
 * Per-route admission queue in front of one token bucket.
 *
 * The queue exists because a bucket alone is not enough. If every waiter polled
 * it independently, N requests arriving together would each compute nearly the
 * same remaining delay and be released in the same instant �?a burst that is
 * exactly what the limiter is meant to prevent. Granting tokens in arrival
 * order instead holds the release rate at exactly `requestsPerWindow /
 * windowMs`, so a saturated route hands out one request per interval no matter
 * how many are waiting.
 *
 * @module dsh-llm-rate-limit/gate
 */
import type { ResolvedProviderLimit } from './config.ts';
/**
 * Monotonic clock and timer, injected so tests drive time explicitly instead of
 * sleeping. The default reads `performance.now()`, which does not move backwards
 * the way `Date.now()` can.
 */
export interface GateScheduler {
    /** Current monotonic reading in milliseconds. */
    now(): number;
    /**
     * Run `fn` after `ms`.
     * @param fn - work to run once the delay elapses.
     * @param ms - non-negative delay in milliseconds.
     * @returns a canceller that prevents `fn` from running if called first.
     */
    schedule(fn: () => void, ms: number): () => void;
}
/** The result of asking a gate for a token. */
export type AcquireOutcome = {
    readonly kind: 'granted';
    readonly waitedMs: number;
} | {
    readonly kind: 'aborted';
};
/** Read-only view of one route's queue, for a settings page or a test. */
export interface GateSnapshot {
    readonly route: string;
    readonly depth: number;
    /** Milliseconds until the head can be granted; 0 when the queue is empty. */
    readonly nextTokenMs: number;
    readonly disposed: boolean;
}
/**
 * The default scheduler: a monotonic clock with Node timers.
 *
 * @returns a scheduler backed by `performance.now()` and `setTimeout`.
 */
export declare function defaultScheduler(): GateScheduler;
/** One route's limiter: a token bucket behind a FIFO admission queue. */
export declare class Gate {
    /** The route this gate limits; a bucket and a queue serve exactly one route. */
    readonly route: string;
    private readonly scheduler;
    private readonly bucket;
    private readonly queue;
    /** Cancels the one pending grant timer, if any. */
    private cancelPending;
    /** Reentrancy guard: a nested pump records intent instead of recursing. */
    private pumping;
    private pumpRequested;
    private disposed;
    /**
     * @param limit - resolved profile owning the rate and burst.
     * @param scheduler - clock and timer; defaults to the monotonic real one.
     */
    constructor(limit: ResolvedProviderLimit, scheduler?: GateScheduler);
    /**
     * Ask for one token, waiting in line behind earlier requests.
     *
     * A free token is taken only when nobody is queued, which is what keeps the
     * order fair: a late arrival never overtakes a request that is already
     * waiting, even in the instant a token happens to be free.
     * @param signal - cancellation for the wait; absent means uninterruptible.
     * @returns how the request was settled.
     */
    acquire(signal?: AbortSignal): Promise<AcquireOutcome>;
    /**
     * Detach a waiter's abort listener and hand it its outcome.
     *
     * Settlement never rejects: an aborted or timed-out request is a settled
     * outcome the caller routes on, not an exception thrown across the waterfall.
     */
    private settle;
    /**
     * Grant tokens to as many queued requests as the bucket allows, in order.
     *
     * No head is ever dropped for having waited too long. The bucket decides who
     * runs; a policy about how long is willing to wait would have to express itself
     * as a refusal, and a refusal is what this gate stopped producing.
     */
    private drain;
    /**
     * Run one drain pass and re-arm the grant timer.
     *
     * A nested call only records that another pass is owed. `drain` settles
     * waiters, and settling a promise can in principle re-enter through an abort
     * listener, so the loop is bounded rather than recursive.
     */
    private pump;
    /**
     * Hold at most one timer, set for the moment the head becomes grantable.
     *
     * The delay is floored at 1ms because the bucket answers sub-millisecond when
     * a token is nearly there, and a zero-delay timer would spin instead of wait.
     */
    private arm;
    /**
     * Read the queue without disturbing it.
     * @returns queue depth, the head's wait, and whether the gate is disposed.
     */
    snapshot(): GateSnapshot;
    /**
     * Refuse everything queued and admit nothing further.
     *
     * Called from the plugin's dispose effect, so an unload does not leave a
     * caller waiting on a gate that will never grant. Queued waiters settle as
     * `disposed` rather than `aborted`, because no request of theirs asked to stop.
     */
    dispose(): void;
}
//# sourceMappingURL=gate.d.ts.map