import AsyncStorage from '@react-native-async-storage/async-storage';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import * as FS from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { fromBase64, toBase64, toHex, utf8 } from '../mesh/bytes';
import { CloudError, type ReportView, cloud, cloudConfigured } from './cloud';
import { getIdentity } from './identity';
import { getFix } from './location';

// Reports can only come from the in-app camera (there is no gallery picker anywhere in Beacon). Each one carries
// a signed proof binding the pixels, the time and the place to this device's key. Anything captured while offline is
// kept on disk and uploaded when the phone reaches the internet.

export interface CaptureInput {
  kind: 'photo' | 'video';
  /** file:// uri straight from the camera */
  uri: string;
  mime: string;
  /** JPEG poster frame for a video */
  thumbUri?: string;
  caption: string;
  capturedAt: number;
  lat: number;
  lon: number;
}

interface Queued extends Omit<CaptureInput, 'uri' | 'thumbUri'> {
  id: string;
  file: string;
  thumb?: string;
  tries: number;
}

const DIR = `${FS.documentDirectory ?? ''}reports/`;
const KEY = 'beacon.reportQueue.v1';

const readQueue = async (): Promise<Queued[]> => {
  try {
    return JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]') as Queued[];
  } catch {
    return [];
  }
};
const writeQueue = (q: Queued[]) => AsyncStorage.setItem(KEY, JSON.stringify(q)).catch(() => {});

async function b64(uri: string) {
  return FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
}

async function upload(q: Queued) {
  const media = await b64(q.file);
  const thumb = q.thumb ? await b64(q.thumb) : undefined;
  const id = await getIdentity();
  const digest = toHex(sha256(fromBase64(media)));
  const proof = toBase64(ed25519.sign(utf8(`${digest}|${q.capturedAt}|${q.lat.toFixed(4)}|${q.lon.toFixed(4)}`), id.signing.secretKey));
  return cloud.post<{ id: string; status: string }>('/v1/reports', { kind: q.kind, mime: q.mime, media, thumb, caption: q.caption, lat: q.lat, lon: q.lon, capturedAt: q.capturedAt, proof });
}

export type SubmitResult = 'sent' | 'queued' | 'rejected';

export async function submitReport(c: CaptureInput): Promise<{ result: SubmitResult; error?: string }> {
  if (Platform.OS === 'web') return { result: 'queued' };
  await FS.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  const id = Math.random().toString(36).slice(2, 10);
  const ext = c.kind === 'video' ? 'mp4' : c.mime === 'image/png' ? 'png' : 'jpg';
  const file = `${DIR}${id}.${ext}`;
  await FS.copyAsync({ from: c.uri, to: file });
  let thumb: string | undefined;
  if (c.thumbUri) {
    thumb = `${DIR}${id}.thumb.jpg`;
    await FS.copyAsync({ from: c.thumbUri, to: thumb });
  }
  const item: Queued = { id, kind: c.kind, mime: c.mime, caption: c.caption, capturedAt: c.capturedAt, lat: c.lat, lon: c.lon, file, thumb, tries: 0 };
  if (cloudConfigured()) {
    try {
      await upload(item);
      await cleanup(item);
      return { result: 'sent' };
    } catch (e) {
      if (e instanceof CloudError && e.status >= 400 && e.status < 500) {
        await cleanup(item);
        return { result: 'rejected', error: e.message };
      }
    }
  }
  const q = await readQueue();
  q.push(item);
  await writeQueue(q);
  return { result: 'queued' };
}

async function cleanup(q: Queued) {
  await FS.deleteAsync(q.file, { idempotent: true }).catch(() => {});
  if (q.thumb) await FS.deleteAsync(q.thumb, { idempotent: true }).catch(() => {});
}

/** Called by the gateway loop: upload anything captured while offline (reports older than 48 h are dropped by the server). */
export async function flushReports(): Promise<number> {
  if (!cloudConfigured()) return 0;
  const q = await readQueue();
  const keep: Queued[] = [];
  let sent = 0;
  for (const item of q) {
    try {
      await upload(item);
      await cleanup(item);
      sent++;
    } catch (e) {
      if (e instanceof CloudError && e.status >= 400 && e.status < 500) await cleanup(item);
      else if (item.tries < 20) keep.push({ ...item, tries: item.tries + 1 });
      else await cleanup(item);
    }
  }
  await writeQueue(keep);
  return sent;
}

export const queuedReports = async () => (await readQueue()).length;

export async function currentPlace() {
  return getFix({ maxWaitMs: 6000 });
}

export const fetchReports = (lat: number, lon: number) => cloud.get<{ reports: ReportView[] }>(`/v1/reports?lat=${lat}&lon=${lon}&radius=50`);

export const vote = (id: string, v: 'real' | 'fake') => cloud.post<unknown>(`/v1/reports/${id}/vote`, { vote: v });
