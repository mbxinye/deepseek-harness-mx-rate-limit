import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  formatScalar,
  MAX_WAIT_MS_BOUND,
  parseScalar,
  RateLimitController,
} from '../src/client/model.ts'
import { FakeScope } from './helpers/fake-scope.ts'
import { FakeCatalog } from './helpers/fake-catalog.ts'

describe('parseScalar', () => {
  test('a blank draft clears the field', () => {
    assert.deepEqual(parseScalar('', 'number'), { kind: 'clear' })
    assert.deepEqual(parseScalar('   ', 'enum'), { kind: 'clear' })
  })

  test('accepts a whole number inside its bound', () => {
    assert.deepEqual(parseScalar('30', 'number', { min: 1, max: 100_000 }), { kind: 'set', value: 30 })
    assert.deepEqual(parseScalar('0', 'number', { min: 0, max: 10 }), { kind: 'set', value: 0 })
  })

  test('refuses a fraction, since every numeric field here is an integer', () => {
    assert.equal(parseScalar('1.5', 'number', { min: 0, max: 10 }), undefined)
  })

  test('refuses a value outside its bound rather than clamping it', () => {
    assert.equal(parseScalar('0', 'number', { min: 1, max: 100_000 }), undefined)
    assert.equal(parseScalar('100001', 'number', { min: 1, max: 100_000 }), undefined)
  })

  test('refuses a delay no timer could hold, matching the Host schema', () => {
    assert.equal(
      parseScalar(String(MAX_WAIT_MS_BOUND.max + 1), 'number', MAX_WAIT_MS_BOUND),
      undefined,
    )
  })

  test('accepts only the two boolean spellings', () => {
    assert.deepEqual(parseScalar('true', 'boolean'), { kind: 'set', value: true })
    assert.deepEqual(parseScalar('false', 'boolean'), { kind: 'set', value: false })
    assert.equal(parseScalar('yes', 'boolean'), undefined)
  })

  test('an enum takes the trimmed text as-is; the Host validates the vocabulary', () => {
    assert.deepEqual(parseScalar(' wait ', 'enum'), { kind: 'set', value: 'wait' })
  })
})

describe('formatScalar', () => {
  test('renders the stored types the page edits', () => {
    assert.equal(formatScalar(30), '30')
    assert.equal(formatScalar('wait'), 'wait')
    assert.equal(formatScalar(true), 'true')
    assert.equal(formatScalar(false), 'false')
  })

  test('an absent value renders empty rather than a value nobody chose', () => {
    assert.equal(formatScalar(undefined), '')
    assert.equal(formatScalar(null), '')
  })
})

describe('RateLimitController reading', () => {
  test('lists the stored routes in stored order', () => {
    const scope = new FakeScope({ providers: { nvidia: {}, zai: {} } })
    const card = new RateLimitController(scope)
    assert.deepEqual(card.state().routes, ['nvidia', 'zai'])
    card.dispose()
  })

  test('a field reports its stored value and that the user layer carries it', () => {
    const scope = new FakeScope({ providers: { nvidia: { requestsPerWindow: 30 } } })
    const card = new RateLimitController(scope)
    const field = card.field(['providers', 'nvidia', 'requestsPerWindow'])
    assert.equal(field.text, '30')
    assert.equal(field.overridden, true)
    assert.equal(field.invalid, false)
    card.dispose()
  })

  test('an absent field is empty and not an override', () => {
    const scope = new FakeScope({ providers: {} })
    const card = new RateLimitController(scope)
    const field = card.field(['providers', 'nvidia', 'burstSize'])
    assert.equal(field.text, '')
    assert.equal(field.overridden, false)
    card.dispose()
  })

  test('reports unavailable when the Host does not serve the namespace', () => {
    const scope = new FakeScope(undefined, { status: 'unavailable' })
    const card = new RateLimitController(scope)
    assert.equal(card.shell().available, false)
    card.dispose()
  })
})

