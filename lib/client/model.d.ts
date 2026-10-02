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
type JsonValue = string | number | boolean | null | JsonValue[] | {
    [key: string]: JsonValue;
};
/** Namespace of this plugin's Host entry. Spelled here: a client package must not import a Host package. */
export declare const RATE_LIMIT_NS = "llm-rate-limit";
/** One route's stored limits. Mirrors the Host schema in `src/config.ts`. */
export interface ProviderProfile {
    enabled?: boolean;
    requestsPerWindow?: number;
    windowMs?: number;
    burstSize?: number;
    onExhausted?: 'wait' | 'reject';
    maxQueueDepth?: number;
    maxWaitMs?: number;
}
/** The section this page edits. */
export interface RateLimitSection {
    providers?: Record<string, ProviderProfile>;
    purposeScope?: 'conversation' | 'all';
    enabled?: boolean;
}
/** What the model reads of the Host entry, mirroring `ConfigFormSnapshot`. */
export interface RateLimitScopeSnapshot {
    status: 'loading' | 'ready' | 'unavailable';
    value: RateLimitSection | undefined;
    base: unknown;
    user: unknown;
    writable: boolean;
    revision: number | undefined;
}
/**
 * One path edit a save sends.
 *
 * Shaped to the host's wire type exactly, which costs two things a looser type
 * would let slide: `path` is mutable rather than `readonly` (the wire type is
 * not), and `value` belongs to `set` alone (a shared optional `value` would
 * type-check here while the host rejects the extra key at runtime).
 */
export type RateLimitPathOp = {
    op: 'set';
    path: string[];
    value: JsonValue;
} | {
    op: 'unset';
    path: string[];
};
/** The shared configuration form this page stages over. */
export interface RateLimitScope {
    getSnapshot: () => RateLimitScopeSnapshot;
    subscribe: (listener: () => void) => () => void;
    mutate: (ops: readonly RateLimitPathOp[], expectedRevision?: number) => Promise<boolean>;
}
/** What a single control renders. */
export interface FieldState {
    text: string;
    overridden: boolean;
    invalid: boolean;
}
/** Card-level state shared with the shared settings form frame. */
export interface CardShell {
    available: boolean;
    writable: boolean;
    dirty: boolean;
    invalid: boolean;
    saving: boolean;
    failed: boolean;
}
/** Actions the page's slot entry injects. */
export interface CardActions {
    /** Stage draft text for a scalar at `path`. */
    edit: (path: readonly string[], text: string) => void;
    /** Stage a clear so the path re-inherits the composition layer. */
    resetField: (path: readonly string[]) => void;
    /** Stage the new-route control's draft; not itself a write. */
    setNewRoute: (text: string) => void;
    /** Stage a whole new provider row. */
    addRoute: (route: string) => void;
    /** Stage the removal of a provider row. */
    removeRoute: (route: string) => void;
    save: () => void;
    discard: () => void;
}
/** The face the slot renderer binds. */
export interface RateLimitCardFace extends CardActions {
    hooks: {
        rateLimitCard: CardStateStore;
    };
}
/**
 * The read side a renderer binds. Deliberately the store's own shape rather
 * than the client's `SnapshotStore` type: keeping that import out of this
 * module is what lets the whole staged model be tested in plain Node, with no
 * harness client package resolvable.
 */
export interface CardStateStore {
    getSnapshot: () => CardState;
    subscribe: (listener: () => void) => () => void;
}
/** Everything the page renders. */
export interface CardState extends CardShell {
    /** Route ids present in the stored section, in stored order. */
    routes: readonly string[];
    /** Draft text for a staged new route id. */
    newRoute: string;
    /** Whether that draft names a route that is not already configured. */
    newRouteValid: boolean;
    /** Effective value at `path`, and whether the user layer carries it. */
    field: (path: readonly string[]) => FieldState;
    /** Whether a row is staged for removal. */
    removing: (route: string) => boolean;
}
/**
 * The numeric bounds the Host schema enforces, mirrored so the page can reject a
 * draft before spending a write on it. The Host stays the authority: these only
 * decide what blocks the save button.
 */
export interface NumericBound {
    readonly min: number;
    readonly max: number;
}
export declare const REQUESTS_PER_WINDOW_BOUND: NumericBound;
export declare const WINDOW_MS_BOUND: NumericBound;
export declare const BURST_SIZE_BOUND: NumericBound;
export declare const QUEUE_DEPTH_BOUND: NumericBound;
export declare const MAX_WAIT_MS_BOUND: NumericBound;
/**
 * Format a stored value as the draft text a control renders.
 * @param value - the stored value, possibly undefined.
 * @returns draft text; the empty string when the section carries no value.
 */
export declare function formatScalar(value: unknown): string;
/**
 * Convert draft text into the write it stages.
 * @param text - what the user typed.
 * @param kind - which value type the field accepts.
 * @param bound - inclusive numeric limits, for a `number` field.
 * @returns the staged write, or undefined when the draft is not acceptable.
 */
export declare function parseScalar(text: string, kind: 'number' | 'boolean' | 'enum', bound?: NumericBound): {
    kind: 'set';
    value: JsonValue;
} | {
    kind: 'clear';
} | undefined;
/** Staged state of the page, and the actions the renderer binds. */
export declare class RateLimitController {
    /** The shared configuration form this page stages over. */
    private readonly scope;
    private readonly staged;
    private readonly removals;
    private readonly added;
    private newRouteDraft;
    private baseline;
    private saving;
    private failed;
    private readonly listeners;
    private readonly unsubscribe;
    /** @param scope - the shared configuration form for the `llm-rate-limit` namespace. */
    constructor(scope: RateLimitScope);
    /** Release the accepted-value subscription. */
    dispose(): void;
    /**
     * Observe state changes, so a renderer can rebuild its projection.
     *
     * The controller publishes rather than owning a store: the React layer wraps
     * this in the client snapshot store it already depends on, which keeps this
     * module free of client-package imports and therefore testable in Node.
     * @param listener - invoked after every change to the scope or the drafts.
     * @returns the disposer removing this listener.
     */
    subscribe(listener: () => void): () => void;
    /** The page state a renderer projects: everything one draw needs, read once. */
    state(): CardState;
    private publish;
    /** @returns the stored section, or an empty one before the first acceptance. */
    private section;
    /** @returns the route ids the stored section carries, plus any staged additions. */
    private routes;
    /**
     * Read one control's state.
     * @param path - nested path inside the namespace section.
     * @returns the draft text, whether a save would leave an override, and whether it is invalid.
     */
    field(path: readonly string[]): FieldState;
    /**
     * Whether a row is staged for removal.
     * @param route - provider route id.
     * @returns whether the removal is pending.
     */
    removing(route: string): boolean;
    /** @returns the draft for the new-route control, and whether it names a free route. */
    newRoute(): {
        text: string;
        valid: boolean;
    };
    /** @returns the card-level state the shared form frame renders. */
    shell(): CardShell;
    private dirty;
    /**
     * Build the edit, reset, save, and discard actions the page binds.
     * @returns the page's actions.
     */
    actions(): CardActions;
    /** Stage the new-route control's draft. */
    setNewRoute(text: string): void;
    /** Every staged edit a save would write, in staging order. */
    private plan;
    /**
     * Write every staged edit as one revision-fenced mutation, then re-seed from
     * what the Host accepted.
     *
     * The Host is the authority on acceptance, so the outcome is read back rather
     * than predicted. A save that did not land keeps its drafts.
     */
    save(): Promise<void>;
}
export {};
//# sourceMappingURL=model.d.ts.map