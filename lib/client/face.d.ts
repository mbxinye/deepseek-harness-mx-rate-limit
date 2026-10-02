import type { RateLimitCardFace, RateLimitController } from './model.ts';
/**
 * Build the face the slot registration injects.
 *
 * Every republish rebuilds the whole projection, because one edit can change
 * several controls at once — adding a route changes the row list, and a save
 * re-seeds every field from what the Host accepted.
 * @param controller - the staged model this page owns.
 * @returns the page snapshot and its actions.
 */
export declare function cardFace(controller: RateLimitController): RateLimitCardFace;
//# sourceMappingURL=face.d.ts.map