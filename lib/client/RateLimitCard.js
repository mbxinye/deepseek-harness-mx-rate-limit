/**
 * The rate limit page's card: the master switch, the per-route rows, and the
 * shared save frame.
 *
 * Every control here comes from `@deepseek-ai/dsh-client-ui-primitives`, which
 * is a baseline module-table row. This file deliberately ships no stylesheet of
 * its own: the primitives own the chrome, so the client bundle needs no CSS
 * pipeline and the page inherits the deployment's look rather than fighting it.
 */
import { Button, Input, SegmentedControl, SettingsForm, SettingsValueField, Switch, } from '@deepseek-ai/dsh-client-ui-primitives';
import { formLabels } from "./locales.js";
/** One numeric or enum control, staged at its nested path. */
function Field(props) {
    return (<SettingsValueField id={props.id} label={props.label} hint={props.hint} overriddenLabel={props.t('overridden')} resetLabel={props.t('reset')} invalidLabel={props.t('invalidNumber')} numeric={props.numeric ?? false} disabled={props.disabled} {...props.state} onEdit={props.onEdit} onReset={props.onReset}/>);
}
/** The two-state selector for an enum field. */
function Choice(props) {
    return (<div>
      <SegmentedControl id={props.id} label={props.label} value={props.value} options={props.options.map(option => ({ ...option }))} disabled={props.disabled} onChange={(next) => { props.onChange(next); }}/>
      <p>{props.hint}</p>
    </div>);
}
/** One configured route: its switch, its numeric fields, and its enum. */
function RouteRow(props) {
    const { route, state, disabled, actions, t } = props;
    const at = (leaf) => ['providers', route, leaf];
    const editing = state.removing(route);
    return (<fieldset disabled={disabled}>
      <legend>{route}</legend>
      <Switch checked={state.field(at('enabled')).text !== 'false'} label={t('routeEnabled')} disabled={disabled} onChange={(next) => { actions.edit(at('enabled'), String(next)); }}/>
      <Field id={`mx-rl-${route}-rpm`} label={t('requestsPerWindow')} hint={t('requestsPerWindowHint')} state={state.field(at('requestsPerWindow'))} disabled={disabled} numeric onEdit={(text) => { actions.edit(at('requestsPerWindow'), text); }} onReset={() => { actions.resetField(at('requestsPerWindow')); }} t={t}/>
      <Field id={`mx-rl-${route}-window`} label={t('windowMs')} hint={t('windowMsHint')} state={state.field(at('windowMs'))} disabled={disabled} numeric onEdit={(text) => { actions.edit(at('windowMs'), text); }} onReset={() => { actions.resetField(at('windowMs')); }} t={t}/>
      <Field id={`mx-rl-${route}-burst`} label={t('burstSize')} hint={t('burstSizeHint')} state={state.field(at('burstSize'))} disabled={disabled} numeric onEdit={(text) => { actions.edit(at('burstSize'), text); }} onReset={() => { actions.resetField(at('burstSize')); }} t={t}/>
      <Choice id={`mx-rl-${route}-exhausted`} label={t('onExhausted')} hint={t('onExhaustedHint')} value={state.field(at('onExhausted')).text || 'wait'} disabled={disabled} options={[
            { value: 'wait', label: t('onExhaustedWait') },
            { value: 'reject', label: t('onExhaustedReject') },
        ]} onChange={(next) => { actions.edit(at('onExhausted'), next); }}/>
      <Field id={`mx-rl-${route}-depth`} label={t('maxQueueDepth')} hint={t('maxQueueDepthHint')} state={state.field(at('maxQueueDepth'))} disabled={disabled} numeric onEdit={(text) => { actions.edit(at('maxQueueDepth'), text); }} onReset={() => { actions.resetField(at('maxQueueDepth')); }} t={t}/>
      <Field id={`mx-rl-${route}-wait`} label={t('maxWaitMs')} hint={t('maxWaitMsHint')} state={state.field(at('maxWaitMs'))} disabled={disabled} numeric onEdit={(text) => { actions.edit(at('maxWaitMs'), text); }} onReset={() => { actions.resetField(at('maxWaitMs')); }} t={t}/>
      <Button variant="ghost" disabled={disabled} onClick={() => { actions.removeRoute(route); }}>
        {editing ? t('overridden') : t('removeRoute')}
      </Button>
    </fieldset>);
}
/**
 * Render the rate limit page's one-liner or its settings form.
 * @param props - the view asked for, locale copy, the page snapshot, and its actions.
 * @returns the one-liner, or the form.
 */
export function RateLimitCard(props) {
    const { t } = props;
    const state = props.useRateLimitCard(snapshot => snapshot);
    if (props.view === 'summary')
        return t('description');
    const disabled = !state.writable;
    return (<SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      <Switch checked={state.field(['enabled']).text !== 'false'} label={t('enabled')} disabled={disabled} onChange={(next) => { props.edit(['enabled'], String(next)); }}/>
      <p>{t('enabledHint')}</p>
      <Choice id="mx-rl-purpose" label={t('purposeScope')} hint={t('purposeHint')} value={state.field(['purposeScope']).text || 'conversation'} disabled={disabled} options={[
            { value: 'conversation', label: t('purposeConversation') },
            { value: 'all', label: t('purposeAll') },
        ]} onChange={(next) => { props.edit(['purposeScope'], next); }}/>
      <h3>{t('routesTitle')}</h3>
      <p>{t('routesHint')}</p>
      {state.routes.length === 0 ? <p role="status">{t('routesEmpty')}</p> : null}
      {state.routes.map(route => (<RouteRow key={route} route={route} state={state} disabled={disabled} actions={props} t={t}/>))}
      <Input value={state.newRoute} placeholder={t('newRoute')} disabled={disabled} onChange={(event) => { props.setNewRoute(event.target.value); }}/>
      <Button disabled={disabled || !state.newRouteValid} onClick={() => { props.addRoute(state.newRoute); }}>
        {t('addRoute')}
      </Button>
    </SettingsForm>);
}
//# sourceMappingURL=RateLimitCard.js.map