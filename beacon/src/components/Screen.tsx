import { router, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ScrollView, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../i18n';
import { useSettings } from '../state/settings';
import { type Mode, fonts, radius } from '../theme';
import { AppBackground } from './AppBackground';
import { Icon } from './Icon';
import { InkCtx, Press, ThemeProvider, useTheme } from './ui';

/**
 * Wraps a screen in the app's chat-style frame: the slate wallpaper, a light header on top,
 * and all content inside a warm cream sheet with a 32px rounded top edge.
 * `mode` is accepted for old callers; all modes share the look.
 */
export function Screen({
  title,
  children,
  scroll = true,
  back = true,
  mode,
  right,
  contentStyle,
  bottomPad = 28,
}: {
  title?: string;
  children: React.ReactNode;
  scroll?: boolean;
  back?: boolean;
  mode?: Mode;
  right?: React.ReactNode;
  contentStyle?: ViewStyle;
  bottomPad?: number;
}) {
  const stored = useSettings((s) => s.mode);
  const m = mode ?? stored ?? 'adult';
  return (
    <ThemeProvider mode={m}>
      <Inner title={title} scroll={scroll} back={back} right={right} contentStyle={contentStyle} bottomPad={bottomPad}>
        {children}
      </Inner>
    </ThemeProvider>
  );
}

/** Floating nav clearance on tab routes: bar 64 + FAB overlap ~16 + margin 16 + breathing room 24 (safe area is added separately). */
const TAB_BAR_CLEARANCE = 120;
/** Tab screens: /adult/<tab> and /kid/<tab>, where the bottom tab bar (or kid pill) is on screen. */
const TAB_ROUTE = /^\/(adult|kid)(\/(index|map|community|news|aid|more|learn|play|didi|me))?\/?$/;

const WHITE = '#FFFFFF';
const FROSTED = 'rgba(255,255,255,0.22)';

function Inner({ title, children, scroll, back, right, contentStyle, bottomPad }: { title?: string; children: React.ReactNode; scroll: boolean; back: boolean; right?: React.ReactNode; contentStyle?: ViewStyle; bottomPad: number }) {
  const { p } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const scale = useSettings((s) => (s.largeText ? 1.25 : 1));
  const onTabs = TAB_ROUTE.test(pathname);
  const bottom = onTabs ? TAB_BAR_CLEARANCE + insets.bottom : bottomPad + insets.bottom;
  const hasHeader = Boolean(title || back || right);
  // a screen with neither title nor back (Home) draws its own greeting, so the header strip is shorter
  const headerMin = title || back ? 56 : hasHeader ? 44 : 12;

  const body = scroll ? (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={[{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: bottom, gap: 12 }, contentStyle]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    // fixed layouts (chat) keep their composer above the floating bar
    <View style={[{ flex: 1, paddingBottom: onTabs ? TAB_BAR_CLEARANCE - 24 + insets.bottom : 0 }, contentStyle]}>{children}</View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      {/* the header sits on a light-on-colour background, so the status bar always uses light ink */}
      <StatusBar style="light" />
      <AppBackground />
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, minHeight: headerMin, gap: 12 }}>
          {back ? (
            <Press accessibilityRole="button" accessibilityLabel={t('back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: FROSTED, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="back" size={18} color={WHITE} />
            </Press>
          ) : null}
          {title ? (
            <Text numberOfLines={1} style={{ flex: 1, color: WHITE, fontFamily: fonts.bold, fontSize: 26 * scale, lineHeight: 26 * scale * 1.3, includeFontPadding: false }}>
              {title}
            </Text>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          {right ? <InkCtx.Provider value={WHITE}>{right}</InkCtx.Provider> : null}
        </View>

        {/* the content sheet: fills the rest of the screen, rounded at the top */}
        <View style={{ flex: 1, backgroundColor: p.sheet, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, overflow: 'hidden', paddingTop: 18 }}>
          {body}
        </View>
      </View>
    </View>
  );
}
