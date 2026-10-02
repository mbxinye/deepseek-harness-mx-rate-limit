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

import { PROVIDER_QUOTAS as CLIENT_QUOTAS, ROUTE_DEFAULTS } from '../src/client/model.ts'
import { Config, DEFAULT_REQUESTS_PER_WINDOW, PROVIDER_QUOTAS as HOST_QUOTAS } from '../src/config.ts'

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

test('the recommended limit is the safe fallback, not a middle guess', () => {
  // Named here because it is a decision: an unconfigured route starts at the
  // lowest documented free tier, because too high earns a 429 and too low is
  // only slower. A known route gets its own documented figure instead.
  assert.equal(ROUTE_DEFAULTS.requestsPerWindow, 10)
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

test('the documented quotas match between the Host and the client', () => {
  // Same duplication as ROUTE_DEFAULTS: the page pre-fills a rate from the
  // catalog, and a stale copy there would show one number and enforce another.
  assert.deepEqual(
    CLIENT_QUOTAS,
    HOST_QUOTAS,
    'the two PROVIDER_QUOTAS copies disagree',
  )
})

test('the fallback rate is the lowest documented free tier, not a middle guess', () => {
  // The two failure directions are asymmetric: too high is the 429 this plugin
  // exists to prevent, too low is merely slower. So an unconfigured route starts
  // at the lowest figure we have evidence for rather than in between.
  const nvidia = HOST_QUOTAS.nvidia
  const agnes = HOST_QUOTAS['agnes-ai']
  assert.ok(nvidia && agnes, 'the catalog lost a route this test depends on')
  const rpm = Object.values(HOST_QUOTAS).map(quota => quota.rpm)
  assert.equal(nvidia.rpm, 40, 'NVIDIA NIM free tier is 40 RPM')
  assert.equal(agnes.rpm, 10, 'Agnes free tier is 10 RPM actual')
  assert.equal(
    DEFAULT_REQUESTS_PER_WINDOW,
    Math.min(...rpm),
    'the fallback must be the lowest documented rate',
  )
})

test('every documented quota names where it came from', () => {
  // These figures move — Agnes halved its free text quota — so a bare number
  // would read as a current truth rather than a dated observation.
  for (const [route, quota] of Object.entries(HOST_QUOTAS)) {
    assert.ok(quota.source.length > 0, `${route} has no source`)
    assert.match(quota.asOf, /^\d{4}-\d{2}(-\d{2})?$/, `${route} has no as-of date`)
    assert.ok(quota.rpm >= 1, `${route} has a non-positive rate`)
  }
})