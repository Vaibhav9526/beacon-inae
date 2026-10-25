import { useSettings } from '../state/settings';
import { useAlerts } from './alerts';
import { cloud, cloudConfigured } from './cloud';
import { getFix } from './location';
import { useMesh } from './mesh';
import { flushOutbox, sendOrQueue } from './outbox';
import { flushReports } from './reports';

let timer: ReturnType<typeof setInterval> | null = null;
let uploaded = new Set<string>();

/**
 * Any phone with internet is a gateway: it uploads what the mesh heard to the server (so rescuers and
 * families far away see it) and pulls official alerts back down for phones that have no internet.
 */
async function tick() {
  if (!cloudConfigured()) return;
  const mesh = useMesh.getState();
  const fix = await getFix({ maxWaitMs: 2500 });
  const sos = mesh.sos.filter((m) => !uploaded.has(`sos:${m.id}`));
  const safe = mesh.safe.filter((m) => !uploaded.has(`safe:${m.from}:${m.timestamp}`));
  const board = mesh.board.filter((m) => !uploaded.has(`b:${m.id}`));
  if (fix || sos.length || safe.length || board.length) {
    const ok = await sendOrQueue('/v1/gateway/sync', {
      location: fix ? { lat: fix.lat, lon: fix.lon } : undefined,
      sos: sos.map((m) => ({ id: m.id, name: m.name, lat: m.lat, lon: m.lon, note: m.note, medical: m.medical, ts: m.timestamp })),
      safe: safe.map((m) => ({ from: m.from, name: m.name, family: m.family, lat: m.lat, lon: m.lon, note: m.note, ts: m.timestamp })),
      board: board.map((m) => ({ id: m.id, kind: m.kind, text: m.text, nickname: m.nickname, ts: m.timestamp })),
    });
    if (ok) {
      sos.forEach((m) => uploaded.add(`sos:${m.id}`));
      safe.forEach((m) => uploaded.add(`safe:${m.from}:${m.timestamp}`));
      board.forEach((m) => uploaded.add(`b:${m.id}`));
    }
  }
  await flushOutbox();
  await flushReports();
  await useAlerts.getState().refresh();
}

export function startGateway() {
  if (timer) return;
  void tick();
  timer = setInterval(() => void tick().catch(() => {}), 60_000);
}

export function stopGateway() {
  if (timer) clearInterval(timer);
  timer = null;
  uploaded = new Set();
}

// ---------- family ----------

/** A child's phone shares its position with the family code every minute while the app is open. */
let familyTimer: ReturnType<typeof setInterval> | null = null;
export function startFamilyPing() {
  if (familyTimer) return;
  const ping = async () => {
    const s = useSettings.getState();
    if (!cloudConfigured() || s.mode !== 'kid') return;
    const fix = await getFix({ maxWaitMs: 3000 });
    if (!fix) return;
    try {
      await cloud.post('/v1/family/location', { family: s.familyCode, name: s.kidName || 'Child', lat: fix.lat, lon: fix.lon });
    } catch {
      /* will try again in a minute */
    }
  };
  void ping();
  familyTimer = setInterval(() => void ping(), 60_000);
}

export function stopFamilyPing() {
  if (familyTimer) clearInterval(familyTimer);
  familyTimer = null;
}

export interface FamilyView {
  members: { name: string; lat: number; lon: number; ts: number; zone: string | null }[];
  zones: { id: string; name: string; lat: number; lon: number; radius: number }[];
  safe: { name: string; lat?: number; lon?: number; note?: string; ts: number; kind: 'safe' | 'sos' }[];
}

export const fetchFamily = (code: string) => cloud.get<FamilyView>(`/v1/family/${encodeURIComponent(code)}`);

export const pushZones = (code: string, zones: { id: string; name: string; lat: number; lon: number; radius: number }[]) =>
  cloud.post('/v1/family/zones', { family: code, zones });
