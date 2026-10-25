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

// one vivid set for both themes: saturated blocks with black ink, like stickers on a plain page
const vivid = {
  pink: { bg: '#F670C4', ink: '#1A0A14' },
  yellow: { bg: '#FFD85E', ink: '#1F1700' },
  blue: { bg: '#8FA1FB', ink: '#0B1033' },
  green: { bg: '#9EE6A0', ink: '#06210A' },
  lilac: { bg: '#B9A0FB', ink: '#1A1033' },
  peach: { bg: '#FDB155', ink: '#2A1500' },
};
const lightTints = vivid;
const darkTints = vivid;

export const light: Palette = {
  bg: '#FFFFFF',
  card: '#F4F0FE',
  cardAlt: '#ECE6FB',
  text: '#0A0A0C',
  muted: '#6F6B80',
  border: '#E5DFF5',
  accent: '#0A0A0C',
  onAccent: '#FFFFFF',
  danger: '#E5484D',
  ok: '#1F9D63',
  warn: '#C77A0A',
  info: '#4F5FD9',
  tabBar: '#0A0A0C',
  dark: false,
  tint: lightTints,
};

export const dark: Palette = {
  bg: '#000000',
  card: '#131216',
  cardAlt: '#1D1B22',
  text: '#FFFFFF',
  muted: '#A19DB3',
  border: '#27242F',
  accent: '#FFFFFF',
  onAccent: '#000000',
  danger: '#FF6B70',
  ok: '#4CD08F',
  warn: '#F0B14A',
  info: '#9AA8FF',
  tabBar: '#FFFFFF',
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

export const radius = { sm: 10, md: 14, lg: 24, xl: 28, pill: 999 };

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
  ink: '#0A0A0C',
  orange: '#0A0A0C',
  bg: '#FFFFFF',
};
