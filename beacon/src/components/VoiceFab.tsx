import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Rect } from 'react-native-svg';
import { tap } from '../services/haptics';
import { useVoiceCapture } from './MicButton';
import { useVoiceCommands, VoiceToast } from './VoiceDock';
import { Press, useTheme } from './ui';

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
 * Centre button of the bottom bar. Renders inside the bar's pill (TabBar), protruding above it.
 * Press and hold to speak when cloud speech is set up, otherwise tap. Recognised text runs through useVoiceCommands.
 */
export function VoiceFab() {
  const { p } = useTheme();
  const brand = p.brand ?? BRAND;
  const { onText, toast } = useVoiceCommands();
  const { state, onPressIn, onPressOut, onPress } = useVoiceCapture(onText, { onStart: tap });
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0);

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

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <VoiceToast toast={toast} />
      <View pointerEvents="box-none" style={styles.anchor}>
        <Animated.View pointerEvents="none" style={[styles.ring, { backgroundColor: brand }, ring]} />
        <Press
          haptic={false}
          accessibilityRole="button"
          accessibilityLabel="Speak a command"
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
