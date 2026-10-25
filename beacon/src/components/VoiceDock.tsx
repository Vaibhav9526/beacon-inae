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
import { router, usePathname } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { runAction, allowedByVoice } from '../ai/actions';
import { parseNavigation } from '../ai/navigate';
import { route } from '../ai/router';
import { speak } from '../services/speech';
import { useSettings } from '../state/settings';
import { MicButton, type MicState } from './MicButton';
import { Press, Txt, useTheme } from './ui';

const PERSONA_CHAT = '/kid/didi';
const HOLD_MS = 1400;
const DIDI_HOLD_MS = 4000;
const PILL = 40;
/** Screens that already have their own mic or chat input: the dock stays out of their way. */
const HIDE_ON = ['/aid', '/didi', '/report', '/hub', '/welcome'];

interface Toast {
  text: string;
  /** Tapping the toast opens the persona chat. Used for the "Ask Didi instead?" chip. */
  toPersona?: boolean;
}

export function VoiceDock({ hidden = false }: { hidden?: boolean }) {
  const insets = useSafeAreaInsets();
  const { p } = useTheme();
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const mode = useSettings((s) => s.mode);
  const [toast, setToast] = useState<Toast | null>(null);
  const opacity = useSharedValue(0);
  const breath = useSharedValue(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // very subtle idle breathing, so the dock reads as alive without drawing attention
  useEffect(() => {
    if (reduced) {
      breath.value = 1;
      return;
    }
    breath.value = withRepeat(withTiming(0.9, { duration: 3200, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(breath);
  }, [breath, reduced]);
  const breathStyle = useAnimatedStyle(() => ({ opacity: breath.value }));

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

  if (hidden || HIDE_ON.some((r) => pathname.includes(r)) || pathname === '/adult' || pathname === '/') return null; // adult home has its own mic in the header

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 50 }]}>
      {toast ? (
        <Animated.View pointerEvents={toast.toPersona ? 'auto' : 'none'} style={[styles.toastWrap, { bottom: bottomOffset(insets.bottom, mode === 'kid') + 8 }, toastStyle]}>
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
      <Animated.View entering={FadeIn.duration(220).delay(120).easing(Easing.out(Easing.cubic))} style={[styles.pill, { bottom: bottomOffset(insets.bottom, mode === 'kid'), shadowColor: p.dark ? '#000' : '#1B1B2F' }]}>
        <Animated.View style={[{ width: PILL, height: PILL }, breathStyle]}>
          <MicButton size={PILL} filled onText={(t) => void onText(t)} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

// Adult tab bar is about 54px plus the home-indicator inset; the kid tab bar is a floating pill about 66px up.
// The dock sits above whichever one is showing.
const bottomOffset = (safeBottom: number, kid: boolean) => (kid ? Math.max(safeBottom, 12) + 54 + 12 : Math.max(safeBottom, 4) + 50 + 14);

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    right: 16,
    width: PILL,
    height: PILL,
    borderRadius: PILL / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  toastWrap: {
    position: 'absolute',
    right: 16 + PILL + 8,
    maxWidth: 240,
  },
  toast: {
    backgroundColor: '#17171B',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});

export default VoiceDock;
