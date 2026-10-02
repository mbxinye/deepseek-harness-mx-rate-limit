/**
 * Token-bucket request limiting for DeepSeek Harness model calls.
 *
 * The plugin intercepts `llm/stream`, the waterfall every model call passes
 * through, and admits requests through a per-route FIFO gate in front of a token
 * bucket. Queuing is the point: a request that waits is one the provider never
 * sees, so the limiter prevents the 429 instead of reacting to it.
 *
 * It is the preventive half of a pair. `@deepseek-ai/dsh-llm-retry` is the
 * reactive half and already retries `RATE_LIMIT`; the terminal chunk this plugin
 * emits carries `providerRetryAfterMs` so a refusal that still happens hands
 * over to that executor rather than duplicating its backoff.
 *
 * @module dsh-llm-rate-limit
 */
import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import { Config } from './config.ts';
import type { GateScheduler, GateSnapshot } from './gate.ts';
export type { Options, PlainConfig, ProviderRateLimit, PurposeScope, ResolvedProviderLimit, } from './config.ts';
export { Config, DEFAULT_MAX_QUEUE_DEPTH, DEFAULT_MAX_WAIT_MS, DEFAULT_REQUESTS_PER_WINDOW, DEFAULT_WINDOW_MS, limitForRoute, plainConfig, resolveProviderLimit, } from './config.ts';
export { TokenBucket, MAX_TIMER_DELAY_MS } from './bucket.ts';
export { Gate, defaultScheduler } from './gate.ts';
export type { AcquireOutcome, GateScheduler, GateSnapshot, RefusalReason } from './gate.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** The mounted rate limiter, readable so a UI can show queue depth. */
        llmRateLimit: RateLimiter;
    }
}
/** Non-serializable hooks that make queue timing deterministic in tests. */
export interface RateLimiterInternals {
    /** Clock and timer for every gate this instance creates. */
    scheduler?: GateScheduler;
}
/** A route's live queue state, for a settings page or a diagnostic. */
export interface RouteSnapshot extends GateSnapshot {
    /** Sustained rate the route is held to. */
    readonly requestsPerWindow: number;
    readonly windowMs: number;
}
/**
 * Rate limiting for model calls, exposed as a service so a UI can read queue depth.
 *
 * Mount this after `llm` and any provider adapter. It is inert until a route is
 * named in `providers`: the dict is a whitelist, so enabling the plugin for one
 * free tier never slows the paid route beside it.
 */
export declare class RateLimiter extends Service {
    private readonly config;
    /** The model service whose waterfall this plugin wraps. */
    static inject: string[];
    /** Configuration schema; every field is volatile so the UI can edit it live. */
    static Config: import("@deepseek-ai/schemastery").default<import("./config.ts").Options, Config>;
    private readonly gates;
    /** Aborted on disposal so queued requests fail fast instead of hanging. */
    private readonly lifetime;
    private readonly scheduler;
    /**
     * @param ctx - plugin context owning the listener and the live gates.
     * @param config - validated configuration; volatile fields are read per request.
     * @param internals - non-serializable deterministic hooks for tests.
     */
    constructor(ctx: Context, config: Config, internals?: RateLimiterInternals);
    /**
     * Resolve the route's gate, rebuilding it when its profile changed.
     *
     * Called on every request rather than once at mount, because a volatile field
     * can be edited from the settings UI without a remount and a gate pinned to a
     * stale profile would keep applying the old policy.
     * @param options - the model request naming the route.
     * @returns the gate to admit through, or undefined when nothing limits it.
     */
    private admit;
    /**
     * Wrap one request in its route's admission wait.
     *
     * The wait lives inside the generator rather than in the listener, because
     * `llm/stream` is a waterfall that is *not* awaited: a listener returning a
     * promise would break the declared `AsyncIterable<StreamChunk>` and the
     * `LlmRuntime.stream()` return type. A synchronously created generator keeps
     * the wait lazy and the contract intact.
     * @param options - the request being admitted.
     * @param next - the downstream `llm/stream` chain.
     * @param entry - the gate serving this route.
     * @returns a stream that yields the provider's chunks once a token is held.
     */
    private gated;
    /**
     * Read every live route's queue state.
     * @returns detached snapshots keyed by route id, in mount order.
     */
    snapshots(): Map<string, RouteSnapshot>;
}
export default RateLimiter;
//# sourceMappingURL=index.d.ts.map