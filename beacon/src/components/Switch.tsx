import React from 'react';
import { Pressable } from 'react-native';
import Animated, { Easing, interpolateColor, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import * as haptics from '../services/haptics';
import { useTheme } from './ui';

const W = 46;
const H = 28;
const PAD = 3;
const THUMB = 22;
const TRAVEL = W - PAD * 2 - THUMB;

/** Animated pill toggle. ON is a filled accent track with the thumb on the right. */
export function Switch({
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange?: (v: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const { p } = useTheme();
  const reduced = useReducedMotion();
  const pos = useSharedValue(value ? 1 : 0);

  React.useEffect(() => {
    pos.value = withTiming(value ? 1 : 0, { duration: reduced ? 0 : 160, easing: Easing.out(Easing.cubic) });
  }, [value, pos, reduced]);

  const track = useAnimatedStyle(
    () => ({
      backgroundColor: interpolateColor(pos.value, [0, 1], [p.border, p.accent]),
      borderColor: interpolateColor(pos.value, [0, 1], [p.muted, p.accent]),
    }),
    [p],
  );

  const thumb = useAnimatedStyle(
    () => ({
      transform: [{ translateX: pos.value * TRAVEL }],
      // On a light accent track (dark theme) the thumb flips to the dark ink so it stays visible.
      backgroundColor: interpolateColor(pos.value, [0, 1], ['#FFFFFF', p.onAccent]),
    }),
    [p],
  );

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => {
        haptics.tap();
        onValueChange?.(!value);
      }}
      style={{ opacity: disabled ? 0.45 : 1 }}>
      <Animated.View
        style={[
          {
            width: W,
            height: H,
            borderRadius: H / 2,
            borderWidth: 1,
            padding: PAD,
            justifyContent: 'center',
          },
          track,
        ]}>
        <Animated.View
          style={[
            {
              width: THUMB,
              height: THUMB,
              borderRadius: THUMB / 2,
              shadowColor: '#000',
              shadowOpacity: 0.18,
              shadowRadius: 2,
              shadowOffset: { width: 0, height: 1 },
              elevation: 2,
            },
            thumb,
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}

