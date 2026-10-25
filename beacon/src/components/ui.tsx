import React, { createContext, useContext, useEffect } from 'react';
import { Pressable, type PressableProps, Text, type TextProps, type TextStyle, View, type ViewProps, type ViewStyle } from 'react-native';
import Animated, { Easing, FadeIn, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import * as haptics from '../services/haptics';
import { useSettings } from '../state/settings';
import { type Mode, type Palette, fonts, radius, usePalette } from '../theme';
import { Icon, type IconName } from './Icon';

const ThemeCtx = createContext<{ p: Palette; mode: Mode } | null>(null);
/** Ink colour of the nearest tinted Card; text inside it defaults to this so it reads on the vivid block. */
export const InkCtx = createContext<string | null>(null);

export function ThemeProvider({ mode, children }: { mode: Mode; children: React.ReactNode }) {
  const p = usePalette(mode);
  const value = React.useMemo(() => ({ p, mode }), [p, mode]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const c = useContext(ThemeCtx);
  if (!c) throw new Error('useTheme outside ThemeProvider');
  return c;
}

// ---- type ----
// Callers still pass the old sizes and weights; they are mapped to the smaller, lighter scale in one place.
const sizeOf = (s: number) => (s <= 13 ? s - 0.5 : s <= 16 ? s - 1.5 : s <= 24 ? s - 3 : s * 0.8);
const familyOf = (w: TextStyle['fontWeight']) => {
  const n = typeof w === 'string' ? parseInt(w, 10) || 400 : (w ?? 400);
  return n >= 700 ? fonts.bold : n >= 600 ? fonts.semibold : n >= 500 ? fonts.medium : fonts.regular;
};

/** Text that honours the large-text setting and the palette. */
export function Txt({ size = 15, weight = '400', color, style, ...rest }: TextProps & { size?: number; weight?: TextStyle['fontWeight']; color?: string }) {
  const { p } = useTheme();
  const ink = useContext(InkCtx);
  const scale = useSettings((s) => (s.largeText ? 1.25 : 1));
  const fs = Math.max(11, sizeOf(size)) * scale;
  return <Text {...rest} style={[{ fontSize: fs, fontFamily: familyOf(weight), color: color ?? ink ?? p.text, lineHeight: fs * 1.42, includeFontPadding: false }, style]} />;
}

// ---- surfaces ----
export type TintName = keyof Palette['tint'];

export function Card({ style, tint, children, ...rest }: ViewProps & { tint?: TintName }) {
  const { p } = useTheme();
  const t = tint ? p.tint[tint] : null;
  // tinted cards are borderless vivid blocks; untinted cards keep a 1px hairline
  return (
    <View {...rest} style={[{ backgroundColor: t ? t.bg : p.card, borderRadius: 24, padding: 14, borderWidth: t ? 0 : 1, borderColor: p.border }, style]}>
      {t ? <InkCtx.Provider value={t.ink}>{children}</InkCtx.Provider> : children}
    </View>
  );
}

/** A small tinted circle holding an SVG icon: the app's replacement for emoji bullets. */
export function IconTile({ name, tint = 'lilac', size = 36, color }: { name: IconName; tint?: TintName; size?: number; color?: string }) {
  const { p } = useTheme();
  const t = p.tint[tint];
  return (
    <View style={{ width: size, height: size, borderRadius: 16, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={size * 0.5} color={color ?? t.ink} />
    </View>
  );
}

// ---- motion ----
const EASE = Easing.out(Easing.cubic);

/** Fades in and drifts up 6px over 220ms. Stagger is 40ms per index, capped at 240ms total. Reduced motion: fade only. */
export function Appear({ children, index = 0, style }: { children: React.ReactNode; index?: number; style?: ViewStyle }) {
  const reduced = useReducedMotion();
  const delay = Math.min(index * 40, 240);
  const y = useSharedValue(reduced ? 0 : 6);
  useEffect(() => {
    if (!reduced) y.value = withDelay(delay, withTiming(0, { duration: 220, easing: EASE }));
  }, [delay, reduced, y]);
  const drift = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <Animated.View entering={FadeIn.delay(delay).duration(220).easing(EASE)} style={[style, drift]}>
      {children}
    </Animated.View>
  );
}

export const Fade = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => (
  <Animated.View entering={FadeIn.duration(200).easing(EASE)} style={style}>
    {children}
  </Animated.View>
);

const APressable = Animated.createAnimatedComponent(Pressable);

/** Pressable that gives a very small press-in scale and a subtle haptic. `haptic={false}` silences it. */
export function Press({
  children,
  style,
  onPressIn,
  onPressOut,
  haptic = 'tap',
  ...rest
}: PressableProps & { style?: ViewStyle | ViewStyle[]; children: React.ReactNode; haptic?: false | 'tap' | 'soft' }) {
  const reduced = useReducedMotion();
  const s = useSharedValue(1);
  const o = useSharedValue(1);
  const a = useAnimatedStyle(() => (reduced ? {} : { transform: [{ scale: s.value }], opacity: o.value }));
  return (
    <APressable
      {...rest}
      onPressIn={(e) => {
        if (haptic === 'soft') haptics.soft();
        else if (haptic) haptics.tap();
        if (!reduced) {
          s.value = withTiming(0.985, { duration: 140, easing: EASE });
          o.value = withTiming(0.92, { duration: 140, easing: EASE });
        }
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (!reduced) {
          s.value = withTiming(1, { duration: 180, easing: EASE });
          o.value = withTiming(1, { duration: 180, easing: EASE });
        }
        onPressOut?.(e);
      }}
      style={[a, style as never]}>
      {children}
    </APressable>
  );
}

// ---- controls ----
export function Btn({
  label,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  style,
  size = 'md',
  accessibilityLabel,
  haptic = true,
}: {
  label: string;
  onPress?: PressableProps['onPress'];
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: IconName;
  disabled?: boolean;
  style?: ViewStyle;
  size?: 'sm' | 'md' | 'lg';
  accessibilityLabel?: string;
  haptic?: boolean;
}) {
  const { p } = useTheme();
  const bg = kind === 'primary' ? p.accent : kind === 'danger' ? p.danger : kind === 'secondary' ? p.cardAlt : 'transparent';
  const fg = kind === 'primary' ? p.onAccent : kind === 'danger' ? '#fff' : p.text;
  const h = size === 'lg' ? 50 : size === 'sm' ? 32 : 42;
  // Danger actions and icon-only primaries get the heavier soft impact; everything else a light tick.
  const hapticKind = kind === 'danger' || (kind === 'primary' && !label) ? 'soft' : 'tap';
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      haptic={haptic ? hapticKind : false}
      onPress={onPress}
      style={[{ height: h, paddingHorizontal: size === 'sm' ? 12 : 18, borderRadius: radius.pill, backgroundColor: bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, opacity: disabled ? 0.45 : 1, borderWidth: kind === 'ghost' ? 1 : 0, borderColor: p.border }, style ?? {}]}>
      {icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} color={fg} /> : null}
      {label ? (
        <Txt size={size === 'sm' ? 12.5 : 14.5} weight="600" color={fg}>
          {label}
        </Txt>
      ) : null}
    </Press>
  );
}

export function Chip({ label, active, onPress, icon, haptic = true }: { label: string; active?: boolean; onPress?: () => void; icon?: IconName; color?: string; haptic?: boolean }) {
  const { p } = useTheme();
  return (
    <Press accessibilityRole="button" onPress={onPress} haptic={haptic ? 'tap' : false} style={{ height: 32, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: active ? p.accent : 'transparent', borderWidth: 1, borderColor: active ? p.accent : p.border, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {icon ? <Icon name={icon} size={13} color={active ? p.onAccent : p.muted} /> : null}
      <Txt size={12.5} weight="500" color={active ? p.onAccent : p.text}>
        {label}
      </Txt>
    </Press>
  );
}

export function Badge({ label, color, textColor = '#fff', soft }: { label: string; color: string; textColor?: string; soft?: boolean }) {
  return (
    <View style={{ backgroundColor: soft ? color + '22' : color, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, alignSelf: 'flex-start' }}>
      <Txt size={10.5} weight="600" color={soft ? color : textColor}>
        {label}
      </Txt>
    </View>
  );
}

export function Row({ style, ...rest }: ViewProps) {
  return <View {...rest} style={[{ flexDirection: 'row', alignItems: 'center', gap: 10 }, style]} />;
}

export function Divider() {
  const { p } = useTheme();
  return <View style={{ height: 1, backgroundColor: p.border }} />;
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  const { p } = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between', marginTop: 4 }}>
      <Txt size={16} weight="600" color={p.text}>
        {children}
      </Txt>
      {right}
    </Row>
  );
}

export { View };
