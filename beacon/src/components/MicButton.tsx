import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useLang } from '../i18n';
import { ElevenError, transcribe, useEleven } from '../services/elevenlabs';
import { VOICE_TEXT } from '../ai/navigate';
import { beginListen, currentEngine, ensureMic, voiceSupported } from '../services/voice';
import { useVosk, voskInstalled, voskSupported } from '../services/vosk';
import { MAX_HOLD_MS, pressEnd, slidFarAway } from '../services/voiceHold';
import { useSettings } from '../state/settings';
import { Icon } from './Icon';
import { useOnline } from './Status';
import { Press, useTheme } from './ui';

// expo-audio has native code that older builds lack; without it the mic falls back to the on-device recogniser
type AudioMod = typeof import('expo-audio');
let audioMod: AudioMod | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  audioMod = require('expo-audio') as AudioMod;
} catch {
  audioMod = null;
}
const useRecorder: AudioMod['useAudioRecorder'] = audioMod ? audioMod.useAudioRecorder : ((() => null) as never);

export type MicState = 'idle' | 'listening' | 'thinking' | 'error';

export interface VoiceCaptureOptions {
  /** Called at press-in (for a haptic tick). */
  onStart?: () => void;
  onState?: (s: MicState) => void;
  /** Called with a readable reason when speech fails (cloud error, or no phone recogniser). Never throws into the app. */
  onError?: (reason: string) => void;
}

/** After a permission or key failure the cloud is skipped for this long; the phone's recogniser is used meanwhile. */
const CLOUD_BLOCK_MS = 10 * 60 * 1000;
let cloudBlockedUntil = 0;
const cloudBlocked = () => Date.now() < cloudBlockedUntil;

// a new or changed key (save, clear) lifts the block at once. setVoice also changes `voices`, which only costs one retry.
let lastKeyState: { has: boolean; voices: unknown } | null = null;
useEleven.subscribe((s) => {
  if (lastKeyState && (s.has !== lastKeyState.has || s.voices !== lastKeyState.voices)) cloudBlockedUntil = 0;
  lastKeyState = { has: s.has, voices: s.voices };
});

/**
 * Every voice message (listening, heard nothing, mic off, no recogniser) goes here. VoiceDock's useVoiceCommands
 * subscribes and shows it as a spoken + written reply, so a press never ends in silence.
 */
export interface VoiceNotice {
  text: string;
  kind: 'listening' | 'mic' | 'recogniser' | 'empty' | 'error' | 'download';
}
type NoticeFn = (n: VoiceNotice) => void;
const noticeListeners = new Set<NoticeFn>();
export function subscribeVoiceNotice(fn: NoticeFn): () => void {
  noticeListeners.add(fn);
  return () => {
    noticeListeners.delete(fn);
  };
}
export function emitVoiceNotice(n: VoiceNotice): void {
  console.log('[voice] notice', n.kind, n.text);
  noticeListeners.forEach((fn) => {
    try {
      fn(n);
    } catch {
      /* a broken listener must not break the mic */
    }
  });
}

const NO_PHONE_VOICE = 'Voice input is not available on this phone: install or update the Google speech service and the Hindi/English voice packs';

function phoneRecogniserReady(): boolean {
  try {
    return voiceSupported() && currentEngine() !== 'none';
  } catch {
    return false;
  }
}

/** A key that is rejected, or lacks a permission: speech will keep failing until the key or the plan changes. */
function isAuthFailure(e: unknown): boolean {
  if (!(e instanceof ElevenError)) return false;
  return e.kind === 'permission' || e.kind === 'invalid_key' || e.status === 401 || e.status === 403;
}

function reasonOf(e: unknown): string {
  if (e instanceof ElevenError) return e.reason || `HTTP ${e.status}`;
  return 'no connection to the speech service';
}

let lastOffer = 0;
/**
 * Pressing the mic while the offline model is missing (and the Google recogniser is being used instead) shows the
 * download card, at most once every 5 minutes. The press itself carries on with the Google recogniser.
 */
function offerOfflineVoice(): void {
  try {
    const s = useSettings.getState();
    if (!s.offlineVoice || !voskSupported() || voskInstalled() || useVosk.getState().dl.status === 'downloading') return;
    if (Date.now() - lastOffer < 5 * 60 * 1000) return;
    lastOffer = Date.now();
    emitVoiceNotice({ text: '', kind: 'download' });
  } catch {
    /* the offer is optional */
  }
}

/** One press, from press-in to the end of its capture. Only one can exist at a time. */
interface Session {
  pressedAt: number;
  startedAt: number;
  slid: boolean;
  stopReason: null | 'release' | 'short' | 'slid';
  stopped: Promise<void>;
  signalStop: () => void;
}

const HINT_MS = 2200;