describe('RateLimitController staging', () => {
  test('a save writes every staged edit as one revision-fenced mutation', async () => {
    const scope = new FakeScope({ providers: { nvidia: { requestsPerWindow: 30 } } })
    const card = new RateLimitController(scope)
    const actions = card.actions()

    actions.edit(['providers', 'nvidia', 'requestsPerWindow'], '45')
    actions.edit(['providers', 'nvidia', 'burstSize'], '10')
    assert.equal(card.shell().dirty, true)

    await card.save()

    assert.equal(scope.writes.length, 1, 'both edits ride one atomic write')
    assert.deepEqual(scope.writes[0]?.ops, [
      { op: 'set', path: ['providers', 'nvidia', 'requestsPerWindow'], value: 45 },
      { op: 'set', path: ['providers', 'nvidia', 'burstSize'], value: 10 },
    ])
    assert.equal(scope.writes[0]?.revision, 1, 'the save fences the revision its drafts started from')
    card.dispose()
  })

  test('an unchanged draft writes nothing', async () => {
    const scope = new FakeScope({ providers: { nvidia: { requestsPerWindow: 30 } } })
    const card = new RateLimitController(scope)
    card.actions().edit(['providers', 'nvidia', 'requestsPerWindow'], '30')
    assert.equal(card.shell().dirty, false, 'typing the stored value is not an edit')
    await card.save()
    assert.equal(scope.writes.length, 0)
    card.dispose()
  })

  test('retyping the stored value with different spacing is still not an edit', async () => {
    const scope = new FakeScope({ providers: { nvidia: { requestsPerWindow: 30 } } })
    const card = new RateLimitController(scope)
    // The comparison is on the parsed value, not the draft text, so padding a
    // number does not look like an edit the user meant to make.
    card.actions().edit(['providers', 'nvidia', 'requestsPerWindow'], '  30  ')
    assert.equal(card.shell().dirty, false)
    card.dispose()
  })

  test('clearing a field the section never carried writes nothing', async () => {
    const scope = new FakeScope({ providers: { nvidia: {} } })
    const card = new RateLimitController(scope)
    card.actions().edit(['providers', 'nvidia', 'burstSize'], '')
    await card.save()
    assert.equal(scope.writes.length, 0, 're-inheriting a default is not an edit')
    card.dispose()
  })

  test('an unacceptable draft blocks the save and is never silently dropped', async () => {
    const scope = new FakeScope({ providers: { nvidia: { requestsPerWindow: 30 } } })
    const card = new RateLimitController(scope)
    card.actions().edit(['providers', 'nvidia', 'requestsPerWindow'], '0')

    const shell = card.shell()
    assert.equal(shell.dirty, true, 'the edit is still pending')
    assert.equal(shell.invalid, true, 'and it blocks the write')

    await card.save()
    assert.equal(scope.writes.length, 0, 'nothing reaches the document')
    assert.equal(card.field(['providers', 'nvidia', 'requestsPerWindow']).text, '0', 'the draft is kept')
    card.dispose()
  })

  test('a refused save keeps its drafts so the user can correct them', async () => {
    const scope = new FakeScope({ providers: { nvidia: { requestsPerWindow: 30 } } })
    const card = new RateLimitController(scope)
    card.actions().edit(['providers', 'nvidia', 'requestsPerWindow'], '45')
    scope.refuseNext = true

    await card.save()
    assert.equal(card.shell().failed, true)
    assert.equal(card.field(['providers', 'nvidia', 'requestsPerWindow']).text, '45')
    assert.equal(card.shell().dirty, true, 'the edit is still pending a correction')
    card.dispose()
  })

  test('a read-only document never writes', async () => {
    const scope = new FakeScope({ providers: {} }, { writable: false })
    const card = new RateLimitController(scope)
    card.actions().edit(['purposeScope'], 'all')
    await card.save()
    assert.equal(scope.writes.length, 0)
    card.dispose()
  })

  test('discard drops every staged edit', async () => {
    const scope = new FakeScope({ providers: { nvidia: { requestsPerWindow: 30 } } })
    const card = new RateLimitController(scope)
    const actions = card.actions()
    actions.edit(['providers', 'nvidia', 'requestsPerWindow'], '45')
    actions.addRoute('zai')
    assert.equal(card.shell().dirty, true)

    actions.discard()
    assert.equal(card.shell().dirty, false)
    assert.equal(card.field(['providers', 'nvidia', 'requestsPerWindow']).text, '30', 'the stored value is back')
    card.dispose()
  })

  test('resetting a field stages a clear, not a blank set', async () => {
    const scope = new FakeScope({ providers: { nvidia: { burstSize: 7 } } })
    const card = new RateLimitController(scope)
    card.actions().resetField(['providers', 'nvidia', 'burstSize'])
    await card.save()
    assert.deepEqual(scope.writes[0]?.ops, [{ op: 'unset', path: ['providers', 'nvidia', 'burstSize'] }])
    card.dispose()
  })

  test('resetting a field the user layer never carried writes nothing', async () => {
    const scope = new FakeScope({ providers: { nvidia: {} } })
    const card = new RateLimitController(scope)
    card.actions().resetField(['providers', 'nvidia', 'burstSize'])
    await card.save()
    assert.equal(scope.writes.length, 0, 'a default re-inheriting is not an edit')
    card.dispose()
  })
})

