import { type TriageChoiceId } from '../kb/triage';
import { choiceFromDescription } from './triage';
import { describePhoto, ortAvailable, useVlm } from './vlm';

/**
 * Photo -> short text description ("a bleeding cut on a hand"), done on the phone. The photo itself never leaves the
 * device. Every function here fails soft: a missing or broken model returns null and the caller falls back to the
 * guided triage without showing an error.
 */
export interface VisionStatus {
  available: boolean;
  reason?: string;
}

export const VISION_TIMEOUT_MS = 15_000;

export async function visionStatus(): Promise<VisionStatus> {
  try {
    if (!ortAvailable()) return { available: false, reason: 'photo helper is not part of this build' };
    await useVlm.getState().check();
    const s = useVlm.getState().status;
    return s === 'ready' ? { available: true } : { available: false, reason: s === 'downloading' ? 'photo helper is downloading' : 'photo helper not downloaded (Settings)' };
  } catch {
    return { available: false, reason: 'photo helper could not be checked' };
  }
}

/** Resolves to null after `ms`, so a slow model never blocks the person. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

export async function describeImage(uri: string, timeoutMs = VISION_TIMEOUT_MS): Promise<string | null> {
  const status = await visionStatus();
  if (!status.available) return null;
  const text = await withTimeout(describePhoto(uri).catch(() => null), timeoutMs);
  return text?.trim() ? text.trim() : null;
}

export interface PhotoAnalysis {
  description: string;
  /** Likely choice from the description. The person confirms it; it is never used as a diagnosis. */
  choice: TriageChoiceId | null;
}

/** Vision model if it is ready and answers in time; otherwise null and the caller uses guided triage. */
export async function analysePhoto(uri: string): Promise<PhotoAnalysis | null> {
  const description = await describeImage(uri).catch(() => null);
  if (!description) return null;
  return { description, choice: choiceFromDescription(description) };
}
