/** Locale bundles for the rate limit page. */
import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives';
/** Locale keys the page renders. */
export type RateLimitLocaleKey = 'title' | 'description' | 'enabled' | 'enabledHint' | 'purposeScope' | 'purposeConversation' | 'purposeAll' | 'purposeHint' | 'routesTitle' | 'routesHint' | 'routesEmpty' | 'newRoute' | 'addRoute' | 'newRouteInvalid' | 'removeRoute' | 'removeRouteConfirm' | 'routeEnabled' | 'requestsPerWindow' | 'requestsPerWindowHint' | 'windowMs' | 'windowMsHint' | 'burstSize' | 'burstSizeHint' | 'onExhausted' | 'onExhaustedHint' | 'onExhaustedWait' | 'onExhaustedReject' | 'maxQueueDepth' | 'maxQueueDepthHint' | 'maxWaitMs' | 'maxWaitMsHint' | 'overridden' | 'reset' | 'readOnly' | 'unavailable' | 'save' | 'saving' | 'saveFailed' | 'invalidNumber';
/** English copy. */
export declare const en: Record<RateLimitLocaleKey, string>;
/** Simplified Chinese copy. */
export declare const zh: Record<RateLimitLocaleKey, string>;
/**
 * The form frame's copy, read from this page's dictionary.
 * @param t - the page's locale reader.
 * @returns the labels the shared settings form renders.
 */
export declare function formLabels(t: (key: RateLimitLocaleKey) => string): SettingsFormLabels;
//# sourceMappingURL=locales.d.ts.map