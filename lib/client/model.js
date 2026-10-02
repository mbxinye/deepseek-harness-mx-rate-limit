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
/** Namespace of this plugin's Host entry. Spelled here: a client package must not import a Host package. */
export const RATE_LIMIT_NS = 'llm-rate-limit';
function keyOf(path) {
    return JSON.stringify(path);
}
/** Effective value at a nested path, or undefined when any segment is absent. */
function readPath(value, path) {
    let current = value;
    for (const segment of path) {
        if (current === null || typeof current !== 'object')
            return undefined;
        current = current[segment];
    }
    return current;
}
/** Whether the raw user layer carries this path at all, which is what marks it overridden. */
function storedPath(value, path) {
    return readPath(value, path) !== undefined;
}
export const REQUESTS_PER_WINDOW_BOUND = { min: 1, max: 100_000 };
export const WINDOW_MS_BOUND = { min: 100, max: 2_147_483_647 };
export const BURST_SIZE_BOUND = { min: 1, max: 100_000 };
export const QUEUE_DEPTH_BOUND = { min: 0, max: Number.MAX_SAFE_INTEGER };
export const MAX_WAIT_MS_BOUND = { min: 0, max: 2_147_483_647 };
/**
 * Format a stored value as the draft text a control renders.
 * @param value - the stored value, possibly undefined.
 * @returns draft text; the empty string when the section carries no value.
 */
export function formatScalar(value) {
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    if (typeof value === 'boolean')
        return value ? 'true' : 'false';
    return '';
}
/**
 * Convert draft text into the write it stages.
 * @param text - what the user typed.
 * @param kind - which value type the field accepts.
 * @param bound - inclusive numeric limits, for a `number` field.
 * @returns the staged write, or undefined when the draft is not acceptable.
 */
