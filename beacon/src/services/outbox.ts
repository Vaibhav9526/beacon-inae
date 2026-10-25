import AsyncStorage from '@react-native-async-storage/async-storage';
import { CloudError, cloud, cloudConfigured } from './cloud';

// Things that must reach the server eventually (SOS to family, check-ins). Kept on disk so they survive a restart
// and are retried every time the gateway loop runs, because the phone may be offline for hours.
interface Pending {
  id: string;
  path: string;
  body: unknown;
  created: number;
  tries: number;
}

const KEY = 'beacon.outbox.v1';
const MAX_AGE = 48 * 3600_000;

async function load(): Promise<Pending[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]') as Pending[];
  } catch {
    return [];
  }
}
const save = (a: Pending[]) => AsyncStorage.setItem(KEY, JSON.stringify(a.slice(-100))).catch(() => {});

/** Try now; if it cannot be delivered, keep it for later. Resolves true if the server accepted it. */
export async function sendOrQueue(path: string, body: unknown): Promise<boolean> {
  if (cloudConfigured()) {
    try {
      await cloud.post(path, body);
      return true;
    } catch (e) {
      // a 4xx will never succeed on retry; only keep network and server failures
      if (e instanceof CloudError && e.status >= 400 && e.status < 500) return false;
    }
  }
  const q = await load();
  q.push({ id: Math.random().toString(36).slice(2), path, body, created: Date.now(), tries: 0 });
  await save(q);
  return false;
}

export async function flushOutbox(): Promise<number> {
  if (!cloudConfigured()) return 0;
  const q = await load();
  if (q.length === 0) return 0;
  const keep: Pending[] = [];
  let sent = 0;
  for (const item of q) {
    if (Date.now() - item.created > MAX_AGE) continue;
    try {
      await cloud.post(item.path, item.body);
      sent++;
    } catch (e) {
      if (e instanceof CloudError && e.status >= 400 && e.status < 500) continue; // rejected for good
      keep.push({ ...item, tries: item.tries + 1 });
    }
  }
  await save(keep);
  return sent;
}

export const outboxSize = async () => (await load()).length;
