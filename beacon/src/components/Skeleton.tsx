import React, { useEffect } from 'react';
import { View, type DimensionValue, type ViewStyle } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { radius } from '../theme';
import { Card, Row, useTheme } from './ui';

/** A soft placeholder block. Opacity breathes 0.5 to 0.9 over a 1200ms loop; reduced motion holds still. */
export function Skeleton({ w = '100%', h = 12, r = 6, style }: { w?: DimensionValue; h?: number; r?: number; style?: ViewStyle }) {
  const { p } = useTheme();
  const reduced = useReducedMotion();
  const o = useSharedValue(0.5);

  useEffect(() => {
    if (reduced) {
      o.value = 0.7;
      return;
    }
    o.value = withRepeat(withTiming(0.9, { duration: 600, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(o);
  }, [o, reduced]);

  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[{ width: w, height: h, borderRadius: r, backgroundColor: p.border }, a, style]} />;
}

/** Placeholder shaped like a card with an icon circle and two text lines. */
export function SkeletonCard({ style }: { style?: ViewStyle }) {
  return (
    <Card style={[{ padding: 12 }, style]}>
      <Row style={{ alignItems: 'flex-start', gap: 12 }}>
        <Skeleton w={36} h={36} r={radius.pill} />
        <View style={{ flex: 1, gap: 8, paddingTop: 2 }}>
          <Skeleton w="70%" h={12} />
          <Skeleton w="45%" h={10} />
        </View>
      </Row>
    </Card>
  );
}

/** A stack of `n` card placeholders, for lists that are still loading. */
export function SkeletonList({ n = 3, style }: { n?: number; style?: ViewStyle }) {
  return (
    <View style={[{ gap: 10 }, style]} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: n }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  );
}
