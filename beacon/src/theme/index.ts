import { useColorScheme } from 'react-native';
import { useSettings } from '../state/settings';

export type Mode = 'kid' | 'parent' | 'adult';

export interface Palette {
  bg: string;
  card: string;
  cardAlt: string;
  text: string;
  muted: string;
  border: string;
  /** primary action: near-black in light mode, off-white in dark mode */
  accent: string;
  onAccent: string;
  danger: string;
  ok: string;
  warn: string;
  info: string;
  tabBar: string;
  dark: boolean;
  /** soft tints used for cards and avatars; each has a matching ink colour for icons and text on top */
  tint: Record<'pink' | 'yellow' | 'blue' | 'green' | 'lilac' | 'peach', { bg: string; ink: string }>;
}

const lightTints = {
  pink: { bg: '#FFD9E8', ink: '#9B2C5A' },
  yellow: { bg: '#FFEDB3', ink: '#8A6410' },
  blue: { bg: '#CDEEFF', ink: '#1F6A93' },
  green: { bg: '#D3F5A8', ink: '#3D7A12' },
  lilac: { bg: '#E6DCFF', ink: '#5B3FA8' },
  peach: { bg: '#FFE0CC', ink: '#A24A1B' },
};

const darkTints = {
  pink: { bg: '#3A2230', ink: '#FF9CC4' },
  yellow: { bg: '#38301A', ink: '#F4CB62' },
  blue: { bg: '#1D3140', ink: '#7CCBF5' },
  green: { bg: '#23331A', ink: '#A6DE6B' },
  lilac: { bg: '#2D2640', ink: '#B9A3FF' },
  peach: { bg: '#3A281E', ink: '#FFB188' },
};

export const light: Palette = {
  bg: '#F7F6F3',
  card: '#FFFFFF',
  cardAlt: '#F0EEE9',
  text: '#17171B',
  muted: '#7B7B86',
  border: '#E8E6E0',
  accent: '#17171B',
  onAccent: '#FFFFFF',
  danger: '#D14B4B',
  ok: '#2E9B5F',
  warn: '#B97D12',
  info: '#2F7FB5',
  tabBar: '#FFFFFF',
  dark: false,
  tint: lightTints,
};

export const dark: Palette = {
  bg: '#111114',
  card: '#1A1A1F',
  cardAlt: '#232329',
  text: '#F1F1F4',
  muted: '#9A9AA6',
  border: '#2B2B33',
  accent: '#F1F1F4',
  onAccent: '#111114',
  danger: '#FF6B6B',
  ok: '#4CC78A',
  warn: '#E9B44C',
  info: '#6DB8EA',
  tabBar: '#16161A',
  dark: true,
  tint: darkTints,
};

export const contrast: Palette = {
  ...dark,
  bg: '#000000',
  card: '#0B0B0B',
  cardAlt: '#1A1A1A',
  text: '#FFFFFF',
  muted: '#E2E2E2',
  border: '#FFFFFF',
  accent: '#FFE600',
  onAccent: '#000000',
  tabBar: '#000000',
};

/** `mode` is kept so callers can ask for a mode, but all modes now share one calm look. */
export function usePalette(_mode?: Mode): Palette {
  const high = useSettings((s) => s.highContrast);
  const appearance = useSettings((s) => s.appearance);
  const system = useColorScheme();
  if (high) return contrast;
  const wantDark = appearance === 'dark' || (appearance === 'system' && system === 'dark');
  return wantDark ? dark : light;
}

export const radius = { sm: 10, md: 14, lg: 20, xl: 26, pill: 999 };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export const fonts = {
  regular: 'Lexend_400Regular',
  medium: 'Lexend_500Medium',
  semibold: 'Lexend_600SemiBold',
} as const;

export const severityColor = (p: Palette, s: string) => (s === 'severe' ? p.danger : s === 'warning' ? p.warn : s === 'watch' ? p.info : p.muted);

// kept for the few places that still use the old kid colour names
export const kid = {
  ink: '#17171B',
  orange: '#17171B',
  bg: '#F7F6F3',
};
