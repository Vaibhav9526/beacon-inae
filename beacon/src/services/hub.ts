import { pollMs } from './lifeboat';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { fromBase64, fromUtf8, toBase64, toHex, utf8 } from '../mesh/bytes';
import { useSettings } from '../state/settings';
import { CloudError } from './cloud';
import { getIdentity } from './identity';
import { registerPush } from './alerts';
import { scheduleNotice } from './notificationRouting';
import { useHubFeed, type HubFeedData } from './hubFeed';
import { decodeWire, encodeWire, parseGroupKey, type FeedItem, type WireMessage } from './wire';

/** What the hub prints in its pairing QR code. v1 has no group key; v2 carries `gk`. Anything else is ignored. */
export interface HubPairing {
  v: 1 | 2;
  hub: string;
  key: string;
  token: string;
  relay: string;
  /** base64 32-byte group key (v2) */
  gk?: string;
  /** ties this phone to a member the adult created */
  invite?: string;
}

export type Severity = 'info' | 'watch' | 'warning' | 'severe';

export interface HubMessage {
  id: string;
  text: string;
  severity: Severity;
  at: number;
}

export interface PairedHub {
  hubId: string;
  hubPubKey: string;
  relay: string;
  pairedAt: number;
  /** base64 group key from the v2 QR. Without it the hub's encrypted messages cannot be read. */
  gk?: string;
  invite?: string;
}

interface HubState {
  hydrated: boolean;
  paired: PairedHub | null;
  /** Newest last, at most 50. */
  messages: HubMessage[];
  /** ms timestamp of the newest inbox item we have seen. */
  lastSince: number;
  /** ms timestamp of the last inbox poll that reached the relay. */
  lastSyncAt: number;
  set: (p: Partial<HubState>) => void;
}

const MAX_MESSAGES = 50;
const POLL_MS = 45_000;
const SEVERITIES: Severity[] = ['info', 'watch', 'warning', 'severe'];
const FEED_KEY = 'beacon.hubFeed.v1';

export const useHub = create<HubState>()(
  persist(
    (set) => ({
      hydrated: false,
      paired: null,
      messages: [],
      lastSince: 0,
      lastSyncAt: 0,
      set: (p) => set(p),
    }),
    {
      name: 'beacon.hub.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ paired: s.paired, messages: s.messages, lastSince: s.lastSince, lastSyncAt: s.lastSyncAt }),
      onRehydrateStorage: () => (state) => {
        state?.set({ hydrated: true });
      },
    },
  ),
);

