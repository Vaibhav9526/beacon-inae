import '../polyfills';
import { Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold, useFonts } from '@expo-google-fonts/poppins';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { startNeedle } from '../ai/needle';
import { FallPrompt } from '../components/FallPrompt';
import { LifeboatBanner } from '../components/LifeboatBanner';
import { ShakeChip, ShakeWarning } from '../components/ShakeWarning';
import { ThemeProvider } from '../components/ui';
import { registerPush, setupNotifications, useAlerts } from '../services/alerts';
import { startFallWatch, stopFallWatch } from '../services/fall';
import { startBreadcrumbs, stopBreadcrumbs } from '../services/breadcrumbService';
import { startFamilyPing, startGateway, stopFamilyPing } from '../services/gateway';
import { startHubInbox } from '../services/hub';
import { startLifeboatWatch } from '../services/lifeboat';
import { useMesh } from '../services/mesh';
import { useNotificationRouting } from '../services/notificationRouting';
import { useQuakeService } from '../services/quakeService';
import { useSettings } from '../state/settings';
import { usePalette } from '../theme';

export default function RootLayout() {
  const hydrated = useSettings((s) => s.hydrated);
  const onboarded = useSettings((s) => s.onboarded);
  const mode = useSettings((s) => s.mode);
  const fallDetect = useSettings((s) => s.fallDetect);
  const [fontsLoaded] = useFonts({ Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold });
  const p = usePalette();

  // Once the user is set up, bring the phone's "always on" parts to life: the Bluetooth mesh, alerts and the gateway.
  useEffect(() => {
    if (!hydrated || !onboarded) return;
    void setupNotifications();
    void useMesh.getState().start();
    void useAlerts.getState().refresh();
    startGateway();
    startHubInbox();
    void registerPush();
    void startNeedle();
    if (mode === 'kid') startFamilyPing();
    return () => stopFamilyPing();
  }, [hydrated, onboarded, mode]);

  useEffect(() => {
    if (!hydrated || !onboarded || !fallDetect) return;
    startFallWatch();
    return stopFallWatch;
  }, [hydrated, onboarded, fallDetect]);

  useEffect(() => {
    if (!hydrated || !onboarded) return;
    return startLifeboatWatch();
  }, [hydrated, onboarded]);

  useEffect(() => {
    if (!hydrated || !onboarded) return;
    startBreadcrumbs();
    return stopBreadcrumbs;
  }, [hydrated, onboarded]);

  // Hook: runs the shake watch only while its switch is on and the mesh is running (off by default).
  useQuakeService();
  // Hook: routes a tap on a notification to its detail page.
  useNotificationRouting();

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: p.bg }}>
      <SafeAreaProvider>
        <StatusBar style={p.dark ? 'light' : 'dark'} />
        {/* one theme for the whole tree, so every screen can call useTheme() */}
        <ThemeProvider mode={mode ?? 'adult'}>{fontsLoaded ? <View style={{ flex: 1 }}><Stack screenOptions={{ headerShown: false, animation: 'fade_from_bottom', animationDuration: 200, contentStyle: { backgroundColor: p.bg } }} /><FallPrompt /><ShakeWarning /><ShakeChip /><LifeboatBanner /></View> : <View style={{ flex: 1, backgroundColor: p.bg }} />}</ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
