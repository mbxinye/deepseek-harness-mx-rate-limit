/**
 * The staged settings model behind the rate-limit page, with no React in it.
 *
 * This deliberately does NOT build on the shared `SettingsFormModel`. That model
 * emits single-segment write paths (`path: [field]`), while this namespace is
 * nested — `providers.<route>.<field>` — so a dict-shaped section cannot be
 * expressed through it. Owning the staging here also means one save writes the
 * flat fields and every provider row as a single revision-fenced mutation, which
 * is what keeps a half-applied edit from reaching the document.
 *
 * Keeping it React-free is what makes it testable: the page wires a snapshot
 * store to it, and the tests drive it directly.
 *
 * @module dsh-mx-rate-limit/client/model
 */

/** A value the host path-op wire type accepts. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/**
 * Free-tier quotas the page pre-fills from, mirroring `PROVIDER_QUOTAS` in the
 * Host config. Duplicated for the same reason `ROUTE_DEFAULTS` is, and checked
 * the same way: `tests/preset.test.ts` fails if the two disagree.
 *
 * These are provider facts, not preferences, which is why they carry a source
 * and a date. The page shows both, so a number that has since moved reads as
 * "this is what was documented on that date" rather than as a current truth.
 */
export const PROVIDER_QUOTAS: Readonly<Record<string, { rpm: number; source: string; asOf: string }>> = {
  nvidia: { rpm: 40, source: 'NVIDIA 开发者论坛实测（官方 API 文档未列出）', asOf: '2026-10' },
  'agnes-ai': { rpm: 10, source: 'Agnes 官方文档：免费用户文本模型实际限额', asOf: '2026-09-23' },
}

/** Namespace of this plugin's Host entry. Spelled here: a client package must not import a Host package. */
export const RATE_LIMIT_NS = 'llm-rate-limit'

/** One route's stored limits. Mirrors the Host schema in `src/config.ts`. */
export interface ProviderProfile {
  enabled?: boolean
  requestsPerWindow?: number
  windowMs?: number
  burstSize?: number
  onExhausted?: 'wait' | 'reject'
  maxQueueDepth?: number
  maxWaitMs?: number
}

/** The section this page edits. */
export interface RateLimitSection {
  providers?: Record<string, ProviderProfile>
  purposeScope?: 'conversation' | 'all'
  enabled?: boolean
}

/** What the model reads of the Host entry, mirroring `ConfigFormSnapshot`. */
export interface RateLimitScopeSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  value: RateLimitSection | undefined
  base: unknown
  user: unknown
  writable: boolean
  revision: number | undefined
}

/**
 * One path edit a save sends.
 *
 * Shaped to the host's wire type exactly, which costs two things a looser type
 * would let slide: `path` is mutable rather than `readonly` (the wire type is
 * not), and `value` belongs to `set` alone (a shared optional `value` would
 * type-check here while the host rejects the extra key at runtime).
 */
export type RateLimitPathOp =
  | { op: 'set'; path: string[]; value: JsonValue }
  | { op: 'unset'; path: string[] }

/** The shared configuration form this page stages over. */
export interface RateLimitScope {
  getSnapshot: () => RateLimitScopeSnapshot
  subscribe: (listener: () => void) => () => void
  mutate: (ops: readonly RateLimitPathOp[], expectedRevision?: number) => Promise<boolean>
}

/** What a single control renders. */
export interface FieldState {
  text: string
  overridden: boolean
  invalid: boolean
}

/** The card-level state shared with the shared settings form frame. */
export interface CardShell {
  available: boolean
  writable: boolean
  dirty: boolean
  invalid: boolean
  saving: boolean
  failed: boolean
}

/**
 * The provider namespace whose dict keys ARE the routes.
 *
 * Read-only on purpose: this page offers names to limit, and every number stays
 * in its own namespace. A deployment serving no such namespace simply offers
 * nothing, which is honest — better an empty list than a guessed one.
 */
export const CATALOG_NS = 'llm-pi-ai'

/**
 * What this page reads of the provider namespace.
 *
 * `value` is `unknown` on purpose: the page must not claim to know another
 * plugin's config shape, only that a `providers` dict may sit at its root. A
 * namespace that turned out to hold something else yields no names rather than a
 * wrong list.
 */
