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
        [
          { name: 'index', label: t('tabHome'), icon: 'home' },
          { name: 'map', label: t('tabMap'), icon: 'map' },
          { name: 'community', label: t('tabCommunity'), icon: 'chat' },
          { name: 'news', label: t('tabNews'), icon: 'news' },
          { name: 'aid', label: t('tabAid'), icon: 'aid' },
          { name: 'more', label: t('tabMore'), icon: 'more' },
        ],
        'bar',
        '/adult',
      ),
    [lang], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <ThemeProvider mode="adult">
      <Tabs tabBar={bar as never} screenOptions={{ headerShown: false }}>
        <Tabs.Screen name="index" />
        <Tabs.Screen name="map" />
        <Tabs.Screen name="community" />
        <Tabs.Screen name="news" />
        <Tabs.Screen name="aid" />
        <Tabs.Screen name="more" />
      </Tabs>
    </ThemeProvider>
  );
}
