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
import z from '@deepseek-ai/schemastery';
import { MAX_TIMER_DELAY_MS } from "./bucket.js";
/** Sustained request rate used when a profile names none. Matches NIM's free tier. */
export const DEFAULT_REQUESTS_PER_WINDOW = 30;
/** Window length used when a profile names none. One minute is the common quota shape. */
export const DEFAULT_WINDOW_MS = 60_000;
/**
 * Queued requests tolerated per route before new arrivals are refused.
 *
 * Bounded because the harness's own concurrency limits bound the sources rather
 * than this queue: `maxActiveSubagents` (8) refuses rather than queues, and each
 * agent step issues model requests serially, so real depth stays in the tens.
 * At NIM's 30/min, 16 deep is ~32s worst case — noticeably slower, not hung.
 */
export const DEFAULT_MAX_QUEUE_DEPTH = 16;
/**
 * Longest a single request may wait for a token.
 *
 * Aligned with the default window: waiting a full window always earns a token,
 * so a longer wait means concurrency far exceeded expectation and failing beats
 * hanging. Zero disables waiting entirely, making every exhausted route refuse.
 */
export const DEFAULT_MAX_WAIT_MS = 60_000;
/**
 * Read one configuration snapshot, resolving every volatile reference.
 *
 * A volatile field is a live reference rather than a value, so a caller that
 * read it once would keep a stale snapshot across a settings edit. Detaching
 * per request is what makes an edit take effect on the next model call.
 * @param config - configuration as the host produced it.
 * @returns the same configuration as ordinary values.
 */
export function plainConfig(config) {
    return {
        providers: config.providers.get(),
        purposeScope: config.purposeScope.get(),
        enabled: config.enabled.get(),
    };
}
const providerProfile = z.object({
    enabled: z.boolean().default(true),
    requestsPerWindow: z.number().step(1).min(1).max(100_000).default(DEFAULT_REQUESTS_PER_WINDOW),
    windowMs: z.number().step(1).min(100).max(MAX_TIMER_DELAY_MS).default(DEFAULT_WINDOW_MS),
    burstSize: z.number().step(1).min(1).max(100_000),
    onExhausted: z.union(['wait', 'reject']).default('wait'),
    maxQueueDepth: z.number().step(1).min(0).default(DEFAULT_MAX_QUEUE_DEPTH),
    maxWaitMs: z.number().step(1).min(0).max(MAX_TIMER_DELAY_MS).default(DEFAULT_MAX_WAIT_MS),
});
/**
 * Runtime schema for {@link Config}.
 *
 * `volatile` on each field is what makes this editable from the UI: the settings
 * service keeps only the volatile subtree of a plugin's schema, so a config
 * without it would contribute no page at all.
 */
export const Config = z.object({
    providers: z.dict(providerProfile).default({}).volatile(),
    purposeScope: z.union(['conversation', 'all']).default('conversation').volatile(),
    enabled: z.boolean().default(true).volatile(),
});
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
export function resolveProviderLimit(route, profile = {}) {
    const resolved = providerProfile(profile);
    const requestsPerWindow = resolved.requestsPerWindow ?? DEFAULT_REQUESTS_PER_WINDOW;
    const windowMs = resolved.windowMs ?? DEFAULT_WINDOW_MS;
    return Object.freeze({
        route,
        enabled: resolved.enabled ?? true,
        requestsPerWindow,
        windowMs,
        // The whole quota as one burst: "30 per minute" means an average of 30 with
        // tolerance for a short spike, not a ban on any spike.
        burstSize: resolved.burstSize ?? requestsPerWindow,
        onExhausted: resolved.onExhausted ?? 'wait',
        maxQueueDepth: resolved.maxQueueDepth ?? DEFAULT_MAX_QUEUE_DEPTH,
        maxWaitMs: resolved.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
    });
}
/**
 * Resolve the profile for one route, or `undefined` when the route is not limited.
 *
 * The whitelist is the whole point: an unnamed route is unlimited, so enabling
 * this plugin for NIM cannot slow the paid route beside it.
 * @param config - resolved plugin configuration.
 * @param route - provider route id taken from the model request.
 * @returns the resolved limit, or undefined when the route is absent or disabled.
 */
export function limitForRoute(config, route) {
    if (config.enabled === false)
        return undefined;
    const profile = config.providers[route];
    if (profile === undefined)
        return undefined;
    const resolved = resolveProviderLimit(route, profile);
    return resolved.enabled ? resolved : undefined;
}
//# sourceMappingURL=config.js.map