export interface RouteCatalog {
  getSnapshot: () => {
    status: 'loading' | 'ready' | 'unavailable'
    value: unknown
  }
  subscribe: (listener: () => void) => () => void
}

/** Actions the page's slot entry injects. */
export interface CardActions {
  /** Stage draft text for a scalar at `path`. */
  edit: (path: readonly string[], text: string) => void
  /** Stage a clear so the path re-inherits the composition layer. */
  resetField: (path: readonly string[]) => void
  /** Stage the new-route control's draft; not itself a write. */
  setNewRoute: (text: string) => void
  /** Stage a whole new provider row. */
  addRoute: (route: string) => void
  /** Stage the removal of a provider row. */
  removeRoute: (route: string) => void
  save: () => void
  discard: () => void
}

/** The face the slot renderer binds. */
export interface RateLimitCardFace extends CardActions {
  hooks: {
    rateLimitCard: CardStateStore
  }
}

/**
 * The product's intended limits, shown for a route that stores none yet.
 *
 * A freshly added route has no resolved value, so every field would render blank
 * and the user would have to type all five numbers to get the documented
 * behaviour. Prefilling them makes "add this route and accept the defaults" a
 * single click, and makes the recommended limit visible rather than folklore.
 *
 * `burstSize` is deliberately absent. The Host gives it no default and resolves
 * an omitted one as `requestsPerWindow`, so leaving it blank is not an unset
 * value — it is exactly "the same as the rate", and it keeps following the rate
 * if the user edits that. Prefilling a number here would quietly stop tracking.
 *
 * These duplicate the Host schema's defaults, which a client package cannot
 * import. `tests/preset.test.ts` reads the Host schema and fails if the two ever
 * drift, so the duplication is checked rather than merely noted.
 */
export const ROUTE_DEFAULTS: Readonly<Record<string, number>> = {
  requestsPerWindow: 10,
  windowMs: 60_000,
}

/**
 * The read side a renderer binds. Deliberately the store's own shape rather
 * than the client's `SnapshotStore` type: keeping that import out of this
 * module is what lets the whole staged model be tested in plain Node, with no
 * harness client package resolvable.
 */
export interface CardStateStore {
  getSnapshot: () => CardState
  subscribe: (listener: () => void) => () => void
}

/** Everything the page renders. */
export interface CardState extends CardShell {
  /** Route ids present in the stored section, in stored order. */
  routes: readonly string[]
  /**
   * Route ids the deployment actually has, and this page does not limit yet.
   *
   * Offering these is the difference between a form that lists what the system
   * has and one that asks the user to remember a key nobody types by hand. Empty
   * when the catalog namespace is not served, which leaves manual entry as the
   * only way in rather than pretending the list is complete.
   *
   * Named `offered`, not `available`: `CardShell.available` already means the
   * Host serves this namespace, and one field cannot mean both.
   */
  offered: readonly string[]
  /** Draft text for a new route id typed by hand. */
  newRoute: string
  /** Whether that draft names a route that is not already configured. */
  newRouteValid: boolean
  /** Effective value at `path`, and whether the user layer carries it. */
  field: (path: readonly string[]) => FieldState
  /** Whether a row is staged for removal. */
  removing: (route: string) => boolean
}

/** One staged edit, keyed by its joined path. */
interface Staged {
  readonly text: string
  readonly clear: boolean
}

function keyOf(path: readonly string[]): string {
  return JSON.stringify(path)
}

/** Effective value at a nested path, or undefined when any segment is absent. */
function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const segment of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/** Whether the raw user layer carries this path at all, which is what marks it overridden. */
function storedPath(value: unknown, path: readonly string[]): boolean {
  return readPath(value, path) !== undefined
}

/**
 * The numeric bounds the Host schema enforces, mirrored so the page can reject a
 * draft before spending a write on it. The Host stays the authority: these only
 * decide what blocks the save button.
 */
export interface NumericBound {
  readonly min: number
  readonly max: number
}

export const REQUESTS_PER_WINDOW_BOUND: NumericBound = { min: 1, max: 100_000 }
export const WINDOW_MS_BOUND: NumericBound = { min: 100, max: 2_147_483_647 }
export const BURST_SIZE_BOUND: NumericBound = { min: 1, max: 100_000 }
export const QUEUE_DEPTH_BOUND: NumericBound = { min: 0, max: Number.MAX_SAFE_INTEGER }
export const MAX_WAIT_MS_BOUND: NumericBound = { min: 0, max: 2_147_483_647 }

