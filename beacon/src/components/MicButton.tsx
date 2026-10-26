import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useLang } from '../i18n';
import { ElevenError, transcribe, useEleven } from '../services/elevenlabs';
import { listenOnce, voiceStatus, voiceSupported } from '../services/voice';
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
  /** Called once when listening starts (for a haptic tick). */
  onStart?: () => void;
  onState?: (s: MicState) => void;
  /** Called once with a readable reason when speech fails (cloud error, or no phone recogniser). Never throws into the app. */
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

const NO_PHONE_VOICE = 'Voice input is not available on this phone: install or update the Google speech service and the Hindi/English voice packs';

function phoneRecogniserReady(): boolean {
  try {
    return voiceSupported() && !!voiceStatus().available;
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

/**
 * The speech capture behind every mic in the app. With an ElevenLabs key and internet: press and hold, release to
 * send (Scribe, Hindi and English). Without: tap once and the phone's on-device recogniser listens.
 * If the cloud fails with a permission or key error, the reason is reported through `onError` and the phone's
 * recogniser is used for the next taps for 10 minutes. `onText` gets the recognised words.
 * Returns the state plus press handlers to spread onto a Pressable.
 */
export function useVoiceCapture(onText: (text: string) => void, opts: VoiceCaptureOptions = {}) {
  const lang = useLang();
  const hasKey = useEleven((s) => s.has);
  const online = useOnline();
  const recorder = useRecorder(audioMod?.RecordingPresets.HIGH_QUALITY ?? ({} as never));
  const [state, setState] = useState<MicState>('idle');
  const startedAt = useRef(0);
  const errTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // live check, so a block that expires (or a key that changes) applies to the next press without a re-render
  const cloudOk = () => !!audioMod && hasKey && online && Platform.OS !== 'web' && !cloudBlocked();
  const cloud = cloudOk();

  useEffect(
    () => () => {
      if (errTimer.current) clearTimeout(errTimer.current);
    },
    [],
  );

  const set = (s: MicState) => {
    setState(s);
    try {
      opts.onState?.(s);
    } catch {
      /* a broken listener must not break the mic */
    }
  };

  const notify = (msg: string) => {
    try {
      opts.onError?.(msg);
    } catch {
      /* ignore */
    }
  };

  const clearErr = () => {
    if (errTimer.current) {
      clearTimeout(errTimer.current);
      errTimer.current = null;
    }
  };

  // error state shows for 1.5 s, then the mic is idle again
  const fail = () => {
    set('error');
    clearErr();
    errTimer.current = setTimeout(() => {
      errTimer.current = null;
      set('idle');
    }, 1500);
  };

  /** The cloud call failed after a recording: say why once, and block the cloud for auth failures. */
  const reportCloudFailure = (e: unknown) => {
    const reason = reasonOf(e);
    if (!phoneRecogniserReady()) {
      if (isAuthFailure(e)) cloudBlockedUntil = Date.now() + CLOUD_BLOCK_MS;
      notify(NO_PHONE_VOICE);
    } else if (isAuthFailure(e)) {
      cloudBlockedUntil = Date.now() + CLOUD_BLOCK_MS;
      notify(`Speech service said: ${reason}. Using the phone's voice recogniser: tap and speak again`);
    } else {
      notify(`Speech service said: ${reason}. Try again`);
    }
    fail();
  };

  const down = async () => {
    if (!cloudOk() || state !== 'idle') return;
    clearErr();
    try {
      if (!(await audioMod!.requestRecordingPermissionsAsync()).granted) {
        notify('Microphone is off: allow Beacon to record audio in the phone settings');
        return fail();
      }
      await audioMod!.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder!.prepareToRecordAsync();
      recorder!.record();
      startedAt.current = Date.now();
      opts.onStart?.();
      set('listening');
    } catch {
      fail();
    }
  };

  const up = async () => {
    // the recording only exists if down started one, so this does not depend on the cloud flag still being on
    if (!audioMod || state !== 'listening') return;
    clearErr();
    try {
      await recorder!.stop();
      await audioMod.setAudioModeAsync({ allowsRecording: false });
      const uri = recorder!.uri;
      if (!uri || Date.now() - startedAt.current < 450) return set('idle'); // too short to be speech
      set('thinking');
      let text: string | null;
      try {
        text = await transcribe(uri, lang);
      } catch (e) {
        return reportCloudFailure(e);
      }
      set('idle');
      if (text) onText(text);
    } catch {
      fail();
    }
  };

  // no cloud speech: one tap, the phone's own recogniser listens
  const tap = async () => {
    if (cloudOk() || state !== 'idle') return;
    clearErr();
    try {
      if (!phoneRecogniserReady()) {
        notify(NO_PHONE_VOICE);
        return fail();
      }
      opts.onStart?.();
      set('listening');
      const text = await listenOnce(lang);
      set('idle');
      if (text) onText(text);
    } catch {
      fail();
    }
  };

  return {
    state,
    cloud,
    onPressIn: () => void down(),
    onPressOut: () => void up(),
    onPress: () => void tap(),
  };
}

/**
 * Speak to the app. Press and hold with cloud speech, or tap for the on-device recogniser. See `useVoiceCapture`.
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
    <Press accessibilityRole="button" accessibilityLabel="Speak" onPressIn={onPressIn} onPressOut={onPressOut} onPress={onPress} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: p.accent }, ring]} />
      <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: state === 'error' ? p.danger : bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={state === 'thinking' ? 'sparkle' : 'mic'} size={size * 0.44} color={state === 'error' ? '#fff' : fg} />
      </Animated.View>
    </Press>
  );
}