describe('RateLimitController route rows', () => {
  test('adding a route writes an empty profile at its nested path', async () => {
    const scope = new FakeScope({ providers: {} })
    const card = new RateLimitController(scope)
    card.actions().addRoute('  nvidia  ')
    await card.save()
    assert.deepEqual(scope.writes[0]?.ops, [{ op: 'set', path: ['providers', 'nvidia'], value: {} }])
    card.dispose()
  })

  test('removing a route unsets it', async () => {
    const scope = new FakeScope({ providers: { nvidia: {}, zai: {} } })
    const card = new RateLimitController(scope)
    card.actions().removeRoute('zai')
    await card.save()
    assert.deepEqual(scope.writes[0]?.ops, [{ op: 'unset', path: ['providers', 'zai'] }])
    card.dispose()
  })

  test('a removal is reversible before the save', () => {
    const scope = new FakeScope({ providers: { zai: {} } })
    const card = new RateLimitController(scope)
    const actions = card.actions()
    actions.removeRoute('zai')
    assert.equal(card.removing('zai'), true)
    actions.removeRoute('zai')
    assert.equal(card.removing('zai'), false, 'a second click puts it back')
    card.dispose()
  })

  test('a staged new route joins the rendered list before the save', () => {
    const scope = new FakeScope({ providers: { nvidia: {} } })
    const card = new RateLimitController(scope)
    const actions = card.actions()
    card.setNewRoute('zai')
    assert.deepEqual(card.newRoute(), { text: 'zai', valid: true })
    actions.addRoute('zai')
    assert.equal(card.shell().dirty, true)
    card.dispose()
  })

  test('a new route draft that duplicates an existing route is refused', () => {
    const scope = new FakeScope({ providers: { nvidia: {} } })
    const card = new RateLimitController(scope)
    card.setNewRoute('nvidia')
    assert.equal(card.newRoute().valid, false, 'the dict key must stay unique')
    card.setNewRoute('   ')
    assert.equal(card.newRoute().valid, false, 'and it must name something')
    card.dispose()
  })

  test('a blank route name stages nothing', async () => {
    const scope = new FakeScope({ providers: {} })
    const card = new RateLimitController(scope)
    card.actions().addRoute('   ')
    assert.equal(card.shell().dirty, false)
    card.dispose()
  })
})

describe('RateLimitController catalog', () => {
  test('offers every provider the deployment has and this page does not limit', () => {
    const scope = new FakeScope({ providers: { nvidia: {} } })
    const card = new RateLimitController(scope, new FakeCatalog(['nvidia', 'zai', 'agnes-ai']))
    assert.deepEqual(card.offered(), ['zai', 'agnes-ai'], 'a limited route is not offered again')
    card.dispose()
  })

  test('a staged addition leaves the offered list before the save', () => {
    const scope = new FakeScope({ providers: {} })
    const card = new RateLimitController(scope, new FakeCatalog(['zai']))
    assert.deepEqual(card.offered(), ['zai'])
    card.actions().addRoute('zai')
    assert.deepEqual(card.offered(), [], 'offering it twice would add it twice')
    card.dispose()
  })

  test('no catalog means no offered names, and manual entry still works', () => {
    const scope = new FakeScope({ providers: {} })
    const card = new RateLimitController(scope)
    assert.deepEqual(card.offered(), [])
    card.actions().addRoute('typed-by-hand')
    assert.deepEqual(card.state().routes, ['typed-by-hand'])
    card.dispose()
  })

  test('an unserved catalog offers nothing rather than guessing', () => {
    const scope = new FakeScope({ providers: {} })
    for (const status of ['loading', 'unavailable'] as const) {
      const card = new RateLimitController(scope, new FakeCatalog(['zai'], status))
      assert.deepEqual(card.offered(), [], `${status} must not produce names`)
      card.dispose()
    }
  })

  test('a catalog change republishes, so the offered list stays live', () => {
    const scope = new FakeScope({ providers: {} })
    const catalog = new FakeCatalog(['zai'])
    const card = new RateLimitController(scope, catalog)
    let seen = 0
    card.subscribe(() => { seen += 1 })
    const before = seen
    catalog.serve(['zai', 'agnes-ai'])
    assert.ok(seen > before, 'the page learns about a new provider without a reload')
    assert.deepEqual(card.offered(), ['zai', 'agnes-ai'])
    card.dispose()
  })

  test('dispose releases the catalog subscription too', () => {
    const scope = new FakeScope({ providers: {} })
    const catalog = new FakeCatalog(['zai'])
    const card = new RateLimitController(scope, catalog)
    assert.equal(catalog.listenerCount, 1)
    card.dispose()
    assert.equal(catalog.listenerCount, 0, 'a disposed controller stops listening')
  })
})

describe('RateLimitController lifecycle', () => {
  test('dispose releases the subscription', () => {
    const scope = new FakeScope({ providers: {} })
    const card = new RateLimitController(scope)
    card.dispose()
    // A Host update after disposal must not throw through a dead listener.
    scope.accept({ providers: { nvidia: {} } })
  })

  test('a Host update republishes to bound listeners', () => {
    const scope = new FakeScope({ providers: {} })
    const card = new RateLimitController(scope)
    let seen = 0
    const stop = card.subscribe(() => { seen += 1 })
    const before = seen
    scope.accept({ providers: { nvidia: { requestsPerWindow: 30 } } })
    assert.ok(seen > before, 'a Host acceptance reaches the renderer')
    stop()
    const afterStop = seen
    scope.accept({ providers: {} })
    assert.equal(seen, afterStop, 'an unsubscribed listener stops hearing changes')
    card.dispose()
  })
})