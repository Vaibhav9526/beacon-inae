/**
 * Pure rules for the offline (Vosk) recogniser: which engine to use, the phrase list for command mode, the model
 * download state machine and a few text helpers. No React, no native code, so the node tests can import it.
 */
import { SCREENS } from '../ai/intents';
import type { Lang } from '../kb/types';

// ---- models ----

export type VoskLang = 'en' | 'hi';

/** Published files (https://alphacephei.com/vosk/models). Sizes are the exact zip byte counts the native side checks. */
export const VOSK_MODELS: Record<VoskLang, { name: string; url: string; bytes: number; mb: number; label: string }> = {
  en: { name: 'vosk-model-small-en-in-0.4', url: 'https://alphacephei.com/vosk/models/vosk-model-small-en-in-0.4.zip', bytes: 37573330, mb: 36, label: 'English (India)' },
  hi: { name: 'vosk-model-small-hi-0.22', url: 'https://alphacephei.com/vosk/models/vosk-model-small-hi-0.22.zip', bytes: 44458845, mb: 42, label: 'हिन्दी' },
};

// ---- engine order ----

export type Engine = 'vosk' | 'google' | 'none';

export interface EngineInputs {
  /** Settings: "Offline voice" is switched on. */
  enabled: boolean;
  /** This build has the Vosk native code. */
  nativeVosk: boolean;
  /** The model for the chosen language is on the phone. */
  installed: boolean;
  /** The phone's own (Google) recogniser reports itself available. */
  googleAvailable: boolean;
}

/** Vosk when its model is installed, else the Google recogniser, never both. */
export function pickEngine(i: EngineInputs): Engine {
  if (i.enabled && i.nativeVosk && i.installed) return 'vosk';
  if (i.googleAvailable) return 'google';
  return 'none';
}

// ---- download state machine ----

export type DlStatus = 'unknown' | 'missing' | 'downloading' | 'ready' | 'error';
export interface DlState {
  status: DlStatus;
  /** 0..100 */
  pct: number;
  error: string | null;
}
export type DlEvent =
  | { t: 'checked'; installed: boolean }
  | { t: 'start' }
  | { t: 'progress'; pct: number }
  | { t: 'done' }
  | { t: 'fail'; error: string }
  | { t: 'cancelled' }
  | { t: 'removed' };

export const DL_INITIAL: DlState = { status: 'unknown', pct: 0, error: null };

export function dlReduce(s: DlState, e: DlEvent): DlState {
  switch (e.t) {
    case 'checked':
      // a check never interrupts a running download
      if (s.status === 'downloading') return s;
      return e.installed ? { status: 'ready', pct: 100, error: null } : { status: 'missing', pct: 0, error: null };
    case 'start':
      return s.status === 'downloading' ? s : { status: 'downloading', pct: 0, error: null };
    case 'progress':
      // progress only counts while downloading, only moves forward, and stays within 0..100
      if (s.status !== 'downloading') return s;
      return { ...s, pct: Math.max(s.pct, Math.min(100, Math.max(0, Math.round(e.pct)))) };
    case 'done':
      return { status: 'ready', pct: 100, error: null };
    case 'fail':
      return { status: 'error', pct: 0, error: e.error };
    case 'cancelled':
      return { status: 'missing', pct: 0, error: null };
    case 'removed':
      return { status: 'missing', pct: 0, error: null };
  }
}

/** Download once on the first start when the switch is on, no model is there, and nothing was tried before. */
export function shouldAutoDownload(i: { enabled: boolean; alreadyTried: boolean; status: DlStatus; nativeVosk: boolean; online: boolean }): boolean {
  return i.enabled && !i.alreadyTried && i.nativeVosk && i.online && (i.status === 'missing' || i.status === 'unknown');
}

// ---- text ----

/** Vosk writes "[unk]" for words outside a phrase list. Removes them and tidies spaces. */
export function cleanVoskText(text: string | null | undefined): string {
  return (text ?? '').replace(/\[unk\]/gi, ' ').replace(/\s+/g, ' ').trim();
}

/** True when a grammar-mode result carries no usable words. */
export const onlyUnknown = (text: string | null | undefined) => !!(text ?? '').trim() && cleanVoskText(text) === '';

const norm = (s: string) =>
  s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const LATIN = /^[a-z0-9 ]+$/;
const DEVANAGARI = /^[ऀ-ॿ ]+$/;

const FIXED: Record<VoskLang, string[]> = {
  en: [
    'call one one two', 'call emergency', 'call police', 'call ambulance', 'i am safe', 'i am okay', 'help', 'help me', 'send sos', 'sos', 'emergency',
    'yes', 'no', 'cancel', 'stop', 'never mind', 'go back', 'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'one one two', 'one zero zero', 'one zero one', 'one zero eight',
  ],
  hi: [
    'एक सौ बारह', 'एक सौ बारह पर कॉल करो', 'पुलिस को फोन करो', 'एम्बुलेंस बुलाओ', 'मैं सुरक्षित हूँ', 'मैं ठीक हूँ', 'मदद', 'मदद करो', 'बचाओ', 'एसओएस भेजो',
    'हाँ', 'नहीं', 'रद्द करो', 'रुको', 'वापस जाओ', 'शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ', 'दस',
  ],
};

const VERBS: Record<VoskLang, string[]> = { en: ['open', 'show', 'go to'], hi: ['खोलो', 'दिखाओ'] };

/**
 * Phrase list for command mode: every screen name and alias in the language's script, alone and after "open" / "show",
 * the emergency phrases and numbers, and "[unk]" so other speech does not get forced onto the nearest phrase.
 */
export function buildGrammar(lang: Lang): string[] {
  const l: VoskLang = lang === 'hi' ? 'hi' : 'en';
  const script = l === 'hi' ? DEVANAGARI : LATIN;
  const out = new Set<string>(FIXED[l]);
  for (const sc of Object.values(SCREENS)) {
    for (const raw of [...sc.aliases, l === 'hi' ? sc.hi : sc.en]) {
      const a = norm(raw);
      if (!a || !script.test(a)) continue;
      out.add(a);
      for (const v of VERBS[l]) out.add(`${v} ${a}`);
    }
  }
  out.add('[unk]');
  return [...out];
}
