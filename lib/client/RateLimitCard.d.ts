/**
 * The rate limit page's card: the master switch, the per-route rows, and the
 * shared save frame.
 *
 * Every control here comes from `@deepseek-ai/dsh-client-ui-primitives`, which
 * is a baseline module-table row. This file deliberately ships no stylesheet of
 * its own: the primitives own the chrome, so the client bundle needs no CSS
 * pipeline and the page inherits the deployment's look rather than fighting it.
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { RateLimitCardFace } from './model.ts';
/** Props the renderer binds for the rate limit page. */
export type RateLimitCardProps = PropsRuntime<'plugins.item'> & PropsLocale<'settings.rateLimit'> & InjectFace<RateLimitCardFace>;
/**
 * Render the rate limit page's one-liner or its settings form.
 * @param props - the view asked for, locale copy, the page snapshot, and its actions.
 * @returns the one-liner, or the form.
 */
export declare function RateLimitCard(props: RateLimitCardProps): any;
//# sourceMappingURL=RateLimitCard.d.ts.map