import { router } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius } from '../theme';
import { Icon, type IconName } from './Icon';
import { Press, Txt, useTheme } from './ui';

interface BottomTabBarProps {
  state: { routes: { name: string }[]; index: number };
}

export interface TabDef {
  name: string;
  label: string;
  icon: IconName;
}

function Item({ tab, active, onPress, pill }: { tab: TabDef; active: boolean; onPress: () => void; pill: boolean }) {
  const { p } = useTheme();
  const reduced = useReducedMotion();
  // timing only, no overshoot; the icon scale tops out at 1.0
  const timing = { duration: 180, easing: Easing.out(Easing.cubic) };
  const lift = useAnimatedStyle(() => (reduced ? {} : { transform: [{ scale: withTiming(active ? 1 : 0.96, timing) }] }));
  const dot = useAnimatedStyle(() => (reduced ? { opacity: withTiming(active ? 1 : 0, timing) } : { opacity: withTiming(active ? 1 : 0, timing), transform: [{ scaleX: withTiming(active ? 1 : 0.2, timing) }] }));
  return (
    <Press accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={tab.label} onPress={onPress} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', height: pill ? 52 : 50, gap: 3 }}>
      <Animated.View style={lift}>
        <Icon name={tab.icon} size={20} color={active ? p.text : p.muted} strokeWidth={active ? 2.1 : 1.7} />
      </Animated.View>
      <Txt size={10} weight={active ? '600' : '400'} color={active ? p.text : p.muted} numberOfLines={1}>
        {tab.label}
      </Txt>
      <Animated.View style={[{ position: 'absolute', bottom: pill ? 3 : 2, width: 14, height: 2.5, borderRadius: 2, backgroundColor: p.text }, dot]} />
    </Press>
  );
}

/**
 * Bottom navigation. `pill` is a floating rounded bar (used in Kid mode), `bar` is the flat bar.
 * The router is used directly because this Expo Router version passes no `navigation` to a custom tab bar.
 */
export function makeTabBar(tabs: TabDef[], variant: 'pill' | 'bar', base: string) {
  const Bar = ({ state }: BottomTabBarProps) => {
    const { p } = useTheme();
    const insets = useSafeAreaInsets();
    const current = state.routes[state.index]?.name;
    const pill = variant === 'pill';
    return (
      <View pointerEvents="box-none" style={pill ? { position: 'absolute', left: 16, right: 16, bottom: Math.max(insets.bottom, 12) } : undefined}>
        <View
          style={[
            { flexDirection: 'row', backgroundColor: p.tabBar, paddingHorizontal: 4 },
            pill
              ? { borderRadius: radius.pill, borderWidth: 1, borderColor: p.border, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 }
              : { borderTopWidth: 1, borderTopColor: p.border, paddingBottom: Math.max(insets.bottom, 4) },
          ]}>
          {tabs.map((tab) => (
            <Item key={tab.name} tab={tab} pill={pill} active={current === tab.name} onPress={() => router.navigate((tab.name === 'index' ? base : `${base}/${tab.name}`) as never)} />
          ))}
        </View>
      </View>
    );
  };
  return (props: BottomTabBarProps) => <Bar {...props} />;
}
