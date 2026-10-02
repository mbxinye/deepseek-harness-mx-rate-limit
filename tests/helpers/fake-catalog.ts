/**
 * An in-memory stand-in for the provider namespace whose dict keys are the routes.
 * It records the listeners the controller attaches, so a republish can be tested
 * the way the page actually experiences one.
 */
import type { RouteCatalog } from '../../src/client/model.ts'

/** A fake catalog serving one set of provider routes. */
export class FakeCatalog implements RouteCatalog {
  snapshot: { status: 'loading' | 'ready' | 'unavailable'; value: unknown }
  /** Every republish the controller triggered. */
  publishes = 0
  private listeners = new Set<() => void>()

  /** @param providers - the route ids this deployment has. */
  constructor(providers: string[], status: 'loading' | 'ready' | 'unavailable' = 'ready') {
    this.snapshot = {
      status,
      value: status === 'ready' ? { providers: Object.fromEntries(providers.map(p => [p, {}])) } : undefined,
    }
  }

  getSnapshot = () => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Replace the served routes, as a Host acceptance would. */
  serve(providers: string[]): void {
    this.snapshot = { status: 'ready', value: { providers: Object.fromEntries(providers.map(p => [p, {}])) } }
    for (const listener of this.listeners) listener()
  }

  /** @returns how many listeners the controller currently holds. */
  get listenerCount(): number {
    return this.listeners.size
  }
}