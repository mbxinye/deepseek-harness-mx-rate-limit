/**
 * The rate limit settings page, browser half.
 *
 * Registered into the Plugins page's `plugins.item` slot while the Host serves
 * the `llm-rate-limit` namespace, so a deployment that has not mounted this
 * plugin shows no trace of it.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.configForms Context merge. Cross-plugin collaboration goes
// through the service, never a value import (the client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the Plugins page's SlotMap merge (the 'plugins.item' entry).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'

import { RateLimitCard } from './RateLimitCard.tsx'
import { cardFace } from './face.ts'
import { RATE_LIMIT_NS, RateLimitController } from './model.ts'
import { en, zh, type RateLimitLocaleKey } from './locales.ts'

export type { RateLimitCardProps } from './RateLimitCard.tsx'
export type {
  CardActions,
  CardShell,
  CardState,
  CardStateStore,
  FieldState,
  ProviderProfile,
  RateLimitCardFace,
  RateLimitScope,
  RateLimitSection,
} from './model.ts'
export type { RateLimitLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Rate limit settings page copy. */
    'settings.rateLimit': RateLimitLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.rateLimit'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'configForms']

/**
 * Mount the rate limit settings page while the Host serves its namespace.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'mx-rate-limit: dictionaries')
  const card = new RateLimitController(ctx.configForms.get(RATE_LIMIT_NS))
  ctx.effect(() => () => { card.dispose() }, 'mx-rate-limit: form subscription')
  ctx.effect(
    () => ctx.configForms.whileServed([RATE_LIMIT_NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
      name: 'plugins.item',
      id: 'mx-rate-limit',
      order: 45,
      label: () => t('title'),
      locale: NS,
      inject: () => cardFace(card),
    }, RateLimitCard))),
    'mx-rate-limit: page',
  )
}