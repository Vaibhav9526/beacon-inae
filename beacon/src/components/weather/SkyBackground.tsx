import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../ui';

type Stops = { offset: string; color: string }[];

// light mode, daytime: dusk blue at the top, warm orange near the middle, cream at the bottom
const DAY_LIGHT: Stops = [
  { offset: '0%', color: '#8EA0D8' },
  { offset: '45%', color: '#F3A66B' },
  { offset: '100%', color: '#F7EFE8' },
];
// light mode, night: a cooler dusk so the sky still reads as evening
const NIGHT_LIGHT: Stops = [
  { offset: '0%', color: '#5C6BAF' },
  { offset: '50%', color: '#B58BA8' },
  { offset: '100%', color: '#EFE3DE' },
];
// dark mode: deep indigo to plum to near black, so glass cards stay readable
const DARK: Stops = [
  { offset: '0%', color: '#141833' },
  { offset: '55%', color: '#2A1B38' },
  { offset: '100%', color: '#1B1220' },
];

/** Full-screen vertical sky gradient. Palette comes from the theme (light or dark) and from `isDay`. */
export function SkyBackground({ isDay = true, style }: { isDay?: boolean; style?: ViewStyle }) {
  const { p } = useTheme();
  const stops = p.dark ? DARK : isDay ? DAY_LIGHT : NIGHT_LIGHT;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            {stops.map((s) => (
              <Stop key={s.offset} offset={s.offset} stopColor={s.color} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#sky)" />
      </Svg>
    </View>
  );
}

/** Frosted glass surface used by every weather card. */
export function GlassCard({ children, style, tint }: { children: React.ReactNode; style?: ViewStyle; tint?: 'alert' | 'ok' }) {
  const { p } = useTheme();
  const dark = p.dark;
  const bg =
    tint === 'alert'
      ? dark
        ? 'rgba(255,107,112,0.14)'
        : 'rgba(229,72,77,0.14)'
      : tint === 'ok'
        ? dark
          ? 'rgba(76,208,143,0.12)'
          : 'rgba(31,157,99,0.12)'
        : dark
          ? 'rgba(255,255,255,0.08)'
          : 'rgba(255,255,255,0.55)';
  const border = dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.7)';
  return <View style={[{ backgroundColor: bg, borderRadius: 24, borderWidth: 1, borderColor: border, padding: 18 }, style]}>{children}</View>;
}
