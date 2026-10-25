import { Tabs } from 'expo-router';
import { useMemo } from 'react';
import { ThemeProvider } from '../../components/ui';
import { makeTabBar } from '../../components/TabBar';
import { useT } from '../../i18n';
import { useSettings } from '../../state/settings';

export default function KidLayout() {
  const t = useT();
  const lang = useSettings((s) => s.lang);
  const bar = useMemo(
    () =>
      makeTabBar(
        // two items, then the voice button in the middle, then two more
        [
          { name: 'index', label: t('tabHome'), icon: 'home' },
          { name: 'learn', label: t('tabLearn'), icon: 'learn' },
          { name: 'play', label: t('tabPlay'), icon: 'play' },
          { name: 'me', label: t('tabMe'), icon: 'me' },
        ],
        'pill',
        '/kid',
      ),
    [lang, t],
  );
  return (
    <ThemeProvider mode="kid">
      <Tabs tabBar={bar as never} screenOptions={{ headerShown: false }}>
        <Tabs.Screen name="index" />
        <Tabs.Screen name="learn" />
        <Tabs.Screen name="play" />
        <Tabs.Screen name="didi" options={{ href: null }} />
        <Tabs.Screen name="me" />
        <Tabs.Screen name="game/[id]" options={{ href: null }} />
      </Tabs>
    </ThemeProvider>
  );
}
