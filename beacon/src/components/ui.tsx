import * as Haptics from 'expo-haptics';
import React, { createContext, useContext } from 'react';
import { Platform, Pressable, type PressableProps, Text, type TextProps, type TextStyle, View, type ViewProps, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSettings } from '../state/settings';
import { type Mode, type Palette, fonts, radius, usePalette } from '../theme';
import { Icon, type IconName } from './Icon';

const ThemeCtx = createContext<{ p: Palette; mode: Mode } | null>(null);

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
const sizeOf = (s: number) => (s <= 13 ? s - 0.5 : s <= 16 ? s - 2 : s <= 24 ? s - 4 : s * 0.7);
const familyOf = (w: TextStyle['fontWeight']) => {
  const n = typeof w === 'string' ? parseInt(w, 10) || 400 : (w ?? 400);
  return n >= 700 ? fonts.semibold : n >= 600 ? fonts.medium : n >= 500 ? fonts.medium : fonts.regular;
};

/** Text that honours the large-text setting and the palette. */
export function Txt({ size = 15, weight = '400', color, style, ...rest }: TextProps & { size?: number; weight?: TextStyle['fontWeight']; color?: string }) {
  const { p } = useTheme();
  const scale = useSettings((s) => (s.largeText ? 1.25 : 1));
  const fs = Math.max(11, sizeOf(size)) * scale;
  return <Text {...rest} style={[{ fontSize: fs, fontFamily: familyOf(weight), color: color ?? p.text, lineHeight: fs * 1.42, includeFontPadding: false }, style]} />;
}

// ---- surfaces ----
export type TintName = keyof Palette['tint'];

export function Card({ style, tint, ...rest }: ViewProps & { tint?: TintName }) {
  const { p } = useTheme();
  const t = tint ? p.tint[tint] : null;
  return <View {...rest} style={[{ backgroundColor: t ? t.bg : p.card, borderRadius: radius.lg, padding: 14, borderWidth: t ? 0 : 1, borderColor: p.border }, style]} />;
}

/** A small tinted circle holding an SVG icon: the app's replacement for emoji bullets. */
export function IconTile({ name, tint = 'lilac', size = 36, color }: { name: IconName; tint?: TintName; size?: number; color?: string }) {
  const { p } = useTheme();
  const t = p.tint[tint];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={size * 0.5} color={color ?? t.ink} />
    </View>
  );
}

// ---- motion ----
/** Fades and lifts a block in. Give each sibling a growing `index` for a gentle stagger. */
export function Appear({ children, index = 0, style }: { children: React.ReactNode; index?: number; style?: ViewStyle }) {
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 45).duration(260).springify().damping(18)} style={style}>
      {children}
    </Animated.View>
  );
}

export const Fade = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => (
  <Animated.View entering={FadeIn.duration(220)} style={style}>
    {children}
  </Animated.View>
);

const APressable = Animated.createAnimatedComponent(Pressable);

/** Pressable that gives a very small spring on touch. */
export function Press({ children, style, onPressIn, onPressOut, ...rest }: PressableProps & { style?: ViewStyle | ViewStyle[]; children: React.ReactNode }) {
  const s = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <APressable
      {...rest}
      onPressIn={(e) => {
        s.value = withTiming(0.97, { duration: 90 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        s.value = withSpring(1, { damping: 14, stiffness: 260 });
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
}: {
  label: string;
  onPress?: PressableProps['onPress'];
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: IconName;
  disabled?: boolean;
  style?: ViewStyle;
  size?: 'sm' | 'md' | 'lg';
  accessibilityLabel?: string;
}) {
  const { p } = useTheme();
  const haptics = useSettings((s) => s.haptics);
  const bg = kind === 'primary' ? p.accent : kind === 'danger' ? p.danger : kind === 'secondary' ? p.cardAlt : 'transparent';
  const fg = kind === 'primary' ? p.onAccent : kind === 'danger' ? '#fff' : p.text;
  const h = size === 'lg' ? 50 : size === 'sm' ? 32 : 42;
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={(e) => {
        if (haptics && Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
        onPress?.(e);
      }}
      style={[{ height: h, paddingHorizontal: size === 'sm' ? 12 : 18, borderRadius: radius.pill, backgroundColor: bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, opacity: disabled ? 0.45 : 1, borderWidth: kind === 'ghost' ? 1 : 0, borderColor: p.border }, style ?? {}]}>
      {icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} color={fg} /> : null}
      {label ? (
        <Txt size={size === 'sm' ? 12.5 : 14.5} weight="500" color={fg}>
          {label}
        </Txt>
      ) : null}
    </Press>
  );
}

export function Chip({ label, active, onPress, icon }: { label: string; active?: boolean; onPress?: () => void; icon?: IconName; color?: string }) {
  const { p } = useTheme();
  return (
    <Press accessibilityRole="button" onPress={onPress} style={{ height: 32, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: active ? p.accent : 'transparent', borderWidth: 1, borderColor: active ? p.accent : p.border, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
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
      <Txt size={12} weight="600" color={p.muted} style={{ letterSpacing: 0.6, textTransform: 'uppercase' }}>
        {children}
      </Txt>
      {right}
    </Row>
  );
}

export { View };
