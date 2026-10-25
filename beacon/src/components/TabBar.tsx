import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Keyboard, Platform, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tap } from '../services/haptics';
import { Icon, type IconName } from './Icon';
import { VoiceFab } from './VoiceFab';
import { Press, Txt, useTheme } from './ui';

interface BottomTabBarProps {
  state: { routes: { name: string; key: string }[]; index: number };
  /** Expo Router passes each route's options; a route with `href: null` is hidden from the bar. */
  descriptors?: Record<string, { options?: { href?: string | null } }>;
}

export interface TabDef {
  name: string;
  label: string;
  icon: IconName;
}

const BAR_H = 64;
const SIDE = 14;
/** Space in the middle of the bar reserved for the centre button. */
const FAB_SLOT = 84;
const BRAND = '#FFC928';
const INK = '#0A0A0C';
const INACTIVE = 'rgba(255,255,255,0.6)';
const SLIDE = { duration: 200, easing: Easing.out(Easing.cubic) };
const HIDE = { duration: 180, easing: Easing.out(Easing.quad) };

/** Px above the safe-area bottom that content must clear: bar + centre button overlap + bar's bottom gap. */
export const NAV_CLEARANCE = 64 + 26 + 14;

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

function TabItem({ label, icon, active, onPress }: { label: string; icon: IconName; active: boolean; onPress: () => void }) {
  const { p } = useTheme();
  const brand = p.brand ?? BRAND;
  const reduced = useReducedMotion();
  const v = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    v.value = reduced ? (active ? 1 : 0) : withTiming(active ? 1 : 0, SLIDE);
  }, [active, reduced, v]);
  const dot = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ scale: 0.5 + 0.5 * v.value }] }));
  const color = active ? brand : INACTIVE;
  return (
    <Press
      haptic={false}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={() => {
        tap();
        onPress();
      }}
      style={{ flex: 1, height: BAR_H, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={20} color={color} strokeWidth={active ? 2.2 : 1.8} />
      <Txt size={10} weight="600" color={color} style={{ marginTop: 2 }}>
        {label}
      </Txt>
      <Animated.View style={[{ width: 4, height: 4, borderRadius: 2, backgroundColor: brand, marginTop: 3 }, dot]} />
    </Press>
  );
}

/**
 * Bottom navigation: a black pill floating above the bottom edge with four items (two left, two right) and a
 * yellow centre button (VoiceFab) that protrudes above the bar. The bar slides down and fades while the keyboard
 * is open, so it never covers a text field. The router is used directly because this Expo Router version passes no
 * `navigation` to a custom tab bar. `_variant` is kept so existing callers still compile.
 */
export function makeTabBar(tabs: TabDef[], _variant: 'pill' | 'bar', base: string) {
  const Bar = ({ state, descriptors }: BottomTabBarProps) => {
    const insets = useSafeAreaInsets();
    const reduced = useReducedMotion();
    const kbOpen = useKeyboardOpen();
    const current = state.routes[state.index]?.name;

    // skip anything the navigator has hidden with href: null
    const hiddenNames = new Set(state.routes.filter((r) => descriptors?.[r.key]?.options?.href === null).map((r) => r.name));
    const visible = tabs.filter((t) => !hiddenNames.has(t.name));
    const left = visible.slice(0, 2);
    const right = visible.slice(2);

    // 0 = shown, 1 = hidden (slid below the screen edge and faded)
    const hide = useSharedValue(0);
    useEffect(() => {
      hide.value = reduced ? (kbOpen ? 1 : 0) : withTiming(kbOpen ? 1 : 0, HIDE);
    }, [kbOpen, reduced, hide]);
    const hidden = useAnimatedStyle(() => ({
      opacity: 1 - hide.value,
      transform: [{ translateY: hide.value * (insets.bottom + BAR_H + 32) }],
    }));

    const renderItem = (tab: TabDef) => (
      <TabItem
        key={tab.name}
        label={tab.label}
        icon={tab.icon}
        active={current === tab.name}
        onPress={() => router.navigate((tab.name === 'index' ? base : `${base}/${tab.name}`) as never)}
      />
    );

    return (
      <Animated.View
        pointerEvents={kbOpen ? 'none' : 'auto'}
        style={[
          {
            position: 'absolute',
            left: SIDE,
            right: SIDE,
            bottom: insets.bottom + SIDE,
            height: BAR_H,
            borderRadius: BAR_H / 2,
            backgroundColor: INK,
            flexDirection: 'row',
            alignItems: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.2,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 6 },
            elevation: 6,
          },
          hidden,
        ]}>
        <View style={{ flex: 1, flexDirection: 'row' }}>{left.map(renderItem)}</View>
        <View style={{ width: FAB_SLOT }} />
        <View style={{ flex: 1, flexDirection: 'row' }}>{right.map(renderItem)}</View>
        <VoiceFab />
      </Animated.View>
    );
  };
  return (props: BottomTabBarProps) => <Bar {...props} />;
}
