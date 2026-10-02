/**
 * The rate limit settings page, browser half.
 *
 * Registered into the Plugins page's `plugins.item` slot while the Host serves
 * the `llm-rate-limit` namespace, so a deployment that has not mounted this
 * plugin shows no trace of it.
 */
import { RateLimitCard } from "./RateLimitCard.js";
import { cardFace } from "./face.js";
import { RATE_LIMIT_NS, RateLimitController } from "./model.js";
import { en, zh } from "./locales.js";
/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.rateLimit';
/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'configForms'];
/**
 * Mount the rate limit settings page while the Host serves its namespace.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx) {
    const t = ctx.locale.bind(NS);
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'mx-rate-limit: dictionaries');
    const card = new RateLimitController(ctx.configForms.get(RATE_LIMIT_NS));
    ctx.effect(() => () => { card.dispose(); }, 'mx-rate-limit: form subscription');
    ctx.effect(() => ctx.configForms.whileServed([RATE_LIMIT_NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
        name: 'plugins.item',
        id: 'mx-rate-limit',
        order: 45,
        label: () => t('title'),
        locale: NS,
        inject: () => cardFace(card),
    }, RateLimitCard))), 'mx-rate-limit: page');
}
//# sourceMappingURL=index.js.map