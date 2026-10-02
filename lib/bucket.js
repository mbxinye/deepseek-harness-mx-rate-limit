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
export const MAX_TIMER_DELAY_MS = 2_147_483_647;
/**
 * Reject a bucket that could never admit a request or could outlast any timer.
 * @param options - candidate capacity and refill rate.
 * @throws {TypeError} when a field is outside its domain.
 * @throws {RangeError} when the rate cannot yield a token within any delay Node honors.
 */
function assertOptions(options) {
    const { capacity, refillPerMs } = options;
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
        throw new TypeError(`token bucket capacity must be a positive safe integer, got ${String(capacity)}`);
    }
    if (!Number.isFinite(refillPerMs) || refillPerMs <= 0) {
        throw new TypeError(`token bucket refillPerMs must be a positive finite number, got ${String(refillPerMs)}`);
    }
    // A rate this slow cannot produce one token inside any delay Node honors, so
    // a waiter would hang past every bound instead of being refused up front.
    if (1 / refillPerMs > MAX_TIMER_DELAY_MS) {
        throw new RangeError(`token bucket refillPerMs ${String(refillPerMs)} cannot produce a token within ${String(MAX_TIMER_DELAY_MS)}ms`);
    }
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
export class TokenBucket {
    /** Tokens this bucket holds at most. */
    capacity;
    /** Tokens replenished per millisecond. */
    refillPerMs;
    /** Tokens currently held, in `[0, capacity]`. */
    tokens;
    /** Clock reading at the last refill; the base for the next elapsed span. */
    updatedAt;
    /**
     * @param options - validated capacity and refill rate.
     * @param now - current monotonic reading; the bucket starts full, modelling a
     *   client that has just been idle and may burst up to its allowance.
     */
    constructor(options, now) {
        assertOptions(options);
        this.capacity = options.capacity;
        this.refillPerMs = options.refillPerMs;
        this.tokens = options.capacity;
        this.updatedAt = now;
    }
    /**
     * Add the tokens earned since the last refill, capped at capacity.
     *
     * A non-positive elapsed span is ignored rather than rewinding the base: the
     * clock is monotonic by contract, and a zero-length span must not manufacture
     * or destroy tokens.
     */
    refill(now) {
        const elapsed = now - this.updatedAt;
        if (elapsed <= 0)
            return;
        this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
        this.updatedAt = now;
    }
    /**
     * Read the tokens available at `now` without consuming any.
     * @param now - current monotonic reading.
     * @returns available tokens in `[0, capacity]`.
     */
    available(now) {
        this.refill(now);
        return this.tokens;
    }
    /**
     * Take one token if the bucket holds one at `now`.
     * @param now - current monotonic reading.
     * @returns whether a token was consumed.
     */
    tryAcquire(now) {
        this.refill(now);
        if (this.tokens < 1)
            return false;
        this.tokens -= 1;
        return true;
    }
    /**
     * Milliseconds until one token is available at `now`.
     *
     * Returns 0 when a token is already held. When one is not, the result is
     * floored at 1ms: a sub-millisecond answer would let a waiter re-poll in a
     * tight loop and still see an empty bucket, which is a spin, not a wait.
     * @param now - current monotonic reading.
     * @returns a non-negative delay in milliseconds.
     */
    waitMs(now) {
        this.refill(now);
        if (this.tokens >= 1)
            return 0;
        return Math.max(1, Math.ceil((1 - this.tokens) / this.refillPerMs));
    }
}
//# sourceMappingURL=bucket.js.map