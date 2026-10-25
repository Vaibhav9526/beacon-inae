import { Tabs } from 'expo-router';
import { useMemo } from 'react';
import { ThemeProvider } from '../../components/ui';
import { makeTabBar } from '../../components/TabBar';
import { useT } from '../../i18n';
import { useSettings } from '../../state/settings';

export default function AdultLayout() {
  const t = useT();
  const lang = useSettings((s) => s.lang);
  const bar = useMemo(
    () =>
      makeTabBar(
        // two items, then the voice button in the middle, then two more
        [
          { name: 'index', label: t('tabHome'), icon: 'home' },
          { name: 'map', label: t('tabMap'), icon: 'map' },
          { name: 'aid', label: t('tabAid'), icon: 'aid' },
          { name: 'community', label: lang === 'hi' ? 'चैट' : 'Chat', icon: 'chat' },
        ],
        'bar',
        '/adult',
      ),
    [lang, t],
  );
  return (
    <ThemeProvider mode="adult">
      <Tabs tabBar={bar as never} screenOptions={{ headerShown: false }}>
        <Tabs.Screen name="index" />
        <Tabs.Screen name="map" />
        <Tabs.Screen name="aid" />
        <Tabs.Screen name="community" />
        <Tabs.Screen name="news" options={{ href: null }} />
        <Tabs.Screen name="more" options={{ href: null }} />
      </Tabs>
    </ThemeProvider>
  );
}
