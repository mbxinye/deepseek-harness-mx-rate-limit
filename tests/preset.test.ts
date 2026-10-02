/**
 * Guards the one duplication the plugin cannot avoid.
 *
 * The client pre-fills a new route with the recommended limits so "add this route"
 * is one click. Those numbers live in `client/model.ts`, and the Host schema's
 * defaults live in `config.ts`, because a client package must not import a Host
 * one. Two copies of a default drift the moment either is edited, and the symptom
 * is a page that shows one number and enforces another — which is worse than a
 * blank field, because it looks authoritative.
 *
 * So this reads the Host's real defaults through the harness's own projection and
 * fails when the two disagree. Deleting this file would leave the duplication
 * unchecked; it is load-bearing, not decorative.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

import { ROUTE_DEFAULTS } from '../src/client/model.ts'
import { Config } from '../src/config.ts'

const HARNESS = 'D:/workspace/code/GIT/deepseek-harness'
const { volatileForm, projectForm } = await import(
  pathToFileURL(`${HARNESS}/packages/settings/settings/src/schema.ts`).href
)

/** @returns one route profile as the Host resolves it from an empty object. */
function resolvedRoute(): Record<string, unknown> {
  const form = volatileForm(Config as never)
  assert.ok(form, 'a Config without volatile fields contributes no settings page')
  // An empty profile is the interesting case: everything the page pre-fills comes
  // from these defaults, so this is exactly what a freshly added route will hold.
  const parsed = Config({ providers: { probe: {} } })
  const shown = projectForm(form, {
    providers: parsed.providers.get(),
    purposeScope: parsed.purposeScope.get(),
    enabled: parsed.enabled.get(),
  }) as { providers: Record<string, Record<string, unknown> | undefined> }
  const route = shown.providers.probe
  assert.ok(route, 'the Host resolved no profile for an empty route')
  return route
}

test('every pre-filled value equals the Host schema default', () => {
  const route = resolvedRoute()
  for (const [leaf, value] of Object.entries(ROUTE_DEFAULTS)) {
    assert.equal(
      route[leaf],
      value,
      `${leaf}: the page would show ${String(value)} while the Host enforces ${String(route[leaf])}`,
    )
  }
})

test('the recommended limit really is 30 per minute', () => {
  // Named here because it is a product decision, not an accident: 30/min is
  // NVIDIA NIM's documented free tier and the rate most worth defaulting to.
  assert.equal(ROUTE_DEFAULTS.requestsPerWindow, 30)
  assert.equal(ROUTE_DEFAULTS.windowMs, 60_000)
})

test('burstSize is left blank because the Host derives it from the rate', () => {
  // The one field with no schema default: an omitted burstSize is resolved as
  // `requestsPerWindow`. Prefilling it would freeze a value the Host would not
  // freeze, so the page shows nothing and the rate governs.
  const route = resolvedRoute()
  assert.equal(route.burstSize, undefined, 'the Host does not default burstSize')
  assert.equal(
    ROUTE_DEFAULTS.burstSize,
    undefined,
    'and the page must not invent one',
  )
})