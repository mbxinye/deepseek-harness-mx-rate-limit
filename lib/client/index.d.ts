/**
 * The rate limit settings page, browser half.
 *
 * Registered into the Plugins page's `plugins.item` slot while the Host serves
 * the `llm-rate-limit` namespace, so a deployment that has not mounted this
 * plugin shows no trace of it.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type RateLimitLocaleKey } from './locales.ts';
export type { RateLimitCardProps } from './RateLimitCard.tsx';
export type { CardActions, CardShell, CardState, CardStateStore, FieldState, ProviderProfile, RateLimitCardFace, RateLimitScope, RateLimitSection, } from './model.ts';
export type { RateLimitLocaleKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Rate limit settings page copy. */
        'settings.rateLimit': RateLimitLocaleKey;
    }
}
/** Dictionary namespace owned by this plugin. */
export declare const NS = "settings.rateLimit";
/** Required services (cordis fiber inject). */
export declare const inject: string[];
/**
 * Mount the rate limit settings page while the Host serves its namespace.
 * @param ctx - the browser plugin context.
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map