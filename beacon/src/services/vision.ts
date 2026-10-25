import { describePhoto, ortAvailable, useVlm } from './vlm';

/**
 * Photo -> short text description ("a bleeding cut on a hand"), done on the phone. The description is then given to
 * Needle / the router to pick the right guide, so the photo itself never leaves the device.
 */
export interface VisionStatus {
  available: boolean;
  reason?: string;
}

export async function visionStatus(): Promise<VisionStatus> {
  if (!ortAvailable()) return { available: false, reason: 'photo helper is not part of this build' };
  await useVlm.getState().check();
  const s = useVlm.getState().status;
  return s === 'ready' ? { available: true } : { available: false, reason: s === 'downloading' ? 'photo helper is downloading' : 'photo helper not downloaded (Settings)' };
}

export async function describeImage(uri: string): Promise<string | null> {
  if (!(await visionStatus()).available) return null;
  return describePhoto(uri);
}

/** What the picker offers when the vision model is not available: each maps to words the router understands. */
export const PHOTO_CHOICES: { emoji: string; en: string; hi: string; query: string }[] = [
  { emoji: '🩸', en: 'Bleeding cut', hi: 'खून बहता कट', query: 'bleeding deep cut' },
  { emoji: '🔥', en: 'Burn', hi: 'जलना', query: 'burn blister hot' },
  { emoji: '🦴', en: 'Swollen or bent limb', hi: 'सूजा या मुड़ा अंग', query: 'broken bone swollen arm leg' },
  { emoji: '🐍', en: 'Snake bite', hi: 'साँप का काटना', query: 'snake bite' },
  { emoji: '🐝', en: 'Sting or rash', hi: 'डंक या दाने', query: 'allergy sting swelling rash' },
  { emoji: '🧍', en: 'Person on the ground', hi: 'ज़मीन पर पड़ा व्यक्ति', query: 'unconscious not breathing collapsed' },
  { emoji: '💨', en: 'Smoke or fire', hi: 'धुआँ या आग', query: 'fire smoke' },
  { emoji: '🌊', en: 'Flood water', hi: 'बाढ़ का पानी', query: 'flood water rising' },
];
