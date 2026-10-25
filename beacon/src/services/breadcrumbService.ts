// Leaves encrypted "last seen here" notes on the mesh, and reads the ones family members left.
// Mount: call startBreadcrumbs() once at app start (it is cheap and does nothing until a key is set and the person opts in).
import { useEffect, useMemo, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { Breadcrumb, OpaqueNote } from '../mesh/appTypes';
import { useSettings } from '../state/settings';
import { loadFamilyKey, useFamilyKey } from '../state/familyKey';
import { acceptedTags, latestPerPerson, openCrumb, sealCrumb } from './breadcrumbs';
import { getFix, lastKnownFix } from './location';
import { useMesh } from './mesh';

const BASE_MS = 10 * 60_000;
const MIN_GAP_MS = 60_000;
const LOW_BATTERY = 0.15;

let timer: ReturnType<typeof setInterval> | null = null;
let appSub: { remove(): void } | null = null;
let lastSent = 0;
let busy = false;

export const myName = () => {
  const s = useSettings.getState();
  return s.nickname || s.kidName || 'Beacon user';
};

function intervalMs(): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const f = (require('./lifeboat') as { lifeboatFactor?: () => number }).lifeboatFactor?.() ?? 1;
    return f > 1 ? 3 * BASE_MS : BASE_MS;
  } catch {
    return BASE_MS;
  }
}

/** Battery level 0-100 when expo-battery happens to be installed; otherwise undefined. */
async function readBattery(): Promise<number | undefined> {
  try {
    const name = 'expo-battery';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const B = require(name) as { getBatteryLevelAsync?: () => Promise<number> };
    const lvl = await B.getBatteryLevelAsync?.();
    return typeof lvl === 'number' && lvl >= 0 ? Math.round(lvl * 100) : undefined;
  } catch {
    return undefined;
  }
}

/** Seal and send one note now. Returns true when something was sent. */
export async function leaveBreadcrumbNow(note?: string): Promise<boolean> {
  if (busy) return false;
  const { key, breadcrumbsOn } = useFamilyKey.getState();
  if (!key || !breadcrumbsOn) return false;
  const mesh = useMesh.getState();
  if (!mesh.running) return false;
  busy = true;
  try {
    // never wait long for GPS: a stale fix is better than no note
    const fix = (await lastKnownFix()) ?? (await getFix({ maxWaitMs: 4000 }));
    if (!fix) return false;
    const now = Date.now();
    const batt = await readBattery();
    const crumb: Breadcrumb = { who: myName(), lat: fix.lat, lon: fix.lon, at: Math.min(now, fix.ts || now), ...(note ? { note } : {}) };
    if (fix.accuracy != null) crumb.acc = fix.accuracy;
    if (batt != null) crumb.batt = batt;
    // the note says when the fix was taken; a stale fix honestly shows as older
    const sealed = sealCrumb(crumb, key, now);
    mesh.sendOpaque(sealed.tag, sealed.blobB64);
    lastSent = now;
    return true;
  } catch {
    return false;
  } finally {
    busy = false;
  }
}

async function tick() {
  const now = Date.now();
  if (now - lastSent < MIN_GAP_MS) return;
  const due = now - lastSent >= intervalMs();
  const low = !due && now - lastSent >= 5 * 60_000 ? ((await readBattery()) ?? 100) / 100 < LOW_BATTERY : false;
  if (due || low) await leaveBreadcrumbNow();
}

export function startBreadcrumbs(): void {
  if (timer) return;
  void loadFamilyKey();
  timer = setInterval(() => void tick(), 60_000);
  void tick();
  appSub = AppState.addEventListener('change', (st: AppStateStatus) => {
    if (st !== 'active' && Date.now() - lastSent >= MIN_GAP_MS) void leaveBreadcrumbNow();
  });
}

export function stopBreadcrumbs(): void {
  if (timer) clearInterval(timer);
  timer = null;
  appSub?.remove();
  appSub = null;
}

export interface FamilyCrumb {
  who: string;
  crumb: Breadcrumb;
  ageMs: number;
}

// blob -> opened crumb, per key, so a 500-note list is not decrypted again on every render
let cacheKey: Uint8Array | null = null;
const opened = new Map<string, Breadcrumb | null>();

/** Family notes from the mesh list, newest first, without the user's own. Pure so it can be tested. */
export function familyCrumbs(notes: OpaqueNote[], key: Uint8Array, me: string, myId: string, now: number): FamilyCrumb[] {
  if (cacheKey !== key) {
    cacheKey = key;
    opened.clear();
  }
  const tags = acceptedTags(key, now, 2); // notes live 48 h on the mesh
  const crumbs: Breadcrumb[] = [];
  for (const n of notes) {
    if (!tags.has(n.tag) || (myId && n.from === myId)) continue;
    let c = opened.get(n.blob);
    if (c === undefined) {
      c = openCrumb(n, key, now);
      if (opened.size > 1000) opened.clear();
      opened.set(n.blob, c);
    }
    if (c && c.who !== me) crumbs.push(c);
  }
  return latestPerPerson(crumbs)
    .map((crumb) => ({ who: crumb.who, crumb, ageMs: Math.max(0, now - crumb.at) }))
    .sort((a, b) => a.ageMs - b.ageMs);
}

export function useFamilyCrumbs(): FamilyCrumb[] {
  const opaque = useMesh((s) => s.opaque);
  const myId = useMesh((s) => s.myId);
  const key = useFamilyKey((s) => s.key);
  const nickname = useSettings((s) => s.nickname);
  const kidName = useSettings((s) => s.kidName);
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    void loadFamilyKey();
    const t = setInterval(() => setMinute(Math.floor(Date.now() / 60_000)), 60_000);
    return () => clearInterval(t);
  }, []);
  return useMemo(
    () => (key ? familyCrumbs(opaque, key, nickname || kidName || 'Beacon user', myId, minute * 60_000) : []),
    [opaque, key, nickname, kidName, myId, minute],
  );
}
