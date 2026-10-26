import { PermissionsAndroid, Platform } from 'react-native';
import { create } from 'zustand';
import native from '../../modules/beacon-ai';
import type { Lang } from '../kb/types';
import { useSettings } from '../state/settings';
import { transcriptOnRelease, RELEASE_GRACE_MS } from './voiceHold';
import { voskInstalled, voskLang, voskSupported } from './vosk';
import { buildGrammar, cleanVoskText, onlyUnknown, pickEngine, type Engine } from './voskLogic';

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

export interface ListenOptions {
  maxMs?: number;
  onPartial?: (text: string) => void;
  /** 'free' (default): any speech. 'command': Vosk is limited to the app's phrases (see buildGrammar); other speech comes back empty. */
  mode?: 'free' | 'command';
}

/** Which recogniser a listen would use right now: our offline one when its model is installed, else Google's, never both. */
export function currentEngine(): Engine {
  const s = useSettings.getState();
  return pickEngine({
    enabled: s.offlineVoice,
    nativeVosk: voskSupported(),
    installed: voskInstalled(),
    googleAvailable: voiceSupported() && !!voiceStatus().available,
  });
}

/**
 * Start a single hold-to-talk listen and say why it ended. Used by the mic buttons (press in = start, release =
 * release()) and by `listenOnce`. Vosk when its model is installed; if it cannot start, the Google recogniser is
 * used instead (only after Vosk has fully stopped). Every path resolves the result.
 */
export function beginListen(lang: Lang, opts: ListenOptions = {}): PhoneListen {
  if (currentEngine() !== 'vosk') return beginGoogleListen(lang, opts);
  let released = false;
  let cancelled = false;
  let fallback: PhoneListen | null = null;
  const v = beginVoskListen(lang, opts);
  const result = v.result.then((r) => {
    // Vosk could not start (no mic, load error): fall back to Google unless the user already let go
    if (r.reason === 'error' && r.text === null && v.failedToStart() && !released && !cancelled) {
      console.log('[voice] vosk failed to start, using the Google recogniser');
      fallback = beginGoogleListen(lang, opts);
      return fallback.result;
    }
    return r;
  });
  return {
    result,
    release() {
      released = true;
      v.release();
      fallback?.release();
    },
    cancel() {
      cancelled = true;
      v.cancel();
      fallback?.cancel();
    },
  };
}

interface VoskListen extends PhoneListen {
  failedToStart(): boolean;
}

/** Hold-to-talk on Vosk. Release stops the recogniser, which flushes what it heard at once: no grace wait. */
function beginVoskListen(lang: Lang, opts: ListenOptions): VoskListen {
  let resolveResult!: (r: ListenResult) => void;
  const result = new Promise<ListenResult>((r) => {
    resolveResult = r;
  });
  const rec = native!;
  const vl = voskLang();
  let done = false;
  let startFailed = false;
  let partial = '';
  const subs: { remove(): void }[] = [];
  const command = opts.mode === 'command';

  const finish = (text: string | null, reason: ListenReason) => {
    if (done) return;
    done = true;
    clearTimeout(maxTimer);
    subs.forEach((s) => s.remove());
    useVoice.setState({ listening: false, partial: '' });
    console.log('[voice] listen end (vosk)', reason, text ?? '');
    resolveResult({ text, reason });
  };
  const stopAndFinish = async () => {
    if (done) return;
    let text = '';
    try {
      text = (await rec.voskStop()).text;
    } catch {
      /* use what we heard */
    }
    // command mode: a phrase list result that is only "[unk]" means nothing recognisable was said
    const heard = cleanVoskText(text) || cleanVoskText(partial);
    if (heard) finish(heard, 'ok');
    else finish(null, command && (onlyUnknown(text) || onlyUnknown(partial)) ? 'no-match' : 'silence');
  };
  const maxTimer = setTimeout(() => void stopAndFinish(), opts.maxMs ?? 9000);

  subs.push(
    rec.addListener('voskPartial', (e) => {
      partial = e.text;
      const clean = cleanVoskText(e.text);
      useVoice.setState({ partial: clean });
      opts.onPartial?.(clean);
    }),
    rec.addListener('voskError', (e) => {
      console.log('[voice] vosk error', e.code, e.message);
      useVoice.setState({ error: e.message });
    }),
  );

  stopWake();
  const grammar = command ? buildGrammar(vl) : null;
  rec
    .voskStart(vl, grammar)
    .then((r) => {
      if (!r.ok) {
        startFailed = true;
        useVoice.setState({ error: r.error ?? 'could not start' });
        finish(null, 'error');
      } else if (!done) {
        useVoice.setState({ listening: true, error: null });
      }
    })
    .catch(() => {
      startFailed = true;
      finish(null, 'error');
    });

  return {
    result,
    failedToStart: () => startFailed,
    release() {
      void stopAndFinish();
    },
    cancel() {
      if (!done) {
        try {
          rec.voskCancel();
        } catch {
          /* already stopped */
        }
        finish(null, 'cancelled');
      }
    },
  };
}

/**
 * The Google (phone) recogniser: start it and say why it ended. Release waits RELEASE_GRACE_MS for the final words.
 */
function beginGoogleListen(lang: Lang, opts: ListenOptions = {}): PhoneListen {
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