/**
 * The speech capture behind every mic in the app. Push-to-talk: press in starts listening (cloud recording when an
 * ElevenLabs key is set, otherwise the phone's recogniser), release sends. A press under MIN_HOLD_MS is a tap and
 * only shows the "Hold to talk" hint. Sliding the finger far away cancels. One capture at a time; every path ends
 * back in 'idle'. `onText` gets the recognised words, and every outcome is also emitted as a voice notice.
 */
export function useVoiceCapture(onText: (text: string) => void, opts: VoiceCaptureOptions = {}) {
  const lang = useLang();
  const hasKey = useEleven((s) => s.has);
  const online = useOnline();
  const recorder = useRecorder(audioMod?.RecordingPresets.HIGH_QUALITY ?? ({} as never));
  const [state, setState] = useState<MicState>('idle');
  const [partial, setPartial] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const session = useRef<Session | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  // live check, so a block that expires (or a key that changes) applies to the next press without a re-render
  const cloudOk = () => !!audioMod && hasKey && online && Platform.OS !== 'web' && !cloudBlocked();
  const cloud = cloudOk();

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (errTimer.current) clearTimeout(errTimer.current);
      if (hintTimer.current) clearTimeout(hintTimer.current);
      // unmounted mid-press: cancel, so nothing keeps listening
      const s = session.current;
      if (s && !s.stopReason) {
        s.stopReason = 'slid';
        s.signalStop();
      }
    };
  }, []);

  const set = (s: MicState) => {
    if (alive.current) setState(s);
    try {
      opts.onState?.(s);
    } catch {
      /* a broken listener must not break the mic */
    }
  };

  const notify = (msg: string, kind: VoiceNotice['kind'] = 'error') => {
    try {
      opts.onError?.(msg);
    } catch {
      /* ignore */
    }
    emitVoiceNotice({ text: msg, kind });
  };
  const micOff = () => notify(VOICE_TEXT.micOff(lang), 'mic');

  // error state shows for 1.5 s, then the mic is idle again
  const fail = () => {
    set('error');
    if (errTimer.current) clearTimeout(errTimer.current);
    errTimer.current = setTimeout(() => {
      errTimer.current = null;
      set('idle');
    }, 1500);
  };

  const flashHint = () => {
    if (!alive.current) return;
    setHint(VOICE_TEXT.holdToTalk(lang));
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), HINT_MS);
  };

  /** The cloud call failed after a recording: say why once, and block the cloud for auth failures. */
  const reportCloudFailure = (e: unknown) => {
    const reason = reasonOf(e);
    if (!phoneRecogniserReady()) {
      if (isAuthFailure(e)) cloudBlockedUntil = Date.now() + CLOUD_BLOCK_MS;
      notify(NO_PHONE_VOICE, 'recogniser');
    } else if (isAuthFailure(e)) {
      cloudBlockedUntil = Date.now() + CLOUD_BLOCK_MS;
      notify(`Speech service said: ${reason}. Using the phone's voice recogniser: hold and speak again`);
    } else {
      notify(`Speech service said: ${reason}. Try again`);
    }
    fail();
  };

  /** Cloud: record while held, then transcribe on release. */
  const runCloud = async (s: Session) => {
    if (!(await audioMod!.requestRecordingPermissionsAsync()).granted) {
      micOff();
      return fail();
    }
    await audioMod!.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder!.prepareToRecordAsync();
    if (s.stopReason) {
      // let go while the recorder was getting ready: nothing was recorded
      await audioMod!.setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      if (s.stopReason === 'release') notify(VOICE_TEXT.tooShort(lang), 'empty');
      return;
    }
    recorder!.record();
    s.startedAt = Date.now();
    set('listening');
    emitVoiceNotice({ text: VOICE_TEXT.listening(lang), kind: 'listening' });
    await s.stopped;
    try {
      await recorder!.stop();
    } catch {
      /* already stopped */
    }
    await audioMod!.setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    if (s.stopReason !== 'release') return; // short tap or slide: already handled
    const uri = recorder!.uri;
    if (!uri) return notify(VOICE_TEXT.tooShort(lang), 'empty');
    set('thinking');
    emitVoiceNotice({ text: VOICE_TEXT.working(lang), kind: 'listening' });
    let text: string | null;
    try {
      text = await transcribe(uri, lang);
    } catch (e) {
      console.log('[voice] cloud transcribe failed', reasonOf(e));
      return reportCloudFailure(e);
    }
    console.log('[voice] heard (cloud)', text);
    set('idle');
    if (text) onText(text);
    else notify(VOICE_TEXT.notHeard(lang), 'empty');
  };

  /** Phone: the on-device recogniser listens while held; release waits a moment for the final words. */
  const runPhone = async (s: Session) => {
    if (!phoneRecogniserReady()) {
      notify(NO_PHONE_VOICE, 'recogniser');
      return fail();
    }
    if (!(await ensureMic())) {
      micOff();
      return fail();
    }
    if (s.stopReason) {
      console.log('[voice] let go before the recogniser started', s.stopReason);
      return;
    }
    set('listening');
    emitVoiceNotice({ text: VOICE_TEXT.listening(lang), kind: 'listening' });
    offerOfflineVoice();
    const listen = beginListen(lang, {
      maxMs: MAX_HOLD_MS,
      onPartial: (t) => {
        if (alive.current) setPartial(t);
      },
    });
    void s.stopped.then(() => (s.stopReason === 'release' ? listen.release() : listen.cancel()));
    const r = await listen.result;
    set('idle');
    if (r.reason === 'ok' && r.text) {
      console.log('[voice] heard (phone)', r.text);
      return onText(r.text);
    }
    if (r.reason === 'cancelled') return;
    if (r.reason === 'denied') {
      micOff();
      return fail();
    }
    if (r.reason === 'unavailable' || r.reason === 'error') {
      notify(VOICE_TEXT.recogniserError(lang), 'recogniser');
      return fail();
    }
    notify(VOICE_TEXT.notHeard(lang), 'empty'); // silence or no-match
  };

  const pressIn = () => {
    if (session.current) {
      console.log('[voice] press ignored: a capture is already running');
      return;
    }
    if (hintTimer.current) clearTimeout(hintTimer.current);
    if (alive.current) setHint(null);
    let signal: () => void = () => {};
    const stopped = new Promise<void>((resolve) => {
      signal = resolve;
    });
    const s: Session = { pressedAt: Date.now(), startedAt: 0, slid: false, stopReason: null, stopped, signalStop: () => signal() };
    session.current = s;
    const useCloud = cloudOk();
    console.log('[voice] press in', useCloud ? 'cloud' : 'phone');
    opts.onStart?.();
    const run = useCloud ? runCloud(s) : runPhone(s);
    run
      .catch((e: unknown) => {
        console.log('[voice] capture failed', String(e));
        notify(VOICE_TEXT.error(lang));
        fail();
      })
      .finally(() => {
        if (session.current === s) session.current = null;
        if (alive.current) setPartial('');
        if (!errTimer.current) set('idle');
        console.log('[voice] capture finished', s.stopReason ?? 'none');
      });
  };

  const pressOut = () => {
    const s = session.current;
    if (!s || s.stopReason) return;
    const end = pressEnd(Date.now() - s.pressedAt, s.slid);
    console.log('[voice] press out', end, Date.now() - s.pressedAt, 'ms');
    if (end === 'short') {
      s.stopReason = 'short';
      flashHint();
    } else if (end === 'cancel') {
      s.stopReason = 'slid';
    } else {
      s.stopReason = 'release';
    }
    s.signalStop();
  };

  /** Finger moved from the press point. Far enough cancels the capture; nothing is sent. */
  const slide = (dx: number, dy: number) => {
    const s = session.current;
    if (!s || s.stopReason || !slidFarAway(dx, dy)) return;
    s.slid = true;
    s.stopReason = 'slid';
    console.log('[voice] slid away, cancelled');
    notify(VOICE_TEXT.cancelled(lang), 'empty');
    s.signalStop();
  };

  return {
    state,
    partial,
    hint,
    cloud,
    /** Let go shorter than MIN_HOLD_MS (or a tap with a screen reader) shows the hint. */
    onPressIn: pressIn,
    onPressOut: pressOut,
    onPress: () => {
      if (!session.current) flashHint();
    },
    onSlide: slide,
  };
}

