import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius } from '../theme';
import { Icon, type IconName } from './Icon';
import { Press, useTheme } from './ui';

interface BottomTabBarProps {
  state: { routes: { name: string }[]; index: number };
}

export interface TabDef {
  name: string;
  label: string;
  icon: IconName;
}

const BAR_H = 64;
const PAD = 6;
const CIRCLE = 52;
const SLIDE = { duration: 200, easing: Easing.out(Easing.cubic) };
const HIDE = { duration: 180, easing: Easing.out(Easing.quad) };

/** True while the on-screen keyboard is up. iOS also reports the start of the animation, so the bar moves with it. */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const subs = [
      Keyboard.addListener('keyboardDidShow', () => setOpen(true)),
      Keyboard.addListener('keyboardDidHide', () => setOpen(false)),
    ];
    if (Platform.OS === 'ios') {
      subs.push(Keyboard.addListener('keyboardWillShow', () => setOpen(true)));
      subs.push(Keyboard.addListener('keyboardWillHide', () => setOpen(false)));
    }
    return () => subs.forEach((s) => s.remove());
  }, []);
  return open;
}

/**
 * Bottom navigation: a floating, fully rounded pill with icons only. The active tab is a circle that slides
 * between tabs. Labels are not shown, so each tab keeps its title as the accessibility label.
 * The bar slides down and fades while the keyboard is open, so it never covers a text field.
 * The router is used directly because this Expo Router version passes no `navigation` to a custom tab bar.
 * All modes share this pill; `_variant` is kept so existing callers still compile.
 */
export function makeTabBar(tabs: TabDef[], _variant: 'pill' | 'bar', base: string) {
  const Bar = ({ state }: BottomTabBarProps) => {
    const { p } = useTheme();
    const insets = useSafeAreaInsets();
    const reduced = useReducedMotion();
    const kbOpen = useKeyboardOpen();
    const [width, setWidth] = useState(0);
    const current = state.routes[state.index]?.name;
    const index = Math.max(0, tabs.findIndex((t) => t.name === current));
    const tabW = width > 0 && tabs.length > 0 ? (width - PAD * 2) / tabs.length : 0;

    // pill colour is p.tabBar; the ink is its opposite so icons and the circle always read
    const pillIsWhite = p.tabBar.toUpperCase() === '#FFFFFF';
    const ink = pillIsWhite ? '#0A0A0C' : '#FFFFFF';

    const x = useSharedValue(0);
    const placed = useRef(false);
    useEffect(() => {
      if (tabW <= 0) return;
      const target = PAD + index * tabW + (tabW - CIRCLE) / 2;
      if (!placed.current || reduced) {
        x.value = target;
        placed.current = true;
      } else {
        x.value = withTiming(target, SLIDE);
      }
    }, [index, tabW, reduced, x]);
    const circle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

    // 0 = shown, 1 = hidden (slid below the screen edge and faded)
    const hide = useSharedValue(0);
    useEffect(() => {
      hide.value = reduced ? (kbOpen ? 1 : 0) : withTiming(kbOpen ? 1 : 0, HIDE);
    }, [kbOpen, reduced, hide]);
    const hidden = useAnimatedStyle(() => ({
      opacity: 1 - hide.value,
      transform: [{ translateY: hide.value * (insets.bottom + BAR_H + 32) }],
    }));

    return (
      <Animated.View
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        pointerEvents={kbOpen ? 'none' : 'auto'}
        style={[
          {
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: insets.bottom + 16,
            height: BAR_H,
            borderRadius: radius.pill,
            backgroundColor: p.tabBar,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: PAD,
            shadowColor: '#000',
            shadowOpacity: 0.12,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 6 },
            elevation: 6,
          },
          hidden,
        ]}>
        {tabW > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                top: (BAR_H - CIRCLE) / 2,
                left: 0,
                width: CIRCLE,
                height: CIRCLE,
                borderRadius: CIRCLE / 2,
                backgroundColor: ink,
                borderWidth: 1,
                borderColor: p.tabBar,
              },
              circle,
            ]}
          />
        ) : null}
        {tabs.map((tab) => {
          const active = current === tab.name;
          return (
            <Press
              key={tab.name}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={tab.label}
              onPress={() => router.navigate((tab.name === 'index' ? base : `${base}/${tab.name}`) as never)}
              style={{ flex: 1, height: BAR_H, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={tab.icon} size={22} color={active ? p.tabBar : ink} strokeWidth={active ? 2.2 : 1.8} />
            </Press>
          );
        })}
      </Animated.View>
    );
  };
  return (props: BottomTabBarProps) => <Bar {...props} />;
}