/**
 * Format a stored value as the draft text a control renders.
 * @param value - the stored value, possibly undefined.
 * @returns draft text; the empty string when the section carries no value.
 */
export function formatScalar(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return ''
}

/**
 * Convert draft text into the write it stages.
 * @param text - what the user typed.
 * @param kind - which value type the field accepts.
 * @param bound - inclusive numeric limits, for a `number` field.
 * @returns the staged write, or undefined when the draft is not acceptable.
 */
export function parseScalar(
  text: string,
  kind: 'number' | 'boolean' | 'enum',
  bound?: NumericBound,
): { kind: 'set'; value: JsonValue } | { kind: 'clear' } | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'clear' }
  if (kind === 'number') {
    if (!/^-?\d+$/.test(trimmed)) return undefined
    const parsed = Number(trimmed)
    if (!Number.isSafeInteger(parsed)) return undefined
    if (bound !== undefined && (parsed < bound.min || parsed > bound.max)) return undefined
    return { kind: 'set', value: parsed }
  }
  if (kind === 'boolean') {
    if (trimmed === 'true') return { kind: 'set', value: true }
    if (trimmed === 'false') return { kind: 'set', value: false }
    return undefined
  }
  return { kind: 'set', value: trimmed }
}

/** One staged edit resolved into a write a save performs. */
interface PlannedWrite {
  readonly path: readonly string[]
  readonly op: RateLimitPathOp | undefined
}

/** Staged state of the page, and the actions the renderer binds. */
export class RateLimitController {
  /** The shared configuration form this page stages over. */
  private readonly scope: RateLimitScope
  /** Where unconfigured route ids are offered from, when the Host serves one. */
  private readonly catalog: RouteCatalog | undefined
  private readonly staged = new Map<string, Staged>()
  private readonly removals = new Set<string>()
  private readonly added = new Set<string>()
  private newRouteDraft = ''
  private baseline: RateLimitScopeSnapshot | undefined
  private saving = false
  private failed = false
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe: () => void
  private readonly unsubscribers: (() => void)[] = []

  /**
   * Mount the staged model over one namespace.
   *
   * @param scope - the shared configuration form for the `llm-rate-limit` namespace.
   * @param catalog - the provider namespace to offer unconfigured routes from; omit
   *   when the deployment does not serve one, which leaves manual entry as the only path.
   */
  constructor(scope: RateLimitScope, catalog?: RouteCatalog) {
    this.scope = scope
    this.catalog = catalog
    this.unsubscribe = scope.subscribe(() => { this.publish() })
    if (catalog !== undefined) this.unsubscribers.push(catalog.subscribe(() => { this.publish() }))
  }

  /** Release the accepted-value subscription. */
  dispose(): void {
    this.unsubscribe()
    for (const off of this.unsubscribers) off()
    this.unsubscribers.length = 0
    this.listeners.clear()
  }

  /**
   * Observe state changes, so a renderer can rebuild its projection.
   *
   * The controller publishes rather than owning a store: the React layer wraps
   * this in the client snapshot store it already depends on, which keeps this
   * module free of client-package imports and therefore testable in Node.
   * @param listener - invoked after every change to the scope or the drafts.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** The page state a renderer projects: everything one draw needs, read once. */
  state(): CardState {
    const draft = this.newRoute()
    return {
      ...this.shell(),
      routes: this.routes(),
      offered: this.offered(),
      newRoute: draft.text,
      newRouteValid: draft.valid,
      field: (path) => this.field(path),
      removing: (route) => this.removing(route),
    }
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }

  /**
   * Route ids the deployment has that this page does not limit yet.
   *
   * Staged additions are excluded too, so a route added but not yet saved is not
   * offered a second time.
   * @returns unconfigured route ids, in the catalog's own order.
   */
  offered(): string[] {
    const snapshot = this.catalog?.getSnapshot()
    if (snapshot === undefined || snapshot.status !== 'ready') return []
    const root = snapshot.value
    if (root === null || typeof root !== 'object') return []
    const providers = (root as { providers?: unknown }).providers
    if (providers === null || typeof providers !== 'object') return []
    const configured = new Set(this.routes())
    return Object.keys(providers).filter(route => !configured.has(route))
  }