/**
 * Speak to the app. Press and hold to talk (see `useVoiceCapture`).
 */
export function MicButton({
  onText,
  onState,
  onError,
  size = 40,
  filled,
}: {
  onText: (text: string) => void;
  onState?: (s: MicState) => void;
  onError?: (reason: string) => void;
  size?: number;
  filled?: boolean;
}) {
  const { p } = useTheme();
  const haptics = useSettings((s) => s.haptics);
  const buzz = () => haptics && Platform.OS !== 'web' && Haptics.selectionAsync().catch(() => {});
  const { state, onPressIn, onPressOut, onPress } = useVoiceCapture(onText, { onState, onError, onStart: buzz });
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (state === 'listening') pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) }), -1, false);
    else {
      cancelAnimation(pulse);
      pulse.value = 0;
    }
  }, [state, pulse]);
  const ring = useAnimatedStyle(() => ({ opacity: 0.35 * (1 - pulse.value), transform: [{ scale: 1 + pulse.value * 0.9 }] }));

  const bg = filled || state === 'listening' ? p.accent : p.cardAlt;
  const fg = filled || state === 'listening' ? p.onAccent : p.text;
  return (
    <Press accessibilityRole="button" accessibilityLabel="Hold to talk" onPressIn={onPressIn} onPressOut={onPressOut} onPress={onPress} haptic={false} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: p.accent }, ring]} />
      <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: state === 'error' ? p.danger : bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={state === 'thinking' ? 'sparkle' : 'mic'} size={size * 0.44} color={state === 'error' ? '#fff' : fg} />
      </Animated.View>
    </Press>
  );
}

