import { router, usePathname } from 'expo-router';
import React from 'react';
import { ScrollView, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../i18n';
import { useSettings } from '../state/settings';
import type { Mode } from '../theme';
import { Icon } from './Icon';
import { Press, ThemeProvider, Txt, useTheme } from './ui';

/** Wraps a screen: calm background, safe areas, a small header. `mode` is accepted for old callers; all modes share the look. */
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

/** Tab bar height (about 54px flat bar, or the kid floating pill with its gap). */
const TAB_BAR_CLEARANCE = 64;
/** Tab screens: /adult/<tab> and /kid/<tab>, where the bottom tab bar (or kid pill) is on screen. */
const TAB_ROUTE = /^\/(adult|kid)(\/(index|map|community|news|aid|more|learn|play|didi|me))?\/?$/;

function Inner({ title, children, scroll, back, right, contentStyle, bottomPad }: { title?: string; children: React.ReactNode; scroll: boolean; back: boolean; right?: React.ReactNode; contentStyle?: ViewStyle; bottomPad: number }) {
  const { p } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const onTabs = TAB_ROUTE.test(pathname);
  const bottom = bottomPad + insets.bottom + (onTabs ? TAB_BAR_CLEARANCE : 0);
  const body = scroll ? (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={[{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: bottom, gap: 12 }, contentStyle]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: p.bg, paddingTop: insets.top }}>
      {title || back ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, minHeight: 52, gap: 8 }}>
          {back ? (
            <Press accessibilityRole="button" accessibilityLabel={t('back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: p.card, borderWidth: 1, borderColor: p.border, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="back" size={16} />
            </Press>
          ) : null}
          <Txt size={19} weight="700" style={{ flex: 1, paddingLeft: back ? 2 : 6 }} numberOfLines={1}>
            {title}
          </Txt>
          {right}
        </View>
      ) : null}
      {body}
    </View>
  );
}