  /** @returns the stored section, or an empty one before the first acceptance. */
  private section(): RateLimitSection {
    return this.scope.getSnapshot().value ?? {}
  }

  /** @returns the route ids the stored section carries, plus any staged additions. */
  private routes(): string[] {
    const stored = Object.keys(this.section().providers ?? {})
    const merged = [...stored]
    for (const route of this.added) {
      if (!merged.includes(route)) merged.push(route)
    }
    return merged.filter(route => !this.removals.has(route))
  }

  /**
   * Read one control's state.
   * @param path - nested path inside the namespace section.
   * @returns the draft text, whether a save would leave an override, and whether it is invalid.
   */
  field(path: readonly string[]): FieldState {
    const key = keyOf(path)
    const staged = this.staged.get(key)
    const snapshot = this.scope.getSnapshot()
    const stored = readPath(snapshot.value, path)
    if (staged === undefined) {
      return {
        // A route that stores nothing yet still has a limit — the Host schema
        // defaults apply to it — so show the recommended value rather than a
        // blank that reads as "unset". `overridden` stays false, so the badge
        // still says plainly that nothing is pinned.
        text: formatScalar(stored ?? this.recommended(path)),
        overridden: storedPath(snapshot.user, path),
        invalid: false,
      }
    }
    if (staged.clear) {
      return {
        // What the Host will hold once the unset lands: the composition layer,
        // or the recommended value when nothing upstream carries one. Falling
        // back to blank here would be a lie -- the field is about to have a
        // value, and showing nothing reads as "no limit".
        text: formatScalar(readPath(snapshot.base, path) ?? this.recommended(path)),
        overridden: false,
        invalid: false,
      }
    }
    return { text: staged.text, overridden: true, invalid: false }
  }

  /** @returns the recommended value for one leaf of one route, or undefined. */
  private recommended(path: readonly string[]): number | undefined {
    const leaf = path[path.length - 1] ?? ''
    // The rate is a property of the provider's offer, so a route we have a
    // documented quota for gets that figure rather than a generic default.
    if (leaf === 'requestsPerWindow') {
      const quota = PROVIDER_QUOTAS[path[1] ?? '']
      return quota?.rpm ?? ROUTE_DEFAULTS[leaf]
    }
    return ROUTE_DEFAULTS[leaf]
  }

  /**
   * The documented quota for one route, when this page has evidence for it.
   * @param route - provider route id.
   * @returns the quota and where it came from, or undefined when unknown.
   */
  quota(route: string): { rpm: number; source: string; asOf: string } | undefined {
    return PROVIDER_QUOTAS[route]
  }

  /**
   * Whether a row is staged for removal.
   * @param route - provider route id.
   * @returns whether the removal is pending.
   */
  removing(route: string): boolean {
    return this.removals.has(route)
  }

  /** @returns the draft for the new-route control, and whether it names a free route. */
  newRoute(): { text: string; valid: boolean } {
    const trimmed = this.newRouteDraft.trim()
    const taken = Object.keys(this.section().providers ?? {}).includes(trimmed)
    return { text: this.newRouteDraft, valid: trimmed.length > 0 && !taken }
  }

