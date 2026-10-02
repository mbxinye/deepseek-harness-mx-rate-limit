/**
 * An in-memory stand-in for the Host configuration form, so the staged model
 * can be driven without a browser. It records the writes a save performs and
 * applies them to the stored section, which is what makes the atomicity and
 * revision-fencing assertions real rather than asserted.
 */
import type { RateLimitPathOp, RateLimitScope, RateLimitScopeSnapshot } from '../../src/client/model.ts'

/** A fake scope that behaves like the Host's: writes mutate the section. */
export class FakeScope implements RateLimitScope {
  snapshot: RateLimitScopeSnapshot
  /** Every mutate call the page made, with the fence it used. */
  readonly writes: { ops: readonly RateLimitPathOp[]; revision: number | undefined }[] = []
  /** When set, the next mutate reports refusal without applying. */
  refuseNext = false

  /**
   * @param value - the accepted section this scope serves.
   * @param overrides - partial snapshot fields to change.
   */
  constructor(value: RateLimitScopeSnapshot['value'], overrides: Partial<RateLimitScopeSnapshot> = {}) {
    this.snapshot = {
      status: 'ready',
      value,
      base: value,
      user: structuredClone(value),
      writable: true,
      revision: 1,
      ...overrides,
    }
  }

  getSnapshot = (): RateLimitScopeSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listener = listener
    return () => { this.listener = undefined }
  }

  private listener: (() => void) | undefined

  /** Push a new accepted section, as a Host acknowledgement would. */
  accept(next: RateLimitScopeSnapshot['value']): void {
    this.snapshot = { ...this.snapshot, value: next, revision: (this.snapshot.revision ?? 0) + 1 }
    this.listener?.()
  }

  mutate = async (ops: readonly RateLimitPathOp[], expectedRevision?: number): Promise<boolean> => {
    this.writes.push({ ops, revision: expectedRevision })
    if (this.refuseNext) {
      this.refuseNext = false
      return false
    }
    const root = structuredClone(this.snapshot.value ?? {}) as Record<string, unknown>
    for (const op of ops) this.apply(root, op)
    this.snapshot = { ...this.snapshot, value: root, revision: (this.snapshot.revision ?? 0) + 1 }
    this.listener?.()
    return true
  }

  private apply(node: Record<string, unknown>, op: RateLimitPathOp): void {
    const [head, ...rest] = op.path
    if (head === undefined) return
    if (rest.length === 0) {
      if (op.op === 'unset') delete node[head]
      else node[head] = structuredClone(op.value)
      return
    }
    const child = node[head]
    const target = child !== null && typeof child === 'object' && !Array.isArray(child)
      ? child as Record<string, unknown>
      : {}
    node[head] = target
    this.apply(target, { ...op, path: rest })
  }
}