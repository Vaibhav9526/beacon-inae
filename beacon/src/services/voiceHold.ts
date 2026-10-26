/**
 * Pure press-to-talk rules for the bottom-bar mic. No React, no native code, so the node tests can import it.
 * MicButton.tsx applies these: a press under MIN_HOLD_MS is a tap (tooltip only), a slide past SLIDE_CANCEL_PX cancels.
 */

/** A press shorter than this is a tap, not speech. */
export const MIN_HOLD_MS = 300;
/** Finger moved this far from the press point: the capture is cancelled, nothing is sent. */
export const SLIDE_CANCEL_PX = 110;
/** After release the phone recogniser gets this long to deliver its final words before the partial text is used. */
export const RELEASE_GRACE_MS = 1500;
/** A hold never listens longer than this. */
export const MAX_HOLD_MS = 15000;

export type PressEnd = 'send' | 'short' | 'cancel';

/** How a press ended: sent (held long enough), too short to be speech, or cancelled by sliding away. */
export function pressEnd(heldMs: number, slidAway: boolean): PressEnd {
  if (slidAway) return 'cancel';
  return heldMs < MIN_HOLD_MS ? 'short' : 'send';
}

/** True once the finger is far enough from where it went down. */
export function slidFarAway(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > SLIDE_CANCEL_PX;
}

/** Text to submit when the user lets go of the phone recogniser: its final words, else the last partial result. */
export function transcriptOnRelease(final: string | null | undefined, partial: string): string | null {
  const t = (final ?? '').trim() || (partial ?? '').trim();
  return t || null;
}