  /** @returns the card-level state the shared form frame renders. */
  shell(): CardShell {
    const snapshot = this.scope.getSnapshot()
    const plan = this.plan()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.dirty(),
      invalid: plan.some(item => item.op === undefined),
      saving: this.saving,
      failed: this.failed,
    }
  }

  private dirty(): boolean {
    if (this.removals.size > 0 || this.added.size > 0) return true
    return this.plan().length > 0
  }

  /**
   * Build the edit, reset, save, and discard actions the page binds.
   * @returns the page's actions.
   */
  actions(): CardActions {
    return {
      edit: (path, text) => {
        this.baseline ??= this.scope.getSnapshot()
        this.staged.set(keyOf(path), { text, clear: false })
        this.failed = false
        this.publish()
      },
      resetField: (path) => {
        this.baseline ??= this.scope.getSnapshot()
        this.staged.set(keyOf(path), { text: '', clear: true })
        this.failed = false
        this.publish()
      },
      setNewRoute: (text) => { this.setNewRoute(text) },
      addRoute: (route) => {
        const trimmed = route.trim()
        if (trimmed.length === 0) return
        this.baseline ??= this.scope.getSnapshot()
        this.removals.delete(trimmed)
        this.added.add(trimmed)
        this.newRouteDraft = ''
        this.failed = false
        this.publish()
      },
      removeRoute: (route) => {
        this.baseline ??= this.scope.getSnapshot()
        this.added.delete(route)
        if (this.removals.has(route)) this.removals.delete(route)
        else this.removals.add(route)
        this.failed = false
        this.publish()
      },
      save: () => { void this.save() },
      discard: () => {
        if (this.staged.size === 0 && this.removals.size === 0 && this.added.size === 0 && !this.failed) return
        this.staged.clear()
        this.removals.clear()
        this.added.clear()
        this.newRouteDraft = ''
        this.baseline = undefined
        this.failed = false
        this.publish()
      },
    }
  }

  /** Stage the new-route control's draft. */
  setNewRoute(text: string): void {
    this.newRouteDraft = text
    this.publish()
  }

  /** Every staged edit a save would write, in staging order. */
  private plan(): PlannedWrite[] {
    const plan: PlannedWrite[] = []
    const snapshot = this.scope.getSnapshot()
    for (const route of this.added) {
      if (this.removals.has(route)) continue
      plan.push({ path: ['providers', route], op: { op: 'set', path: ['providers', route], value: {} } })
    }
    for (const route of this.removals) {
      plan.push({ path: ['providers', route], op: { op: 'unset', path: ['providers', route] } })
    }
    for (const [key, staged] of this.staged) {
      const path = JSON.parse(key) as string[]
      if (staged.clear) {
        if (storedPath(snapshot.user, path)) plan.push({ path, op: { op: 'unset', path } })
        continue
      }
      const write = parseScalar(staged.text, kindFor(path), boundFor(path))
      // An unacceptable draft carries no write: the form stays dirty and the
      // save refuses rather than silently dropping what the user typed.
      if (write === undefined) {
        plan.push({ path, op: undefined })
        continue
      }
      const stored = readPath(snapshot.value, path)
      if (write.kind === 'clear') {
        // Clearing a field the section never carried re-inherits the same
        // value, so there is nothing to write.
        if (storedPath(snapshot.user, path)) plan.push({ path, op: { op: 'unset', path } })
        continue
      }
      // Compare the PARSED value, not the draft text: retyping the stored value
      // with different spacing is not an edit, and must not read as one.
      if (stored === write.value) continue
      plan.push({ path, op: { op: 'set', path, value: write.value } })
    }
    return plan
  }

  /**
   * Write every staged edit as one revision-fenced mutation, then re-seed from
   * what the Host accepted.
   *
   * The Host is the authority on acceptance, so the outcome is read back rather
   * than predicted. A save that did not land keeps its drafts.
   */
  async save(): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    const plan = this.plan()
    const ops = plan.flatMap(item => (item.op === undefined ? [] : [item.op]))
    if (ops.length === 0 || this.saving || !snapshot.writable) return
    this.saving = true
    this.failed = false
    this.publish()
    try {
      const landed = await this.scope.mutate(ops, this.baseline?.revision)
      this.failed = !landed
      if (landed) {
        this.staged.clear()
        this.removals.clear()
        this.added.clear()
        this.baseline = undefined
      }
    } catch {
      this.failed = true
    } finally {
      this.saving = false
      this.publish()
    }
  }
}

/** The value type one namespace path accepts. */
function kindFor(path: readonly string[]): 'number' | 'boolean' | 'enum' {
  const leaf = path[path.length - 1]
  if (leaf === 'enabled') return 'boolean'
  if (leaf === 'onExhausted' || leaf === 'purposeScope') return 'enum'
  return 'number'
}

/** Inclusive numeric limits for one namespace path, where the leaf is numeric. */
function boundFor(path: readonly string[]): NumericBound | undefined {
  switch (path[path.length - 1]) {
    case 'requestsPerWindow': return REQUESTS_PER_WINDOW_BOUND
    case 'windowMs': return WINDOW_MS_BOUND
    case 'burstSize': return BURST_SIZE_BOUND
    case 'maxQueueDepth': return QUEUE_DEPTH_BOUND
    case 'maxWaitMs': return MAX_WAIT_MS_BOUND
    default: return undefined
  }
}