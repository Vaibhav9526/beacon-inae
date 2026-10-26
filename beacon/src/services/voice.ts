import { PermissionsAndroid, Platform } from 'react-native';
import { create } from 'zustand';
import native from '../../modules/beacon-ai';
import type { Lang } from '../kb/types';
import { useSettings } from '../state/settings';
import { transcriptOnRelease, RELEASE_GRACE_MS } from './voiceHold';

/** Phrases the recogniser may produce for "Hey Beacon" in English and Hindi (it is a made-up word, so it is spelled many ways). */
const WAKE = [
  /\bh?ey,? (beacon|beckon|bacon|bikon|beakon|bekan|beeken)\b/i,
  /\bok(ay)? (beacon|beckon|bikon)\b/i,
  /\bhi,? (beacon|beckon)\b/i,
  /(हे|हेय|हैलो|ओके)\s*(बीकन|बिकन|बेकन|बीकॉन|बीकान)/,
  /\bbeacon\b/i,
];

export const stripWake = (text: string): { woke: boolean; command: string } => {
  for (const re of WAKE) {
    const m = text.match(re);
    if (m && m.index !== undefined) return { woke: true, command: text.slice(m.index + m[0].length).replace(/^[\s,.!:-]+/, '').trim() };
  }
  return { woke: false, command: '' };
};

export const voiceSupported = () => !!native && Platform.OS === 'android';

export function voiceStatus() {
  try {
    return native?.voiceStatus() ?? { available: false, onDevice: false };
  } catch {
    return { available: false, onDevice: false };
  }
}