export function parseScalar(text, kind, bound) {
    const trimmed = text.trim();
    if (trimmed === '')
        return { kind: 'clear' };
    if (kind === 'number') {
        if (!/^-?\d+$/.test(trimmed))
            return undefined;
        const parsed = Number(trimmed);
        if (!Number.isSafeInteger(parsed))
            return undefined;
        if (bound !== undefined && (parsed < bound.min || parsed > bound.max))
            return undefined;
        return { kind: 'set', value: parsed };
    }
    if (kind === 'boolean') {
        if (trimmed === 'true')
            return { kind: 'set', value: true };
        if (trimmed === 'false')
            return { kind: 'set', value: false };
        return undefined;
    }
    return { kind: 'set', value: trimmed };
}
/** Staged state of the page, and the actions the renderer binds. */
export class RateLimitController {
    /** The shared configuration form this page stages over. */
    scope;
    staged = new Map();
    removals = new Set();
    added = new Set();
    newRouteDraft = '';
    baseline;
    saving = false;
    failed = false;
    listeners = new Set();
    unsubscribe;
    /** @param scope - the shared configuration form for the `llm-rate-limit` namespace. */
    constructor(scope) {
        this.scope = scope;
        this.unsubscribe = scope.subscribe(() => { this.publish(); });
    }
    /** Release the accepted-value subscription. */
    dispose() {
        this.unsubscribe();
        this.listeners.clear();
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
    subscribe(listener) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
    /** The page state a renderer projects: everything one draw needs, read once. */
    state() {
        const draft = this.newRoute();
        return {
            ...this.shell(),
            routes: this.routes(),
            newRoute: draft.text,
            newRouteValid: draft.valid,
            field: (path) => this.field(path),
            removing: (route) => this.removing(route),
        };
    }
    publish() {
        for (const listener of this.listeners)
            listener();
    }
    /** @returns the stored section, or an empty one before the first acceptance. */
    section() {
        return this.scope.getSnapshot().value ?? {};
    }
    /** @returns the route ids the stored section carries, plus any staged additions. */
    routes() {
        const stored = Object.keys(this.section().providers ?? {});
        const merged = [...stored];
        for (const route of this.added) {
            if (!merged.includes(route))
                merged.push(route);
        }
        return merged.filter(route => !this.removals.has(route));
    }
    /**
     * Read one control's state.
     * @param path - nested path inside the namespace section.
     * @returns the draft text, whether a save would leave an override, and whether it is invalid.
     */
    field(path) {
        const key = keyOf(path);
        const staged = this.staged.get(key);
        const snapshot = this.scope.getSnapshot();
        const stored = readPath(snapshot.value, path);
        if (staged === undefined) {
            return {
                text: formatScalar(stored),
                overridden: storedPath(snapshot.user, path),
                invalid: false,
            };
        }
        if (staged.clear) {
            return { text: formatScalar(readPath(snapshot.base, path)), overridden: false, invalid: false };
        }
        return { text: staged.text, overridden: true, invalid: false };
    }
    /**
     * Whether a row is staged for removal.
     * @param route - provider route id.
     * @returns whether the removal is pending.
     */
    removing(route) {
        return this.removals.has(route);
    }
    /** @returns the draft for the new-route control, and whether it names a free route. */
    newRoute() {
        const trimmed = this.newRouteDraft.trim();
        const taken = Object.keys(this.section().providers ?? {}).includes(trimmed);
        return { text: this.newRouteDraft, valid: trimmed.length > 0 && !taken };
    }
    /** @returns the card-level state the shared form frame renders. */
    shell() {
        const snapshot = this.scope.getSnapshot();
        const plan = this.plan();
        return {
            available: snapshot.status === 'ready',
            writable: snapshot.writable,
            dirty: this.dirty(),
            invalid: plan.some(item => item.op === undefined),
            saving: this.saving,
            failed: this.failed,
        };
    }
    dirty() {
        if (this.removals.size > 0 || this.added.size > 0)
            return true;
        return this.plan().length > 0;
    }
    /**
     * Build the edit, reset, save, and discard actions the page binds.
     * @returns the page's actions.
     */
    actions() {
        return {
            edit: (path, text) => {
                this.baseline ??= this.scope.getSnapshot();
                this.staged.set(keyOf(path), { text, clear: false });
                this.failed = false;
                this.publish();
            },
            resetField: (path) => {
                this.baseline ??= this.scope.getSnapshot();
                this.staged.set(keyOf(path), { text: '', clear: true });
                this.failed = false;
                this.publish();
            },
            setNewRoute: (text) => { this.setNewRoute(text); },
            addRoute: (route) => {
                const trimmed = route.trim();
                if (trimmed.length === 0)
                    return;
                this.baseline ??= this.scope.getSnapshot();
                this.removals.delete(trimmed);
                this.added.add(trimmed);
                this.newRouteDraft = '';
                this.failed = false;
                this.publish();
            },
            removeRoute: (route) => {
                this.baseline ??= this.scope.getSnapshot();
                this.added.delete(route);
                if (this.removals.has(route))
                    this.removals.delete(route);
                else
                    this.removals.add(route);
                this.failed = false;
                this.publish();
            },
            save: () => { void this.save(); },
            discard: () => {
                if (this.staged.size === 0 && this.removals.size === 0 && this.added.size === 0 && !this.failed)
                    return;
                this.staged.clear();
                this.removals.clear();
                this.added.clear();
                this.newRouteDraft = '';
                this.baseline = undefined;
                this.failed = false;
                this.publish();
            },
        };
    }
    /** Stage the new-route control's draft. */
    setNewRoute(text) {
        this.newRouteDraft = text;
        this.publish();
    }
    /** Every staged edit a save would write, in staging order. */
    plan() {
        const plan = [];
        const snapshot = this.scope.getSnapshot();
        for (const route of this.added) {
            if (this.removals.has(route))
                continue;
            plan.push({ path: ['providers', route], op: { op: 'set', path: ['providers', route], value: {} } });
        }
        for (const route of this.removals) {
            plan.push({ path: ['providers', route], op: { op: 'unset', path: ['providers', route] } });
        }
        for (const [key, staged] of this.staged) {
            const path = JSON.parse(key);
            if (staged.clear) {
                if (storedPath(snapshot.user, path))
                    plan.push({ path, op: { op: 'unset', path } });
                continue;
            }
            const write = parseScalar(staged.text, kindFor(path), boundFor(path));
            // An unacceptable draft carries no write: the form stays dirty and the
            // save refuses rather than silently dropping what the user typed.
            if (write === undefined) {
                plan.push({ path, op: undefined });
                continue;
            }
            const stored = readPath(snapshot.value, path);
            if (write.kind === 'clear') {
                // Clearing a field the section never carried re-inherits the same
                // value, so there is nothing to write.
                if (storedPath(snapshot.user, path))
                    plan.push({ path, op: { op: 'unset', path } });
                continue;
            }
            // Compare the PARSED value, not the draft text: retyping the stored value
            // with different spacing is not an edit, and must not read as one.
            if (stored === write.value)
                continue;
            plan.push({ path, op: { op: 'set', path, value: write.value } });
        }
        return plan;
    }
    /**
     * Write every staged edit as one revision-fenced mutation, then re-seed from
     * what the Host accepted.
     *
     * The Host is the authority on acceptance, so the outcome is read back rather
     * than predicted. A save that did not land keeps its drafts.
     */
    async save() {
        const snapshot = this.scope.getSnapshot();
        const plan = this.plan();
        const ops = plan.flatMap(item => (item.op === undefined ? [] : [item.op]));
        if (ops.length === 0 || this.saving || !snapshot.writable)
            return;
        this.saving = true;
        this.failed = false;
        this.publish();
        try {
            const landed = await this.scope.mutate(ops, this.baseline?.revision);
            this.failed = !landed;
            if (landed) {
                this.staged.clear();
                this.removals.clear();
                this.added.clear();
                this.baseline = undefined;
            }
        }
        catch {
            this.failed = true;
        }
        finally {
            this.saving = false;
            this.publish();
        }
    }
}
/** The value type one namespace path accepts. */
function kindFor(path) {
    const leaf = path[path.length - 1];
    if (leaf === 'enabled')
        return 'boolean';
    if (leaf === 'onExhausted' || leaf === 'purposeScope')
        return 'enum';
    return 'number';
}
/** Inclusive numeric limits for one namespace path, where the leaf is numeric. */
function boundFor(path) {
    switch (path[path.length - 1]) {
        case 'requestsPerWindow': return REQUESTS_PER_WINDOW_BOUND;
        case 'windowMs': return WINDOW_MS_BOUND;
        case 'burstSize': return BURST_SIZE_BOUND;
        case 'maxQueueDepth': return QUEUE_DEPTH_BOUND;
        case 'maxWaitMs': return MAX_WAIT_MS_BOUND;
        default: return undefined;
    }
}
//# sourceMappingURL=model.js.map