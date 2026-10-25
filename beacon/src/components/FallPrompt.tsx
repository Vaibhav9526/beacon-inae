import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { useFallAlert } from '../services/fall';
import { sendSosNow } from '../services/sos';
import { speak, stopSpeaking } from '../services/speech';
import { useSettings } from '../state/settings';
import { Shield } from './Deco';
import { Btn, Card, Txt, useTheme } from './ui';

const ASK_SECONDS = 30;
const RING = 136;
const STROKE = 7;
const RING_R = RING / 2 - STROKE;
const RING_C = 2 * Math.PI * RING_R;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Phase = 'asking' | 'sending' | 'sent' | 'error';

/**
 * Full-screen check-in after a detected fall. It speaks the question, pulses the phone once a second,
 * and sends the same SOS as the red button when the countdown reaches zero. "I am okay" cancels it.
 */
export function FallPrompt() {
  const { p } = useTheme();
  const fallAt = useFallAlert((s) => s.at);
  const clearAlert = useFallAlert((s) => s.clear);
  const fallDetect = useSettings((s) => s.fallDetect);
  const hapticsOn = useSettings((s) => s.haptics);
  const lang = useSettings((s) => s.lang);
  const reduced = useReducedMotion();
  const active = fallAt !== null && fallDetect;
  const [phase, setPhase] = useState<Phase>('asking');
  const [countdown, setCountdown] = useState(ASK_SECONDS);
  const fired = useRef(false);
  const mounted = useRef(true);
  const progress = useSharedValue(1);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    progress.value = withTiming(countdown / ASK_SECONDS, {
      duration: reduced ? 0 : 200,
      easing: Easing.out(Easing.cubic),
    });
  }, [countdown, progress, reduced]);

  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: RING_C * (1 - progress.value),
  }));

  const pulse = useCallback(() => {
    if (!hapticsOn || Platform.OS === 'web') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
  }, [hapticsOn]);

  const fireNow = useCallback(async () => {
    if (fired.current) return;
    fired.current = true;
    setPhase('sending');
    stopSpeaking();
    try {
      await sendSosNow('Fall detected. No answer.');
      if (mounted.current) setPhase('sent');
    } catch {
      if (mounted.current) setPhase('error');
    }
  }, []);

  // A new fall (or a pending one when this mounts) starts a fresh countdown and asks the question once.
  useEffect(() => {
    if (fallAt === null) return;
    fired.current = false;
    setPhase('asking');
    setCountdown(ASK_SECONDS);
    progress.value = 1;
    if (fallDetect) void speak('Are you okay?', lang).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallAt]);

  // Leaving the prompt (answered, closed or the feature was switched off) cancels any pending SOS.
  const dismiss = useCallback(() => {
    fired.current = true;
    stopSpeaking();
    clearAlert();
  }, [clearAlert]);

  // One tick per second. The timer is cleared on every change, so an answer stops the countdown at once.
  useEffect(() => {
    if (!active || phase !== 'asking') return;
    if (countdown <= 0) {
      void fireNow();
      return;
    }
    pulse();
    const id = setTimeout(() => setCountdown((n) => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(id);
  }, [active, phase, countdown, fireNow, pulse]);

  if (!active) return null;

  const retry = () => {
    fired.current = false;
    void fireNow();
  };

  const title = phase === 'asking' ? 'Are you okay?' : phase === 'sent' ? 'SOS sent' : phase === 'error' ? 'SOS not sent' : 'Sending SOS';
  const line =
    phase === 'asking'
      ? 'A hard fall was followed by stillness.'
      : phase === 'sent'
        ? 'Your family and nearby people have been alerted.'
        : phase === 'error'
          ? 'The SOS could not go out. Try again or call 112.'
          : 'Telling your family and nearby people.';

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={dismiss}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.52)', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <Card tint="pink" style={{ width: '100%', maxWidth: 420, borderRadius: 30, padding: 24, gap: 14, alignItems: 'center' }}>
          <Shield size={72} />
          <Txt size={32} weight="700" style={{ textAlign: 'center' }}>
            {title}
          </Txt>
          <Txt size={13} style={{ textAlign: 'center', opacity: 0.82 }}>
            {line}
          </Txt>

          {phase === 'asking' ? (
            <>
              <View style={{ width: RING, height: RING, alignItems: 'center', justifyContent: 'center' }}>
                <Svg width={RING} height={RING} style={StyleSheet.absoluteFill}>
                  <Circle cx={RING / 2} cy={RING / 2} r={RING_R} stroke={p.tint.pink.ink + '22'} strokeWidth={STROKE} fill="none" />
                  <AnimatedCircle
                    cx={RING / 2}
                    cy={RING / 2}
                    r={RING_R}
                    stroke={p.tint.pink.ink}
                    strokeWidth={STROKE}
                    strokeLinecap="round"
                    fill="none"
                    strokeDasharray={`${RING_C} ${RING_C}`}
                    animatedProps={ringProps}
                    rotation={-90}
                    originX={RING / 2}
                    originY={RING / 2}
                  />
                </Svg>
                <Txt size={44} weight="700">
                  {countdown}
                </Txt>
              </View>
              <Txt size={12} style={{ textAlign: 'center', opacity: 0.78 }}>
                Sending an SOS in {countdown} seconds
              </Txt>
              <Btn size="lg" icon="check" label="I am okay" onPress={dismiss} style={{ alignSelf: 'stretch' }} />
              <Btn size="lg" kind="danger" icon="siren" label="Send SOS now" onPress={() => void fireNow()} style={{ alignSelf: 'stretch' }} />
            </>
          ) : phase === 'sent' ? (
            <Btn size="lg" label="Close" onPress={dismiss} style={{ alignSelf: 'stretch' }} />
          ) : phase === 'error' ? (
            <>
              <Btn size="lg" kind="danger" icon="refresh" label="Try again" onPress={retry} style={{ alignSelf: 'stretch' }} />
              <Btn size="lg" kind="secondary" label="Close" onPress={dismiss} style={{ alignSelf: 'stretch' }} />
            </>
          ) : null}
        </Card>
      </View>
    </Modal>
  );
}
