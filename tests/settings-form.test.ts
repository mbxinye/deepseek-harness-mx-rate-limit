// Runs the harness's real volatileForm/projectForm against this plugin's Config
// to prove the settings UI will render a form, rather than asserting the shape
// by hand. Loaded from the harness checkout, not copied.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

import { Config } from '../src/config.ts'

const HARNESS = 'D:/workspace/code/GIT/deepseek-harness'
const { volatileForm, projectForm } = await import(
  pathToFileURL(`${HARNESS}/packages/settings/settings/src/schema.ts`).href
)

test("the harness's own volatileForm projects this plugin's Config into a form", () => {
  const form = volatileForm(Config as never)
  assert.ok(form, 'a Config without volatile fields would contribute NO settings page')
  assert.equal(form.type, 'object')
  assert.deepEqual(Object.keys(form.dict ?? {}).sort(), ['enabled', 'providers', 'purposeScope'])
})

test('the projected form carries each field with its default', () => {
  const form = volatileForm(Config as never)
  assert.ok(form)
  const parsed = Config({ providers: { nim: { requestsPerWindow: 30 } } })
  const shown = projectForm(form, {
    providers: parsed.providers.get(),
    purposeScope: parsed.purposeScope.get(),
    enabled: parsed.enabled.get(),
  }) as Record<string, unknown>
  const nim = (shown.providers as Record<string, Record<string, unknown> | undefined>).nim
  assert.ok(nim)
  assert.equal(nim.requestsPerWindow, 30)
  // Two numbers and a switch, so the page asks for nothing a free tier does not
  // document. Nothing here can express a wait bound, which is the point. burstSize
  // is absent because it has no default: an omitted one resolves to the rate.
  assert.deepEqual(Object.keys(nim).sort(), ['enabled', 'requestsPerWindow', 'windowMs'])
  assert.equal(shown.purposeScope, 'conversation')
})