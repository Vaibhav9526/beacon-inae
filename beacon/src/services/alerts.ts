import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { fetchAllAlerts } from '../alerts/sources';
import { fromBase64 } from '../mesh/bytes';
import type { AlertBody } from '../mesh/node';
import { useSettings } from '../state/settings';
import { type SignedAlert, cloud, cloudConfigured } from './cloud';
import { getFix } from './location';
import { useMesh } from './mesh';

export interface AlertItem extends AlertBody {
  /** official: signed by our server key, or fetched by this phone straight from the public source */
  trust: 'official' | 'relayed';
  origin: 'server' | 'direct' | 'mesh';
  seenAt: number;
}

interface AlertsState {
  items: AlertItem[];
  lastSync: number | null;
  syncing: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

const CACHE = 'beacon.alerts.v1';
const notified = new Set<string>();

async function loadCache(): Promise<AlertItem[]> {
  try {
    const raw = await AsyncStorage.getItem(CACHE);
    return raw ? (JSON.parse(raw) as AlertItem[]).filter((a) => !a.expires || a.expires > Date.now()) : [];
  } catch {
    return [];
  }
}

function merge(a: AlertItem[], b: AlertItem[]): AlertItem[] {
  const map = new Map<string, AlertItem>();
  for (const x of [...a, ...b]) {
    // air-quality readings older builds stored one per hour: they all count as the same alert, newest wins
    const key = x.id.startsWith('aqi-') ? 'aqi' : x.id;
    const prev = map.get(key);
    // keep an official copy over a relayed one; otherwise the newer reading wins
    if (!prev || (prev.trust === 'relayed' && x.trust === 'official') || (prev.trust === x.trust && x.seenAt > prev.seenAt)) map.set(key, x);
  }
  const rank = { severe: 0, warning: 1, watch: 2, info: 3 } as const;
  return [...map.values()].filter((x) => !x.expires || x.expires > Date.now()).sort((p, q) => rank[p.severity] - rank[q.severity] || q.seenAt - p.seenAt);
}

async function notifyNew(items: AlertItem[]) {
  if (Platform.OS === 'web') return;
  for (const a of items) {
    if (notified.has(a.id) || (a.severity !== 'severe' && a.severity !== 'warning')) continue;
    notified.add(a.id);
    try {
      await Notifications.scheduleNotificationAsync({
        content: { title: a.title, body: a.body.slice(0, 180), data: { alertId: a.id }, sound: 'default' },
        trigger: null,
      });
    } catch {
      /* notifications are best effort */
    }
  }
}

export const useAlerts = create<AlertsState>((set, get) => ({
  items: [],
  lastSync: null,
  syncing: false,
  error: null,

  async refresh() {
    if (get().syncing) return;
    set({ syncing: true, error: null });
    if (get().items.length === 0) set({ items: await loadCache() });
    const now = Date.now();
    try {
      const fix = await getFix({ maxWaitMs: 4000 });
      if (!fix) throw new Error('no location');
      let fetched: AlertItem[] = [];
      let sigs = new Map<string, string>();
      if (cloudConfigured()) {
        const res = await cloud.get<{ alerts: SignedAlert[] }>(`/v1/alerts?lat=${fix.lat}&lon=${fix.lon}`);
        fetched = res.alerts.map((x) => ({ ...x.alert, trust: 'official', origin: 'server', seenAt: now }));
        sigs = new Map(res.alerts.map((x) => [x.alert.id, x.sig]));
      } else {
        fetched = (await fetchAllAlerts(fix)).map((a) => ({ ...a, trust: 'official' as const, origin: 'direct' as const, seenAt: now }));
      }
      const meshOnes: AlertItem[] = useMesh
        .getState()
        .alerts.map((a) => ({ ...a, trust: a.verified ? ('official' as const) : ('relayed' as const), origin: 'mesh' as const, seenAt: now }));
      const items = merge(fetched, merge(get().items, meshOnes));
      set({ items, lastSync: now, syncing: false });
      AsyncStorage.setItem(CACHE, JSON.stringify(items.slice(0, 40))).catch(() => {});
      void notifyNew(fetched);
      // We have internet, so we are a gateway: hand fresh official alerts to phones that do not.
      for (const a of fetched.slice(0, 5)) {
        const sig = sigs.get(a.id);
        const { trust: _t, origin: _o, seenAt: _s, ...body } = a;
        useMesh.getState().relayAlert(body, sig ? fromBase64(sig) : undefined);
      }
    } catch (e) {
      // offline: show the last cache plus whatever the mesh brought
      const meshOnes: AlertItem[] = useMesh
        .getState()
        .alerts.map((a) => ({ ...a, trust: a.verified ? ('official' as const) : ('relayed' as const), origin: 'mesh' as const, seenAt: now }));
      set({ items: merge(get().items, meshOnes), syncing: false, error: String((e as Error).message ?? e) });
    }
  },
}));

export async function setupNotifications() {
  if (Platform.OS === 'web') return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('alerts', { name: 'Disaster alerts', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 400, 200, 400], lightColor: '#FF8A1F' });
    }
    const cur = await Notifications.getPermissionsAsync();
    if (!cur.granted) await Notifications.requestPermissionsAsync();
  } catch {
    /* ignore */
  }
}

/** Gives the server a push token (FCM) and the area this phone is in, so warnings reach it even when the app is closed. */
export async function registerPush() {
  if (!cloudConfigured() || Platform.OS !== 'android') return;
  try {
    const token = await Notifications.getDevicePushTokenAsync(); // FCM token on Android
    const fix = await getFix({ maxWaitMs: 3000 });
    await cloud.post('/v1/devices', { pushToken: String(token.data), lat: fix?.lat, lon: fix?.lon, lang: useSettings.getState().lang });
  } catch {
    /* FCM needs google-services.json in the build; without it we simply skip push */
  }
}

export const alertsFresh = (s: AlertsState) => (s.lastSync ? Date.now() - s.lastSync < 15 * 60_000 : false);
