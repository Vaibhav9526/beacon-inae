/**
 * MOUNTING (done by the owner, not here):
 * Mount <VoiceDock /> once, as an absolutely positioned sibling of the navigator in the root layout
 * src/app/_layout.tsx, inside ThemeProvider and after the <Stack>/<Tabs>, e.g.
 *   <View style={{ flex: 1 }}>
 *     <Stack ... />
 *     <VoiceDock hidden={isWelcome} />
 *   </View>
 * It floats bottom-right, above the tab bar, on every screen. Pass hidden on screens where it should not show
 * (for example welcome and the SOS screens). Its wrapper ignores touches outside the pill.
 */
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { runAction, allowedByVoice } from '../ai/actions';
import { parseNavigation } from '../ai/navigate';
import { route } from '../ai/router';
import { speak } from '../services/speech';
import { MicButton } from './MicButton';
import { Press, Txt } from './ui';

const PERSONA_CHAT = '/kid/didi';
const HOLD_MS = 1400;
const DIDI_HOLD_MS = 4000;

interface Toast {
  text: string;
  /** Tapping the toast opens the persona chat. Used for the "Ask Didi instead?" chip. */
  toPersona?: boolean;
}

export function VoiceDock({ hidden = false }: { hidden?: boolean }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<Toast | null>(null);
  const opacity = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (t: Toast, holdMs: number) => {
      if (timer.current) clearTimeout(timer.current);
      setToast(t);
      opacity.value = withSequence(withTiming(1, { duration: 120 }), withDelay(holdMs, withTiming(0, { duration: 300 })));
      timer.current = setTimeout(() => setToast(null), holdMs + 320);
    },
    [opacity],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onText = useCallback(
    async (text: string) => {
      // 1. Screens: instant, no model.
      const nav = parseNavigation(text);
      if (nav) {
        show({ text: nav.label }, HOLD_MS);
        void speak(nav.label, 'en');
        router.push(nav.route as never);
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

  const toastStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (hidden) return null;

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 50 }]}>
      {toast ? (
        <Animated.View pointerEvents={toast.toPersona ? 'auto' : 'none'} style={[styles.toastWrap, { bottom: bottomOffset(insets.bottom) + 8 }, toastStyle]}>
          {toast.toPersona ? (
            <Press accessibilityRole="button" accessibilityLabel="Ask Didi instead" onPress={() => router.push(PERSONA_CHAT as never)} style={styles.toast}>
              <Txt size={13} weight="600" color="#fff">
                {toast.text}
              </Txt>
            </Press>
          ) : (
            <View style={styles.toast}>
              <Txt size={13} weight="600" color="#fff">
                {toast.text}
              </Txt>
            </View>
          )}
        </Animated.View>
      ) : null}
      <View style={[styles.pill, { bottom: bottomOffset(insets.bottom) }]}>
        <MicButton size={30} onText={(t) => void onText(t)} />
      </View>
    </View>
  );
}

// Tab bar is about 52px tall plus the home-indicator inset; the pill sits just above it.
const bottomOffset = (safeBottom: number) => Math.max(safeBottom, 8) + 64;

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  toastWrap: {
    position: 'absolute',
    right: 16 + 44 + 8,
    maxWidth: 240,
  },
  toast: {
    backgroundColor: '#000',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});

export default VoiceDock;
