import { useColorScheme } from 'react-native';
import { useSettings } from '../state/settings';

export type Mode = 'kid' | 'parent' | 'adult';

export interface Palette {
  /** app colour behind the content sheet (the wallpaper sits on top of it) */
  bg: string;
  /** the warm content sheet that holds every screen's content */
  sheet: string;
  /** deeper sheet colour, used for dark-mode edges and hairlines */
  sheetDark: string;
  card: string;
  cardAlt: string;
  text: string;
  muted: string;
  border: string;
  /** primary action: near-black in light mode, off-white in dark mode */
  accent: string;
  onAccent: string;
  /** brand yellow: nav highlight, FAB and small highlights */
  brand: string;
  onBrand: string;
  /** soft sky blue for quiet highlights */
  sky: string;
  danger: string;
  ok: string;
  warn: string;
  info: string;
  tabBar: string;
  dark: boolean;
  /** soft pastel tints used for cards and avatars; each has a matching ink colour for icons and text on top */
  tint: Record<'pink' | 'yellow' | 'blue' | 'green' | 'lilac' | 'peach', { bg: string; ink: string }>;
}

// subtle pastels: low saturation, dark ink in light mode
const pastel = {
  pink: { bg: '#F4D6DC', ink: '#6B2A3A' },
  yellow: { bg: '#F7E6A8', ink: '#5C4700' },
  blue: { bg: '#CFE2F7', ink: '#1E4A78' },
  green: { bg: '#D3EBCF', ink: '#2E5A2B' },
  lilac: { bg: '#E2DAF3', ink: '#42307A' },
  peach: { bg: '#F8DEC6', ink: '#6B3A12' },
};
// deeper, muted tints with light ink in dark mode
const pastelDark = {
  pink: { bg: '#3A2530', ink: '#F3B6C4' },
  yellow: { bg: '#3A3320', ink: '#EBD27A' },
  blue: { bg: '#1F2E42', ink: '#9CC3EC' },
  green: { bg: '#22331F', ink: '#A5D29E' },
  lilac: { bg: '#2C2640', ink: '#C3B3EE' },
  peach: { bg: '#3A2A1C', ink: '#EDBB91' },
};

export const light: Palette = {
  bg: '#6F8FC4',
  sheet: '#F6F1E6',
  sheetDark: '#15181F',
  card: '#FFFFFF',
  cardAlt: '#EFE8D8',
  text: '#14161C',
  muted: '#756F62',
  border: '#ECE5D6',
  accent: '#0F1115',
  onAccent: '#FFFFFF',
  brand: '#FFC928',
  onBrand: '#1A1400',
  sky: '#74C3FF',
  danger: '#E5484D',
  ok: '#1F9D63',
  warn: '#C77A0A',
  info: '#4F5FD9',
  tabBar: '#0F1115',
  dark: false,
  tint: pastel,
};

export const dark: Palette = {
  bg: '#2A3A5C',
  sheet: '#14171E',
  sheetDark: '#15181F',
  card: '#1D212B',
  cardAlt: '#262B37',
  text: '#F2F1EC',
  muted: '#9A9AA6',
  border: '#2A2F3B',
  accent: '#F2F1EC',
  onAccent: '#111111',
  brand: '#FFC928',
  onBrand: '#1A1400',
  sky: '#74C3FF',
  danger: '#FF6B70',
  ok: '#4CD08F',
  warn: '#F0B14A',
  info: '#9AA8FF',
  tabBar: '#F2F1EC',
  dark: true,
  tint: pastelDark,
};

export const contrast: Palette = {
  ...dark,
  bg: '#000000',
  sheet: '#000000',
  sheetDark: '#000000',
  card: '#0B0B0B',
  cardAlt: '#1A1A1A',
  text: '#FFFFFF',
  muted: '#E2E2E2',
  border: '#FFFFFF',
  accent: '#FFE600',
  onAccent: '#000000',
  brand: '#FFE600',
  onBrand: '#000000',
  sky: '#74C3FF',
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

export const radius = { sm: 10, md: 14, lg: 20, xl: 28, sheet: 32, pill: 999 };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export const fonts = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
} as const;

export const severityColor = (p: Palette, s: string) => (s === 'severe' ? p.danger : s === 'warning' ? p.warn : s === 'watch' ? p.info : p.muted);

// kept for the few places that still use the old kid colour names
export const kid = {
  ink: '#14161C',
  orange: '#FFC928',
  bg: '#F6F1E6',
};
