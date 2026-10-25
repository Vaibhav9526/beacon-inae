import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { LocatorState } from '../services/locator';
import { Txt, useTheme } from './ui';

const WORD: Record<LocatorState, { en: string; hi: string }> = {
  searching: { en: 'Searching', hi: 'खोज जारी' },
  maybe: { en: 'Maybe, keep going', hi: 'शायद, चलते रहें' },
  found: { en: 'Signal found, very close', hi: 'संकेत मिला, बहुत पास' },
};

/** A large ring that grows and warms with the signal, a hot/cold bar and the state word. */
export function LocatorMeter({ strength, state }: { strength: number; state: LocatorState }) {
  const { p } = useTheme();
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withTiming(Math.max(0, Math.min(100, strength)) / 100, { duration: 350, easing: Easing.out(Easing.quad) });
  }, [strength, v]);
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: 0.55 + v.value * 0.45 }], opacity: 0.35 + v.value * 0.65 }));
  const bar = useAnimatedStyle(() => ({ width: `${Math.round(v.value * 100)}%` }));

  const hot = state === 'found' ? p.ok : state === 'maybe' ? p.warn : p.info;
  const w = WORD[state];
  return (
    <View style={{ alignItems: 'center', gap: 14 }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: strength }} accessibilityLabel={`${w.en}. ${strength} percent`}>
      <View style={{ width: 230, height: 230, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', width: 230, height: 230, borderRadius: 115, borderWidth: 2, borderColor: p.border }} />
        <Animated.View style={[{ width: 230, height: 230, borderRadius: 115, borderWidth: 14, borderColor: hot, alignItems: 'center', justifyContent: 'center' }, ring]} />
        <View style={{ position: 'absolute', alignItems: 'center' }}>
          <Txt size={48} weight="700">
            {strength}
          </Txt>
          <Txt size={12} color={p.muted}>
            signal strength / संकेत की ताकत
          </Txt>
        </View>
      </View>
      <View style={{ width: '100%', height: 16, borderRadius: 8, backgroundColor: p.cardAlt, overflow: 'hidden' }}>
        <Animated.View style={[{ height: 16, borderRadius: 8, backgroundColor: hot }, bar]} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
        <Txt size={12} color={p.muted}>
          Cold / ठंडा
        </Txt>
        <Txt size={12} color={p.muted}>
          Hot / गर्म
        </Txt>
      </View>
      <View style={{ alignItems: 'center' }}>
        <Txt size={20} weight="700" color={hot}>
          {w.en}
        </Txt>
        <Txt size={14} color={p.muted}>
          {w.hi}
        </Txt>
      </View>
    </View>
  );
}
