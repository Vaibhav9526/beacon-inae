import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

export interface Fix {
  lat: number;
  lon: number;
  accuracy?: number;
  ts: number;
}

const KEY = 'beacon.lastFix';
let cached: Fix | null = null;

async function load(): Promise<Fix | null> {
  if (cached) return cached;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) cached = JSON.parse(raw) as Fix;
  } catch {
    /* no cache yet */
  }
  return cached;
}

function remember(f: Fix) {
  cached = f;
  AsyncStorage.setItem(KEY, JSON.stringify(f)).catch(() => {});
}

export async function ensureLocationPermission(): Promise<boolean> {
  try {
    const cur = await Location.getForegroundPermissionsAsync();
    if (cur.granted) return true;
    return (await Location.requestForegroundPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/**
 * Best position we can get quickly. In an emergency a slightly old fix beats waiting, so this falls back
 * to the last known fix (this session or the previous one) rather than failing.
 */
export async function getFix(opts: { maxWaitMs?: number } = {}): Promise<Fix | null> {
  const wait = opts.maxWaitMs ?? 6000;
  if (!(await ensureLocationPermission())) return load();
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 2 * 60_000 });
    if (last) {
      const f = { lat: last.coords.latitude, lon: last.coords.longitude, accuracy: last.coords.accuracy ?? undefined, ts: last.timestamp };
      remember(f);
      return f;
    }
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((r) => setTimeout(() => r(null), wait)),
    ]);
    if (fresh) {
      const f = { lat: fresh.coords.latitude, lon: fresh.coords.longitude, accuracy: fresh.coords.accuracy ?? undefined, ts: fresh.timestamp };
      remember(f);
      return f;
    }
  } catch {
    /* fall through to the cached fix */
  }
  return load();
}

export async function lastKnownFix(): Promise<Fix | null> {
  return load();
}

export async function watchFix(cb: (f: Fix) => void): Promise<() => void> {
  if (!(await ensureLocationPermission())) return () => {};
  const sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 25, timeInterval: 20_000 }, (p) => {
    const f = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy ?? undefined, ts: p.timestamp };
    remember(f);
    cb(f);
  });
  return () => sub.remove();
}
