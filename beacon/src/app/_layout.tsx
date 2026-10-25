import '../polyfills';
import { Lexend_400Regular, Lexend_500Medium, Lexend_600SemiBold, useFonts } from '@expo-google-fonts/lexend';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { startNeedle } from '../ai/needle';
import { ThemeProvider } from '../components/ui';
import { VoiceDock } from '../components/VoiceDock';
import { registerPush, setupNotifications, useAlerts } from '../services/alerts';
import { startFamilyPing, startGateway, stopFamilyPing } from '../services/gateway';
import { startHubInbox } from '../services/hub';
import { useMesh } from '../services/mesh';
import { useSettings } from '../state/settings';
import { usePalette } from '../theme';

export default function RootLayout() {
  const hydrated = useSettings((s) => s.hydrated);
  const onboarded = useSettings((s) => s.onboarded);
  const mode = useSettings((s) => s.mode);
  const [fontsLoaded] = useFonts({ Lexend_400Regular, Lexend_500Medium, Lexend_600SemiBold });
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

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: p.bg }}>
      <SafeAreaProvider>
        <StatusBar style={p.dark ? 'light' : 'dark'} />
        {/* one theme for the whole tree, so every screen can call useTheme() */}
        <ThemeProvider mode={mode ?? 'adult'}>{fontsLoaded ? <View style={{ flex: 1 }}><Stack screenOptions={{ headerShown: false, animation: 'fade_from_bottom', animationDuration: 200, contentStyle: { backgroundColor: p.bg } }} /><VoiceDock hidden={!onboarded} /></View> : <View style={{ flex: 1, backgroundColor: p.bg }} />}</ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
