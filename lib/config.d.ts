/**
 * Rate-limit configuration: per-provider profiles keyed by route id, plus the
 * defaults each profile resolves to.
 *
 * The `providers` dict is a whitelist — only routes named here are limited — so
 * a paid route sharing the process is never slowed down by a free tier's budget.
 * Every field is `volatile`, which is what puts this plugin on a settings page:
 * the host projects a form from the volatile subtree of a plugin's `Config` and
 * writes edits straight back into the profile patch, with no remount.
 *
 * @module dsh-llm-rate-limit/config
 */
import type { Volatile } from '@deepseek-ai/cosmokit';
import z from '@deepseek-ai/schemastery';
/**
 * Sustained request rate used when a profile names none.
 *
 * Deliberately the LOWEST free-tier rate in `PROVIDER_QUOTAS` rather than a
 * middle guess, because the two failure directions are not symmetric: a limit
 * set too high is the 429 this plugin exists to prevent, while one set too low
 * is merely slower. The page pre-fills the documented per-route rate instead, so
 * this only applies to a route nobody configured — where slow is the right
 * failure.
 */
export declare const DEFAULT_REQUESTS_PER_WINDOW = 10;
/**
 * Free-tier request quotas this plugin has evidence for, as documented limits
 * rather than local tuning knobs.
 *
 * The page pre-fills from here, because the number is a property of the
 * provider's offer, not a preference. Each entry records where the figure came
 * from and when, since these move: Agnes halved its free text quota on
 * 2026-06-22, which is exactly why a stale hardcoded number is dangerous and
 * why the page shows the source rather than presenting the figure as fact.
 */
export declare const PROVIDER_QUOTAS: Readonly<Record<string, {
    /** Documented requests per minute for a free key. */
    readonly rpm: number;
    /** Where the figure is documented, shown beside it. */
    readonly source: string;
    /** When that source last stated the figure. */
    readonly asOf: string;
}>>;
/** Window length used when a profile names none. Every quota above is per minute. */
export declare const DEFAULT_WINDOW_MS = 60000;
/**
 * What one provider's profile accepts.
 *
 * Two fields. Everything else this plugin once offered was a bound on how long a
 * request would wait, and every one of them produced a `RATE_LIMIT` failure —
 * which `dsh-llm-retry` treats as retryable by default
 * (`DEFAULT_RETRYABLE_CODES` in `packages/llm/llm/src/retry-policy.ts`), up to
 * five times with backoff. So a queue bound did not shed load, it fed it: each
 * refusal became another request competing for the same quota. Waiting is
 * strictly better, and it is safe — a token bucket at `requestsPerWindow > 0`
 * guarantees a token within one window, so an unbounded wait is still finite.
 *
 * `windowMs` and `burstSize` stay writable for cases no free tier documents: a
 * daily quota needs the former, a genuinely bursty quota the latter.
 */
export interface ProviderRateLimit {
    /** Limit this route without deleting the rest of its profile. */
    enabled?: boolean;
    /** Sustained requests permitted per window. */
    requestsPerWindow?: number;
    /** Window length in milliseconds. */
    windowMs?: number;
    /**
     * Bucket capacity, which is the burst allowance. Omission adopts
     * `requestsPerWindow`, so a profile permits the whole quota as one burst —
     * the shape NIM's "30 per minute" actually means.
     */
    burstSize?: number;
}
/** Which model-request classes draw on the same budget. */
export type PurposeScope = 
/** Only ordinary conversation requests. Compaction and title calls bypass it. */
'conversation'
/** Every model call on the route, including auxiliary ones. */
 | 'all';
/** What a user writes in the profile patch; every field is optional. */
export interface Options {
    /** Per-route profiles keyed by provider route id; empty limits nothing. */
    providers?: Record<string, ProviderRateLimit>;
    /** Whether auxiliary compaction and session-title calls share the budget. */
    purposeScope?: PurposeScope;
    /** Park every route without deleting the profiles. */
    enabled?: boolean;
}
/**
 * Plugin configuration as the host hands it over: volatile fields are live
 * references, so a settings edit is visible without remounting.
 */
export interface Config {
    providers: Volatile<Record<string, ProviderRateLimit>>;
    purposeScope: Volatile<PurposeScope>;
    enabled: Volatile<boolean>;
}
/** The configuration as plain data, with every volatile reference read through. */
export interface PlainConfig {
    providers: Record<string, ProviderRateLimit>;
    purposeScope: PurposeScope;
    enabled: boolean;
}
/**
 * Read one configuration snapshot, resolving every volatile reference.
 *
 * A volatile field is a live reference rather than a value, so a caller that
 * read it once would keep a stale snapshot across a settings edit. Detaching
 * per request is what makes an edit take effect on the next model call.
 * @param config - configuration as the host produced it.
 * @returns the same configuration as ordinary values.
 */
export declare function plainConfig(config: Config): PlainConfig;
/** A profile with every default resolved, ready to build a bucket and queue. */
export interface ResolvedProviderLimit {
    readonly route: string;
    readonly enabled: boolean;
    readonly requestsPerWindow: number;
    readonly windowMs: number;
    readonly burstSize: number;
}
/**
 * Runtime schema for {@link Config}.
 *
 * `volatile` on each field is what makes this editable from the UI: the settings
 * service keeps only the volatile subtree of a plugin's schema, so a config
 * without it would contribute no page at all.
 */
export declare const Config: z<Options, Config>;
/**
 * Resolve one stored profile into every field a gate needs.
 *
 * The profile is re-validated here because this is also the entry point for a
 * caller holding plain values rather than a parsed section. No rate-domain
 * recheck is needed afterwards: with `requestsPerWindow >= 1` and
 * `windowMs <= MAX_TIMER_DELAY_MS` the slowest admissible rate still yields a
 * token within one timer, so the bucket's own bound cannot be violated.
 * @param route - provider route id; the dict key, which is the route itself.
 * @param profile - profile for this route; defaults apply to absent fields.
 * @returns an immutable resolved limit.
 */
export declare function resolveProviderLimit(route: string, profile?: ProviderRateLimit): ResolvedProviderLimit;
/**
 * Resolve the profile for one route, or `undefined` when the route is not limited.
 *
 * The whitelist is the whole point: an unnamed route is unlimited, so enabling
 * this plugin for NIM cannot slow the paid route beside it.
 * @param config - resolved plugin configuration.
 * @param route - provider route id taken from the model request.
 * @returns the resolved limit, or undefined when the route is absent or disabled.
 */
export declare function limitForRoute(config: Pick<PlainConfig, 'providers' | 'enabled'>, route: string): ResolvedProviderLimit | undefined;
//# sourceMappingURL=config.d.ts.map