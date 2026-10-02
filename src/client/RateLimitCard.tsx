/**
 * The rate limit page's card: the master switch, the per-route rows, and the
 * shared save frame.
 *
 * Every control here comes from `@deepseek-ai/dsh-client-ui-primitives`, which
 * is a baseline module-table row. This file deliberately ships no stylesheet of
 * its own: the primitives own the chrome, so the client bundle needs no CSS
 * pipeline and the page inherits the deployment's look rather than fighting it.
 */

import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import {
  Button,
  Input,
  SegmentedControl,
  SettingsForm,
  SettingsValueField,
  Switch,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

import { formLabels, type RateLimitLocaleKey } from './locales.ts'
import { PROVIDER_QUOTAS } from './model.ts'
import type { CardActions, CardState, FieldState, RateLimitCardFace } from './model.ts'

/** Props the renderer binds for the rate limit page. */
export type RateLimitCardProps =
  PropsRuntime<'plugins.item'>
  & PropsLocale<'settings.rateLimit'>
  & InjectFace<RateLimitCardFace>

/**
 * Locale reader, narrowed to the keys this file uses.
 *
 * Keeps the optional interpolation bag because one string quotes a quota's
 * source and date; without it the page could not say where a number came from.
 */
type T = (key: RateLimitLocaleKey, params?: Record<string, string>) => string

/** One numeric or enum control, staged at its nested path. */
function Field(props: {
  id: string
  label: string
  hint: string
  state: FieldState
  disabled: boolean
  numeric?: boolean
  onEdit: (text: string) => void
  onReset: () => void
  t: T
}) {
  return (
    <SettingsValueField
      id={props.id}
      label={props.label}
      hint={props.hint}
      overriddenLabel={props.t('overridden')}
      resetLabel={props.t('reset')}
      invalidLabel={props.t('invalidNumber')}
      numeric={props.numeric ?? false}
      disabled={props.disabled}
      {...props.state}
      onEdit={props.onEdit}
      onReset={props.onReset}
    />
  )
}

/** The two-state selector for an enum field. */
function Choice(props: {
  id: string
  label: string
  hint: string
  value: string
  options: readonly { readonly value: string; readonly label: string }[]
  disabled: boolean
  onChange: (next: string) => void
}) {
  return (
    <div>
      <SegmentedControl
        id={props.id}
        label={props.label}
        value={props.value}
        options={props.options.map(option => ({ ...option }))}
        disabled={props.disabled}
        onChange={(next: string) => { props.onChange(next) }}
      />
      <p>{props.hint}</p>
    </div>
  )
}

/** One configured route: its switch, its numeric fields, and its enum. */
function RouteRow(props: {
  route: string
  state: CardState
  disabled: boolean
  actions: CardActions
  t: T
}) {
  const { route, state, disabled, actions, t } = props
  const at = (leaf: string): readonly string[] => ['providers', route, leaf]
  const editing = state.removing(route)
  const quota = PROVIDER_QUOTAS[route]
  return (
    <fieldset disabled={disabled}>
      <legend>{route}</legend>
      <Switch
        checked={state.field(at('enabled')).text !== 'false'}
        label={t('routeEnabled')}
        disabled={disabled}
        onChange={(next: boolean) => { actions.edit(at('enabled'), String(next)) }}
      />
      <Field
        id={`mx-rl-${route}-rpm`}
        label={t('requestsPerWindow')}
        hint={t('requestsPerWindowHint')}
        state={state.field(at('requestsPerWindow'))}
        disabled={disabled}
        numeric
        onEdit={(text) => { actions.edit(at('requestsPerWindow'), text) }}
        onReset={() => { actions.resetField(at('requestsPerWindow')) }}
        t={t}
      />
      {quota === undefined ? null : (
        <p role="note">{t('quotaSource', { rpm: String(quota.rpm), source: quota.source, asOf: quota.asOf })}</p>
      )}
      {/*
        A native disclosure rather than the shared DisclosureRow: that one is a
        controlled process row needing an icon this package cannot import, and a
        settings sub-section needs none of its affordances. <details> is focusable,
        keyboard-operable and announced as expanded/collapsed without any of that.
      */}
      <details>
        <summary>{t('advanced')}</summary>
        <Field
          id={`mx-rl-${route}-depth`}
          label={t('maxQueueDepth')}
          hint={t('maxQueueDepthHint')}
          state={state.field(at('maxQueueDepth'))}
          disabled={disabled}
          numeric
          onEdit={(text) => { actions.edit(at('maxQueueDepth'), text) }}
          onReset={() => { actions.resetField(at('maxQueueDepth')) }}
          t={t}
        />
        <Field
          id={`mx-rl-${route}-wait`}
          label={t('maxWaitMs')}
          hint={t('maxWaitMsHint')}
          state={state.field(at('maxWaitMs'))}
          disabled={disabled}
          numeric
          onEdit={(text) => { actions.edit(at('maxWaitMs'), text) }}
          onReset={() => { actions.resetField(at('maxWaitMs')) }}
          t={t}
        />
      </details>
      <Button variant="ghost" disabled={disabled} onClick={() => { actions.removeRoute(route) }}>
        {editing ? t('overridden') : t('removeRoute')}
      </Button>
    </fieldset>
  )
}

/**
 * Render the rate limit page's one-liner or its settings form.
 * @param props - the view asked for, locale copy, the page snapshot, and its actions.
 * @returns the one-liner, or the form.
 */
export function RateLimitCard(props: RateLimitCardProps) {
  const { t } = props
  const state = props.useRateLimitCard(snapshot => snapshot)
  if (props.view === 'summary') return t('description')
  const disabled = !state.writable
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      <Switch
        checked={state.field(['enabled']).text !== 'false'}
        label={t('enabled')}
        disabled={disabled}
        onChange={(next: boolean) => { props.edit(['enabled'], String(next)) }}
      />
      <p>{t('enabledHint')}</p>
      <Choice
        id="mx-rl-purpose"
        label={t('purposeScope')}
        hint={t('purposeHint')}
        value={state.field(['purposeScope']).text || 'conversation'}
        disabled={disabled}
        options={[
          { value: 'conversation', label: t('purposeConversation') },
          { value: 'all', label: t('purposeAll') },
        ]}
        onChange={(next) => { props.edit(['purposeScope'], next) }}
      />
      <h3>{t('routesTitle')}</h3>
      <p>{t('routesHint')}</p>
      {state.routes.length === 0 ? <p role="status">{t('routesEmpty')}</p> : null}
      {state.routes.map(route => (
        <RouteRow
          key={route}
          route={route}
          state={state}
          disabled={disabled}
          actions={props}
          t={t}
        />
      ))}
      {state.offered.length > 0 ? (
        <>
          <h3>{t('availableTitle')}</h3>
          <p>{t('availableHint')}</p>
          <ul>
            {state.offered.map(route => (
              <li key={`avail-${route}`}>
                <Button
                  variant="outline"
                  disabled={disabled}
                  title={t('addThisRoute')}
                  onClick={() => { props.addRoute(route) }}
                >
                  {route}
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {state.routes.length > 0 && state.offered.length === 0 ? (
        <p role="status">{t('availableEmpty')}</p>
      ) : null}
      <Input
        value={state.newRoute}
        placeholder={t('newRoute')}
        disabled={disabled}
        onChange={(event: { target: { value: string } }) => { props.setNewRoute(event.target.value) }}
      />
      <Button
        disabled={disabled || !state.newRouteValid}
        onClick={() => { props.addRoute(state.newRoute) }}
      >
        {t('addRoute')}
      </Button>
    </SettingsForm>
  )
}