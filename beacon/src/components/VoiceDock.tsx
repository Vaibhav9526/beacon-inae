/**
 * Voice commands shared by the bottom-bar mic (VoiceFab). The old floating dock is retired: its default export
 * renders nothing. The hooks and the toast live here so VoiceFab can use them.
 */
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { runAction, allowedByVoice } from '../ai/actions';
import { parseNavigation } from '../ai/navigate';
import { route } from '../ai/router';
import { speak } from '../services/speech';
import { Press, Txt } from './ui';

const PERSONA_CHAT = '/kid/didi';
const HOLD_MS = 1400;
const DIDI_HOLD_MS = 4000;

export interface Toast {
  text: string;
  /** Tapping the toast opens the persona chat. Used for the "Ask Didi instead?" chip. */
  toPersona?: boolean;
}

/**
 * Runs a recognised phrase: screen names first (no model), then calls and "I am safe" via the keyword router,
 * otherwise offers the persona chat. Returns `onText` to feed recognised text, and the current `toast`.
 */
export function useVoiceCommands() {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((t: Toast, holdMs: number) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(t);
    timer.current = setTimeout(() => setToast(null), holdMs + 320);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onText = useCallback(
    async (text: string) => {
      // 1. Screens: instant, no model.
      const nav = parseNavigation(text);
      if (nav) {
        show({ text: nav.label }, HOLD_MS);
        void speak(nav.label, 'en');
        router.navigate(nav.route as never);
        return;
      }
      // 2. Calls and "I am safe" come from the keyword router (no engine here, so it is quick).
      try {
        const r = await route(text);
        if (r.action.type === 'call112' || r.action.type === 'safe') {
          if (allowedByVoice(r.action)) {
            const label = r.action.type === 'safe' ? 'Marking you safe' : 'Calling 112';
            show({ text: label }, HOLD_MS);
            void speak(label, 'en');
            await runAction(r.action);
            return;
          }
        }
      } catch {
        /* fall through to the chat suggestion */
      }
      // 3. Anything else: offer the persona chat.
      show({ text: 'Ask Didi instead?', toPersona: true }, DIDI_HOLD_MS);
    },
    [show],
  );

  return { onText, toast };
}

/** Small dark label that fades in above the bar. Positioned by its parent. */
export function VoiceToast({ toast }: { toast: Toast | null }) {
  if (!toast) return null;
  const label = (
    <Txt size={13} weight="600" color="#fff">
      {toast.text}
    </Txt>
  );
  return (
    <Animated.View key={toast.text + String(toast.toPersona)} entering={FadeIn.duration(120)} exiting={FadeOut.duration(300)} pointerEvents={toast.toPersona ? 'auto' : 'none'} style={styles.toastWrap}>
      {toast.toPersona ? (
        <Press accessibilityRole="button" accessibilityLabel="Ask Didi instead" onPress={() => router.navigate(PERSONA_CHAT as never)} style={styles.toast}>
          {label}
        </Press>
      ) : (
        <View style={styles.toast}>{label}</View>
      )}
    </Animated.View>
  );
}

/** Retired: the voice control now lives in the bottom bar (VoiceFab). Kept so the old mount in the root layout is harmless. */
export function VoiceDock(_props: { hidden?: boolean }) {
  return null;
}

export default VoiceDock;

const styles = StyleSheet.create({
  toastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 98,
    alignItems: 'center',
  },
  toast: {
    backgroundColor: '#17171B',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: 240,
  },
});
