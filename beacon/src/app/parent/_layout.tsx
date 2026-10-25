import { Tabs } from 'expo-router';
import { useMemo } from 'react';
import { ThemeProvider } from '../../components/ui';
import { makeTabBar } from '../../components/TabBar';
import { useT } from '../../i18n';
import { useSettings } from '../../state/settings';

export default function ParentLayout() {
  const t = useT();
  const lang = useSettings((s) => s.lang);
  const bar = useMemo(
    () =>
      makeTabBar(
        [
          { name: 'index', label: t('tabKids'), icon: 'family' },
          { name: 'zones', label: t('tabZones'), icon: 'pin' },
          { name: 'alerts', label: t('tabAlerts'), icon: 'bell' },
          { name: 'settings', label: t('tabSettings'), icon: 'settings' },
        ],
        'bar',
        '/parent',
      ),
    [lang], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <ThemeProvider mode="parent">
      <Tabs tabBar={bar as never} screenOptions={{ headerShown: false }}>
        <Tabs.Screen name="index" />
        <Tabs.Screen name="zones" />
        <Tabs.Screen name="alerts" />
        <Tabs.Screen name="settings" />
      </Tabs>
    </ThemeProvider>
  );
}
