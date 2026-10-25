import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useLang } from '../i18n';
import { transcribe, useEleven } from '../services/elevenlabs';
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

/**
 * Speak to the app. With an ElevenLabs key and internet: press and hold, release to send (Scribe, Hindi and English).
 * Without: tap once and Android's on-device recogniser listens. Either way `onText` gets the words.
 */
export function MicButton({ onText, onState, size = 40, filled }: { onText: (text: string) => void; onState?: (s: MicState) => void; size?: number; filled?: boolean }) {
  const { p } = useTheme();
  const lang = useLang();
  const haptics = useSettings((s) => s.haptics);
  const hasKey = useEleven((s) => s.has);
  const online = useOnline();
  const recorder = useRecorder(audioMod?.RecordingPresets.HIGH_QUALITY ?? ({} as never));
  const [state, setState] = useState<MicState>('idle');
  const startedAt = useRef(0);
  const pulse = useSharedValue(0);
  const cloud = !!audioMod && hasKey && online && Platform.OS !== 'web';

  const set = (s: MicState) => {
    setState(s);
    onState?.(s);
  };

  useEffect(() => {
    if (state === 'listening') pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) }), -1, false);
    else {
      cancelAnimation(pulse);
      pulse.value = 0;
    }
  }, [state, pulse]);
  const ring = useAnimatedStyle(() => ({ opacity: 0.35 * (1 - pulse.value), transform: [{ scale: 1 + pulse.value * 0.9 }] }));

  const buzz = () => haptics && Platform.OS !== 'web' && Haptics.selectionAsync().catch(() => {});

  const down = async () => {
    if (!cloud || state !== 'idle') return;
    try {
      if (!(await audioMod!.requestRecordingPermissionsAsync()).granted) return set('error');
      await audioMod!.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder!.prepareToRecordAsync();
      recorder!.record();
      startedAt.current = Date.now();
      buzz();
      set('listening');
    } catch {
      set('error');
    }
  };

  const up = async () => {
    if (!cloud || state !== 'listening') return;
    try {
      await recorder!.stop();
      await audioMod!.setAudioModeAsync({ allowsRecording: false });
      const uri = recorder!.uri;
      if (!uri || Date.now() - startedAt.current < 450) return set('idle'); // too short to be speech
      set('thinking');
      const text = await transcribe(uri, lang);
      set('idle');
      if (text) onText(text);
    } catch {
      set('error');
      setTimeout(() => set('idle'), 1200);
    }
  };

  // no cloud speech: one tap, the phone's own recogniser listens
  const tap = async () => {
    if (cloud || state !== 'idle') return;
    if (!voiceSupported() || !voiceStatus().available) return set('error');
    buzz();
    set('listening');
    const text = await listenOnce(lang);
    set('idle');
    if (text) onText(text);
  };

  const bg = filled || state === 'listening' ? p.accent : p.cardAlt;
  const fg = filled || state === 'listening' ? p.onAccent : p.text;
  return (
    <Press accessibilityRole="button" accessibilityLabel="Speak" onPressIn={() => void down()} onPressOut={() => void up()} onPress={() => void tap()} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: p.accent }, ring]} />
      <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: state === 'error' ? p.danger : bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={state === 'thinking' ? 'sparkle' : 'mic'} size={size * 0.44} color={state === 'error' ? '#fff' : fg} />
      </Animated.View>
    </Press>
  );
}
