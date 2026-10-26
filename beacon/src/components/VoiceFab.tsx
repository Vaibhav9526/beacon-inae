import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Rect } from 'react-native-svg';
import { useLang } from '../i18n';
import { VOICE_TEXT } from '../ai/navigate';
import { tap } from '../services/haptics';
import { Icon } from './Icon';
import { useVoiceCapture } from './MicButton';
import { type Toast, useVoiceCommands, VoiceToast } from './VoiceDock';
import { Press, Txt, useTheme } from './ui';

export const FAB_D = 68;
const FAB_RING = 6;
const FAB_OVERLAP = 26;
const BRAND = '#FFC928';
const INK = '#0A0A0C';

// 7 bars, heights in a 24 x 24 box, drawn white on a black centre disc
const BARS = [6, 12, 18, 10, 20, 13, 7];

function Waveform() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      {BARS.map((h, i) => (
        <Rect key={i} x={1.4 + i * 3.2} y={12 - h / 2} width={2} height={h} rx={1} fill="#FFFFFF" />
      ))}
    </Svg>
  );
}

/**
 * Centre button of the bottom bar. Push to talk: hold to speak, release to send, slide away to cancel.
 * A quick tap only shows "Hold to talk". While held, the live transcript shows above the button.
 */
export function VoiceFab() {
  const { p } = useTheme();
  const brand = p.brand ?? BRAND;
  const lang = useLang();
  const { onText, toast } = useVoiceCommands();
  // the typed-command box is opened here (VoiceDock does not expose its own opener)
  const [typing, setTyping] = useState(false);
  const { state, partial, hint, onPressIn, onPressOut, onPress, onSlide } = useVoiceCapture(onText, {
    onStart: tap,
    onError: (reason) => console.log('[voice] fab error', reason),
  });
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0);
  // where the finger went down, for the slide-to-cancel check
  const downAt = useRef<{ x: number; y: number } | null>(null);

  const typingToast: Toast = {
    text: VOICE_TEXT.typeHint(lang),
    typing: {
      onSubmit: (t) => {
        setTyping(false);
        void onText(t);
      },
    },
    onDismiss: () => setTyping(false),
  };

  useEffect(() => {
    if (state === 'listening' && !reduced) pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) }), -1, false);
    else {
      cancelAnimation(pulse);
      pulse.value = 0;
    }
    return () => cancelAnimation(pulse);
  }, [state, reduced, pulse]);

  const ring = useAnimatedStyle(() => ({
    opacity: 0.5 * (1 - pulse.value),
    transform: [{ scale: 1 + pulse.value * 0.18 }],
  }));

  const caption =
    hint ??
    (state === 'listening' ? (partial ? `"${partial}"` : VOICE_TEXT.listening(lang)) : state === 'thinking' ? VOICE_TEXT.working(lang) : null);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <VoiceToast toast={typing ? typingToast : toast} />
      <View
        style={styles.anchor}
        onTouchStart={(e) => {
          downAt.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
        }}
        onTouchMove={(e) => {
          const d = downAt.current;
          if (d) onSlide(e.nativeEvent.pageX - d.x, e.nativeEvent.pageY - d.y);
        }}
        onTouchEnd={() => {
          downAt.current = null;
        }}
        onTouchCancel={() => {
          downAt.current = null;
        }}>
        {caption ? (
          <View pointerEvents="none" style={styles.caption}>
            <Txt size={13} weight="700" color="#FFFFFF" style={{ textAlign: 'center' }}>
              {caption}
            </Txt>
          </View>
        ) : null}
        {!typing ? (
          <Press
            accessibilityRole="button"
            accessibilityLabel={VOICE_TEXT.typeHint(lang)}
            onPress={() => setTyping(true)}
            style={styles.keys}>
            <Icon name="type" size={18} color="#FFFFFF" />
          </Press>
        ) : null}
        <Animated.View pointerEvents="none" style={[styles.ring, { backgroundColor: brand }, ring]} />
        <Press
          haptic={false}
          accessibilityRole="button"
          accessibilityLabel={VOICE_TEXT.holdToTalk(lang)}
          accessibilityHint={VOICE_TEXT.holdToTalk(lang)}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          onPress={onPress}
          style={[styles.button, { backgroundColor: brand }]}>
          <View style={styles.core}>
            <Waveform />
          </View>
        </Press>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // centred on the bar, pushed up so the top ~26px sit above the bar's top edge
  anchor: {
    position: 'absolute',
    left: '50%',
    marginLeft: -FAB_D / 2,
    top: -FAB_OVERLAP,
    width: FAB_D,
    height: FAB_D,
  },
  // live transcript / hint, above the button
  caption: {
    position: 'absolute',
    bottom: FAB_D + 8,
    left: (FAB_D - 240) / 2,
    width: 240,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#17171B',
    zIndex: 3,
  },
  // small dark disc above the mic, opens the typed-command box
  keys: {
    position: 'absolute',
    right: -4,
    top: -36,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  ring: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: FAB_D,
    height: FAB_D,
    borderRadius: FAB_D / 2,
    backgroundColor: BRAND,
  },
  button: {
    width: FAB_D,
    height: FAB_D,
    borderRadius: FAB_D / 2,
    backgroundColor: BRAND,
    borderWidth: FAB_RING,
    borderColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  core: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
