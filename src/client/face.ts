/**
 * Binding the staged model to the renderer's snapshot store.
 *
 * The store is the client's own, so it is created here rather than in `model.ts`:
 * that module stays importable from a plain Node test, with no harness client
 * package resolvable, which is what makes the staged model verifiable.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

import type { RateLimitCardFace, RateLimitController } from './model.ts'

/**
 * Build the face the slot registration injects.
 *
 * Every republish rebuilds the whole projection, because one edit can change
 * several controls at once — adding a route changes the row list, and a save
 * re-seeds every field from what the Host accepted.
 * @param controller - the staged model this page owns.
 * @returns the page snapshot and its actions.
 */
export function cardFace(controller: RateLimitController): RateLimitCardFace {
  const store = createSnapshotStore(controller.state())
  controller.subscribe(() => { store.set(controller.state()) })
  return { hooks: { rateLimitCard: store }, ...controller.actions() }
}