export async function ensureMic(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

const code = (l: Lang) => (l === 'hi' ? 'hi-IN' : 'en-IN');

interface VoiceState {
  listening: boolean;
  partial: string;
  wake: boolean; // continuous "Hey Beacon" mode on
  error: string | null;
}
export const useVoice = create<VoiceState>(() => ({ listening: false, partial: '', wake: false, error: null }));

/** Why a single listen ended. 'ok' means text was heard. 'cancelled' means the user let go or slid away on purpose. */
export type ListenReason = 'ok' | 'no-match' | 'denied' | 'unavailable' | 'error' | 'silence' | 'cancelled';

export interface ListenResult {
  text: string | null;
  reason: ListenReason;
}

/**
 * Only a stop that follows a `listening` state ends a listen. The native side also emits `stopped` when it resets
 * just before starting, and that must not end the listen before the recogniser is up.
 */
export function listenEndsOn(state: 'listening' | 'stopped' | 'error', armed: boolean): boolean {
  return state === 'error' || (state === 'stopped' && armed);
}

export interface PhoneListen {
  /** Resolves once: a final result, an error, a stop, the max time, a cancel, or the release grace ending. */
  result: Promise<ListenResult>;
  /** The user let go. Wait RELEASE_GRACE_MS for the final words, then submit the best text heard. */
  release(): void;
  /** Stop now and discard what was heard. */
  cancel(): void;
}

/**
 * Start the phone's own recogniser and say why it ended. Used by the hold-to-talk mic (press in = start, release =
 * release()) and by `listenOnce`. Every path resolves the result, so the caller can always reset its state.
 */
export function beginListen(lang: Lang, opts: { maxMs?: number; onPartial?: (text: string) => void } = {}): PhoneListen {
  let resolveResult!: (r: ListenResult) => void;
  const result = new Promise<ListenResult>((r) => {
    resolveResult = r;
  });
  if (!native) {
    resolveResult({ text: null, reason: 'unavailable' });
    return { result, release: () => {}, cancel: () => {} };
  }
  const rec = native;
  let done = false;
  let armed = false; // true once the recogniser reported `listening`
  let partial = '';
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  const subs: { remove(): void }[] = [];

  const finish = (text: string | null, reason: ListenReason) => {
    if (done) return;
    done = true;
    clearTimeout(maxTimer);
    if (graceTimer) clearTimeout(graceTimer);
    subs.forEach((s) => s.remove());
    void rec.voiceStop().catch(() => {});
    useVoice.setState({ listening: false, partial: '' });
    console.log('[voice] listen end', reason, text ?? '');
    resolveResult({ text, reason });
  };
  // whatever was heard so far is the answer when time runs out or the recogniser stops without a final result
  const endWithPartial = () => {
    const t = transcriptOnRelease(null, partial);
    finish(t, t ? 'ok' : 'silence');
  };
  const maxTimer = setTimeout(endWithPartial, opts.maxMs ?? 9000);

  subs.push(
    rec.addListener('onVoiceResult', (e) => {
      partial = e.text;
      useVoice.setState({ partial: e.text });
      opts.onPartial?.(e.text);
      if (!e.final) return;
      if (e.text.trim()) finish(e.text.trim(), 'ok');
      else finish(null, 'no-match');
    }),
    rec.addListener('onVoiceState', (e) => {
      if (e.state === 'listening') {
        armed = true;
        useVoice.setState({ listening: true, error: null });
        return;
      }
      if (!listenEndsOn(e.state, armed)) return;
      if (e.state === 'error') {
        const msg = e.message ?? 'error';
        useVoice.setState({ error: msg });
        const t = transcriptOnRelease(null, partial);
        if (t) finish(t, 'ok');
        else finish(null, /permission/i.test(msg) ? 'denied' : 'error');
      } else {
        endWithPartial();
      }
    }),
  );

  // stopping first is ordered on the native main thread, so the start below runs after the stop
  stopWake();
  rec.voiceStart(code(lang), false).catch(() => finish(null, 'unavailable'));

  return {
    result,
    release() {
      if (done || graceTimer) return;
      graceTimer = setTimeout(endWithPartial, RELEASE_GRACE_MS);
    },
    cancel() {
      finish(null, 'cancelled');
    },
  };
}

/** Listen once and say why it ended. Resolves as soon as the native side reports a final result, an error or a stop. */
export async function listenOnceDetailed(lang: Lang, timeoutMs = 9000): Promise<ListenResult> {
  if (!native) return { text: null, reason: 'unavailable' };
  if (!(await ensureMic())) return { text: null, reason: 'denied' };
  return beginListen(lang, { maxMs: timeoutMs }).result;
}

/** Listen once and resolve with what was said (or null on silence, error or no support). See listenOnceDetailed. */
export async function listenOnce(lang: Lang, timeoutMs = 9000): Promise<string | null> {
  return (await listenOnceDetailed(lang, timeoutMs)).text;
}

let wakeSubs: { remove(): void }[] = [];
let awaiting = false;

/**
 * "Hey Beacon, ..." mode. Keeps the recogniser running; when it hears the wake phrase followed by a command it calls
 * `onCommand(command)`. If only "Hey Beacon" is heard the next utterance is taken as the command.
 */
export async function startWake(lang: Lang, onCommand: (text: string) => void, onWake?: () => void): Promise<boolean> {
  if (!native || !(await ensureMic())) return false;
  stopWake();
  awaiting = false;
  wakeSubs.push(
    native.addListener('onVoiceResult', (e) => {
      useVoice.setState({ partial: e.text });
      if (!e.final) return;
      const { woke, command } = stripWake(e.text);
      if (awaiting) {
        awaiting = false;
        onCommand((woke ? command : e.text).trim());
      } else if (woke) {
        if (command) onCommand(command);
        else {
          awaiting = true;
          onWake?.();
        }
      }
    }),
    native.addListener('onVoiceState', (e) => {
      if (e.state === 'listening') useVoice.setState({ listening: true, error: null });
      if (e.state === 'error') useVoice.setState({ error: e.message ?? 'error' });
      if (e.state === 'stopped') useVoice.setState({ listening: false });
    }),
  );
  try {
    await native.voiceStart(code(lang), true);
  } catch {
    stopWake(); // drop the listeners we just added
    return false;
  }
  useVoice.setState({ wake: true });
  return true;
}

export function stopWake() {
  wakeSubs.forEach((s) => s.remove());
  wakeSubs = [];
  useVoice.setState({ wake: false, listening: false, partial: '' });
  native?.voiceStop().catch(() => {});
}

export async function stopVoice() {
  stopWake();
  await native?.voiceStop();
}

export const voiceEnabledSetting = () => useSettings.getState().voiceControl;
