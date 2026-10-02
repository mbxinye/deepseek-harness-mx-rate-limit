/**
 * One token bucket: sustained rate and burst capacity as independent dials.
 *
 * Refill is computed lazily from the elapsed monotonic clock, so an idle bucket
 * costs nothing and no timer is ever created. Every method takes the current
 * time as an argument rather than reading a clock itself, which keeps the
 * arithmetic pure and the tests free of fake-timer machinery.
 *
 * @module dsh-llm-rate-limit/bucket
 */
/** Largest delay Node schedules without clamping it to one millisecond. */
export declare const MAX_TIMER_DELAY_MS = 2147483647;
/** Construction parameters for a {@link TokenBucket}. */
export interface TokenBucketOptions {
    /**
     * Maximum tokens the bucket holds, which is also the burst allowance: an
     * idle client accumulates a full reservoir and may spend it at once.
     */
    readonly capacity: number;
    /** Tokens replenished per millisecond; must be positive and finite. */
    readonly refillPerMs: number;
}
/**
 * A token bucket over a caller-supplied monotonic clock.
 *
 * One bucket holds the whole rate for one route: `requestsPerWindow` and
 * `windowMs` arrive here already divided into a capacity and a per-millisecond
 * rate. The bucket owns no timer and no queue — granting tokens in arrival
 * order is the queue's job, because a bucket that let every waiter poll
 * independently would release them together as a burst.
 */
export declare class TokenBucket {
    /** Tokens this bucket holds at most. */
    readonly capacity: number;
    /** Tokens replenished per millisecond. */
    readonly refillPerMs: number;
    /** Tokens currently held, in `[0, capacity]`. */
    private tokens;
    /** Clock reading at the last refill; the base for the next elapsed span. */
    private updatedAt;
    /**
     * @param options - validated capacity and refill rate.
     * @param now - current monotonic reading; the bucket starts full, modelling a
     *   client that has just been idle and may burst up to its allowance.
     */
    constructor(options: TokenBucketOptions, now: number);
    /**
     * Add the tokens earned since the last refill, capped at capacity.
     *
     * A non-positive elapsed span is ignored rather than rewinding the base: the
     * clock is monotonic by contract, and a zero-length span must not manufacture
     * or destroy tokens.
     */
    private refill;
    /**
     * Read the tokens available at `now` without consuming any.
     * @param now - current monotonic reading.
     * @returns available tokens in `[0, capacity]`.
     */
    available(now: number): number;
    /**
     * Take one token if the bucket holds one at `now`.
     * @param now - current monotonic reading.
     * @returns whether a token was consumed.
     */
    tryAcquire(now: number): boolean;
    /**
     * Milliseconds until one token is available at `now`.
     *
     * Returns 0 when a token is already held. When one is not, the result is
     * floored at 1ms: a sub-millisecond answer would let a waiter re-poll in a
     * tight loop and still see an empty bucket, which is a spin, not a wait.
     * @param now - current monotonic reading.
     * @returns a non-negative delay in milliseconds.
     */
    waitMs(now: number): number;
}
//# sourceMappingURL=bucket.d.ts.map