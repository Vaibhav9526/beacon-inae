import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { usePalette } from '../theme';

/** Slate-blue concrete wallpaper, pre-resized to 720px wide (see assets/bg-slate.jpg). */
const WALLPAPER = require('../../assets/bg-slate.jpg');

/** Absolute-fill wallpaper with a soft gradient veil on top. Sits behind everything; ignores touches. */
export function AppBackground() {
  const { dark } = usePalette();
  // light: sky-blue haze at the top, indigo at the bottom; dark: a deeper navy veil at both ends
  const stops = dark
    ? [
        { offset: '0', color: '#0B1226', opacity: 0.55 },
        { offset: '0.5', color: '#0B1226', opacity: 0.1 },
        { offset: '1', color: '#0B1226', opacity: 0.75 },
      ]
    : [
        { offset: '0', color: '#9CC3F0', opacity: 0.55 },
        { offset: '0.5', color: '#9CC3F0', opacity: 0 },
        { offset: '1', color: '#1B2A52', opacity: 0.45 },
      ];
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Image source={WALLPAPER} resizeMode="cover" style={StyleSheet.absoluteFill} />
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="veil" x1="0" y1="0" x2="0" y2="1">
            {stops.map((s) => (
              <Stop key={s.offset} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#veil)" />
      </Svg>
    </View>
  );
}

/** Wraps children on top of the wallpaper. Hook-free: it only composes the background. */
export function Backdrop({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1 }}>
      <AppBackground />
      {children}
    </View>
  );
}
