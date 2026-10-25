import * as Haptics from 'expo-haptics';
import { Linking, Platform } from 'react-native';
import { useSettings } from '../state/settings';
import { getFix } from './location';
import { useMesh } from './mesh';
import { sendOrQueue } from './outbox';

export interface SosResult {
  mesh: boolean;
  cloud: boolean;
  located: boolean;
}

const name = () => {
  const s = useSettings.getState();
  return (s.mode === 'kid' ? s.kidName : s.nickname) || s.nickname || s.kidName || 'Someone';
};

/**
 * Send help out on every channel at once:
 *  1. the Bluetooth mesh (works with no internet at all, repeats every 30 s so late phones still hear it)
 *  2. the family (via the server when online, queued on disk and retried when not)
 *  3. responders (the server's SOS board)
 */
export async function sendSosNow(note = ''): Promise<SosResult> {
  const s = useSettings.getState();
  if (s.haptics && Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  const fix = await getFix({ maxWaitMs: 4000 });
  const text = note || (s.mode === 'kid' ? 'A child needs help' : 'Need help');

  await useMesh.getState().sendSos(text);

  const id = Math.random().toString(16).slice(2, 10);
  const base = { name: name(), lat: fix?.lat, lon: fix?.lon, note: text };
  const results = await Promise.all([
    sendOrQueue('/v1/family/sos', { family: s.familyCode, ...base }),
    fix
      ? sendOrQueue('/v1/gateway/sync', {
          location: { lat: fix.lat, lon: fix.lon },
          sos: [{ id, name: name(), lat: fix.lat, lon: fix.lon, note: text, medical: undefined, ts: Date.now() }],
        })
      : Promise.resolve(false),
  ]);
  return { mesh: true, cloud: results.some(Boolean), located: !!fix };
}

export async function sendSafeNow(note?: string): Promise<{ cloud: boolean }> {
  const s = useSettings.getState();
  const fix = await getFix({ maxWaitMs: 3000 });
  await useMesh.getState().sendSafe(note);
  const ok = await sendOrQueue('/v1/family/safe', { family: s.familyCode, name: name(), lat: fix?.lat, lon: fix?.lon, note });
  return { cloud: ok };
}

/** For when there is no signal and no mesh neighbour: pre-filled SMS to the first emergency contact. */
export async function smsFallback() {
  const s = useSettings.getState();
  const fix = await getFix({ maxWaitMs: 2500 });
  // OpenStreetMap link (no Google) plus plain coordinates, so the text still works with no map app
  const lat = fix?.lat.toFixed(6);
  const lon = fix?.lon.toFixed(6);
  const where = fix ? ` My location: ${lat}, ${lon}. Map: https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}` : '';
  const body = `SOS from ${name()}. I need help.${where}`;
  const to = s.contacts.map((c) => c.phone).filter(Boolean).join(',');
  const sep = Platform.OS === 'ios' ? '&' : '?';
  await Linking.openURL(`sms:${to}${sep}body=${encodeURIComponent(body)}`);
}

export const call112 = () => Linking.openURL('tel:112');