/** Parses the pairing payload from the QR code or a pasted string. Returns null for anything that is not ours. */
export function parsePairing(raw: string): HubPairing | null {
  let j: unknown;
  try {
    j = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object') return null;
  const o = j as Record<string, unknown>;
  if (o.v !== 1 && o.v !== 2) return null;
  for (const k of ['hub', 'key', 'token', 'relay']) if (typeof o[k] !== 'string' || !o[k]) return null;
  let gk: string | undefined;
  if (o.v === 2) {
    if (typeof o.gk !== 'string' || !parseGroupKey(o.gk)) return null;
    gk = o.gk;
  }
  const invite = typeof o.invite === 'string' && o.invite ? o.invite : undefined;
  return { v: o.v, hub: o.hub as string, key: o.key as string, token: o.token as string, relay: o.relay as string, gk, invite };
}

/** Decodes a push item's blob: base64 of JSON {text, severity}. */
export function decodePushBlob(blob: string): { text: string; severity: Severity } | null {
  try {
    const j = JSON.parse(fromUtf8(fromBase64(blob))) as { text?: unknown; severity?: unknown };
    if (typeof j.text !== 'string' || !j.text) return null;
    const severity = SEVERITIES.includes(j.severity as Severity) ? (j.severity as Severity) : 'info';
    return { text: j.text, severity };
  } catch {
    return null;
  }
}

/**
 * Signed request to an explicit base URL. Same scheme as cloud.ts: the signature covers
 * `${ts}.${method}.${path without query}.${sha256(body)}`, signed with the device identity key.
 */
export async function hubRequest<T>(base: string, method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 12_000): Promise<T> {
  const url = base.replace(/\/+$/, '');
  if (!url) throw new CloudError(0, 'no relay configured');
  const raw = body === undefined ? '' : JSON.stringify(body);
  const headers: Record<string, string> = {};
  if (raw) headers['content-type'] = 'application/json';
  const id = await getIdentity();
  const ts = String(Date.now());
  const pathOnly = path.split('?')[0]!;
  const msg = utf8(`${ts}.${method}.${pathOnly}.${toHex(sha256(utf8(raw)))}`);
  headers['x-device'] = toBase64(id.signing.publicKey);
  headers['x-ts'] = ts;
  headers['x-sig'] = toBase64(ed25519.sign(msg, id.signing.secretKey));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url + path, { method, headers, body: raw || undefined, signal: ctl.signal });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok) throw new CloudError(res.status, (json as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
    return json as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Encrypts a WireMessage with the hub's group key and posts it to the hub's mailbox, then polls for replies. */
export async function sendToHub(msg: WireMessage): Promise<void> {
  const { paired } = useHub.getState();
  if (!paired) throw new CloudError(0, 'not paired');
  const gk = paired.gk ? parseGroupKey(paired.gk) : null;
  if (!gk) throw new CloudError(0, 'pair again to get the hub key');
  const blob = encodeWire(msg, gk);
  await hubRequest(paired.relay, 'POST', '/v1/mail/send', { to: `hub:${paired.hubId}`, blob });
  void pollHubInbox();
}

/** Links this phone to the hub named in the QR code. Sends a hello so the hub can add this phone to the family. */
export async function pairWithHub(p: HubPairing): Promise<PairedHub> {
  // The relay reads the phone's push token from the devices table when pairing, so make sure it is there first.
  await registerPush();
  const res = await hubRequest<{ ok: boolean; hubId: string; hubPubKey: string }>(p.relay, 'POST', '/v1/hub/pair', { hubId: p.hub, pairToken: p.token });
  const paired: PairedHub = { hubId: res.hubId, hubPubKey: res.hubPubKey, relay: p.relay.replace(/\/+$/, ''), pairedAt: Date.now(), gk: p.gk, invite: p.invite };
  // Only alerts from now on: nothing sent before pairing should notify. A new hub starts with an empty feed.
  useHub.getState().set({ paired, messages: [], lastSince: paired.pairedAt, lastSyncAt: 0 });
  useHubFeed.getState().reset();
  const s = useSettings.getState();
  try {
    await sendToHub({ t: 'hello', name: s.nickname || s.kidName || 'Phone', invite: paired.invite });
  } catch {
    /* the hub gets the hello on the next try; pairing itself succeeded */
  }
  return paired;
}

/** Forgets the hub on this phone. The hub keeps the link until it is removed on its side. */
export function unpairHub() {
  useHub.getState().set({ paired: null, messages: [], lastSince: 0, lastSyncAt: 0 });
  useHubFeed.getState().reset();
}

/** Maps a pairing failure to a short line for the person. */
export function pairErrorText(e: unknown): string {
  const status = e instanceof CloudError ? e.status : 0;
  if (status === 404) return 'That code is not known. Make a new one on the hub.';
  if (status === 409) return 'That code was already used. Make a new one on the hub.';
  if (status === 410) return 'That code has expired. Make a new one on the hub.';
  return 'Could not reach the hub right now. Try again when you are online.';
}

/** Local notifications for hub push messages. Each one is wrapped as a feed item so the same wording rules apply. */
async function notifyNew(items: HubMessage[]) {
  const lang = useSettings.getState().lang;
  for (const m of items) {
    const item: FeedItem = { id: m.id, agentId: 'hub', agentName: 'Hub', kind: 'custom', title: m.text, body: m.text, severity: m.severity, at: m.at, tags: [] };
    await scheduleNotice({ kind: 'feed', item }, lang);
  }
}

/** Local notifications for feed items the hub tagged 'notify'. Each id notifies once (see scheduleNotice). */
async function notifyFeed(items: FeedItem[]) {
  const lang = useSettings.getState().lang;
  for (const it of items) await scheduleNotice({ kind: 'feed', item: it }, lang);
}

/** Loads the saved feed once, then saves every change. Runs before the first poll so a poll never overwrites saved data. */
let feedReady: Promise<void> | null = null;
function ensureFeed(): Promise<void> {
  if (!feedReady) {
    feedReady = (async () => {
      try {
        const raw = await AsyncStorage.getItem(FEED_KEY);
        if (raw) useHubFeed.getState().hydrate(JSON.parse(raw) as Partial<HubFeedData>);
      } catch {
        /* unreadable saved feed: start empty */
      }
      useHubFeed.subscribe((s) => {
        const data: HubFeedData = { items: s.items, members: s.members, you: s.you, messages: s.messages, asks: s.asks, notified: s.notified };
        AsyncStorage.setItem(FEED_KEY, JSON.stringify(data)).catch(() => {});
      });
    })();
  }
  return feedReady;
}

interface InboxItem {
  id: string;
  from: string;
  kind: string;
  blob: string;
  at: number;
}

/** One poll of the relay inbox. Failures are swallowed on purpose: the next poll tries again. */
export async function pollHubInbox() {
  const { paired, lastSince } = useHub.getState();
  if (!paired) return;
  try {
    await ensureFeed();
    const items = await hubRequest<InboxItem[]>(paired.relay, 'GET', `/v1/mail/inbox?since=${lastSince}`);
    if (!Array.isArray(items)) return;
    const gk = paired.gk ? parseGroupKey(paired.gk) : null;
    const fresh: HubMessage[] = [];
    const feedNotify: FeedItem[] = [];
    for (const it of items) {
      if (it.kind === 'push') {
        const d = decodePushBlob(it.blob);
        if (d) fresh.push({ id: it.id, text: d.text, severity: d.severity, at: it.at });
      } else if (it.kind === 'msg' && gk && it.from === `hub:${paired.hubId}`) {
        const msg = decodeWire(it.blob, gk);
        if (msg) feedNotify.push(...useHubFeed.getState().ingest(msg));
      }
    }
    const latest = items.length ? Math.max(lastSince, ...items.map((i) => i.at)) : lastSince;
    const state = useHub.getState();
    const known = new Set(state.messages.map((m) => m.id));
    const news = fresh.filter((m) => !known.has(m.id));
    const messages = [...state.messages, ...news].slice(-MAX_MESSAGES);
    useHub.getState().set({ messages, lastSince: latest, lastSyncAt: Date.now() });
    void notifyNew(news);
    void notifyFeed(feedNotify);
  } catch {
    /* offline or hub unreachable: fail silently */
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let subscribed = false;

function startTimer() {
  if (timer) return;
  void pollHubInbox();
  timer = setInterval(() => void pollHubInbox(), pollMs(POLL_MS));
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Polls the hub inbox now and every 45 s while the app is in the foreground. Safe to call more than once. */
export function startHubInbox() {
  if (!subscribed) {
    subscribed = true;
    AppState.addEventListener('change', (s) => {
      if (s === 'active') startTimer();
      else stopTimer();
    });
  }
  if (AppState.currentState === 'active') startTimer();
}
