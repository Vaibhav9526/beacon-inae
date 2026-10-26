import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { create } from 'zustand';
import type { OpaqueNote, RoadEvent, RoadReport, ShakeEvent, ShakeVote } from '../mesh/appTypes';
import { fromBase64 } from '../mesh/bytes';
import { BleTransport } from '../mesh/ble';
import {
  type AlertBody,
  type MeshAlert,
  MeshNode,
  type MsgKind,
  type PeerInfo,
  type PrivateMessage,
  type PublicMessage,
  type SafeMessage,
  type SosMessage,
} from '../mesh/node';
import { reduceRadioState, type MeshStatus } from '../mesh/radioPolicy';
import { MemoryNetwork } from '../mesh/transport';
import { useSettings } from '../state/settings';
import { getIdentity } from './identity';
import { getFix, lastKnownFix } from './location';

let node: MeshNode | null = null;
let transport: BleTransport | null = null;
let startPromise: Promise<void> | null = null;
// kept so stop() (and a panic wipe) can end the periodic work
let snapshotTimer: ReturnType<typeof setInterval> | null = null;
let neighbourTimer: ReturnType<typeof setInterval> | null = null;
let sosStop: (() => void) | null = null;

const SNAPSHOT_KEY = 'beacon.mesh.snapshot.v1';
const MAX = 300;
const cap = <T,>(a: T[]) => (a.length > MAX ? a.slice(a.length - MAX) : a);

export interface MeshState {
  running: boolean;
  /** false in Expo Go / web / emulators without BLE: the UI still works, it just has no radio */
  radioAvailable: boolean;
  status: MeshStatus;
  /** why the radio is not fully working (shown by the Chat tab and /meshtest); null when fine */
  radioError: string | null;
  /** what happened to messages you sent: how many phones were in range at that moment */
  delivery: Record<string, { neighbours: number; at: number }>;
  myId: string;
  neighbours: number;
  peers: PeerInfo[];
  channels: string[];
  chat: PublicMessage[];
  board: PublicMessage[];
  priv: PrivateMessage[];
  sos: SosMessage[];
  safe: SafeMessage[];
  alerts: MeshAlert[];
  roads: RoadEvent[];
  opaque: OpaqueNote[];
  shakes: ShakeEvent[];
  sosActive: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** returns the message id, or null when the mesh is not running */
  sendChat(channel: string, text: string, kind?: MsgKind): string | null;
  sendPrivate(to: string, text: string): void;
  sendSos(note?: string): Promise<string>;
  cancelSos(): void;
  sendSafe(note?: string): Promise<void>;
  relayAlert(alert: AlertBody, sig?: Uint8Array): void;
  refreshChannels(): Promise<void>;
  sendRoad(report: RoadReport): void;
  sendOpaque(tag: string, blobB64: string): void;
  sendShake(vote: ShakeVote): void;
  setPosition(lat: number, lon: number): void;
}

export type MeshPerm = 'nearby' | 'notifications' | 'location';
export type PermResult = 'granted' | 'denied' | 'blocked';
const P = PermissionsAndroid.PERMISSIONS;
const api = () => Number(Platform.Version);

const nearbyList = () => (api() >= 31 ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_ADVERTISE, P.BLUETOOTH_CONNECT] : [P.ACCESS_FINE_LOCATION]);

/** Current state of every permission the mesh cares about. */
export async function meshPermissions(): Promise<Record<MeshPerm, boolean>> {
  if (Platform.OS !== 'android') return { nearby: false, notifications: false, location: false };
  const all = async (l: readonly (typeof P)[keyof typeof P][]) => (await Promise.all(l.map((x) => PermissionsAndroid.check(x)))).every(Boolean);
  return {
    nearby: await all(nearbyList()),
    notifications: api() < 33 ? true : await PermissionsAndroid.check(P.POST_NOTIFICATIONS),
    location: await PermissionsAndroid.check(P.ACCESS_FINE_LOCATION),
  };
}

/** Asks for one group. 'blocked' means Android will not show the dialog again: send the person to Settings. */
export async function requestMeshPermission(kind: MeshPerm): Promise<PermResult> {
  if (Platform.OS !== 'android') return 'denied';
  const list = kind === 'nearby' ? nearbyList() : kind === 'location' ? [P.ACCESS_FINE_LOCATION] : api() >= 33 ? [P.POST_NOTIFICATIONS] : [];
  if (list.length === 0) return 'granted';
  const res = await PermissionsAndroid.requestMultiple(list);
  const vals = list.map((x) => res[x]);
  if (vals.every((v) => v === PermissionsAndroid.RESULTS.GRANTED)) return 'granted';
  return vals.some((v) => v === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) ? 'blocked' : 'denied';
}

/**
 * Android 12+: one "Nearby devices" dialog (scan, advertise, connect) is all the radio needs. Notifications (so the
 * foreground service notice is visible) and location (for geohash channels only) are asked afterwards and never block.
 */
async function ensurePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const nearby = (await meshPermissions()).nearby || (await requestMeshPermission('nearby')) === 'granted';
  if (!nearby) return false;
  const have = await meshPermissions();
  if (!have.notifications) await requestMeshPermission('notifications').catch(() => {});
  if (api() >= 31 && !have.location) await requestMeshPermission('location').catch(() => {});
  return true;
}

export const getBleTransport = () => transport;

export const useMesh = create<MeshState>((set, get) => ({
  running: false,
  radioAvailable: BleTransport.available,
  status: 'idle',
  radioError: null,
  delivery: {},
  myId: '',
  neighbours: 0,
  peers: [],
  channels: [],
  chat: [],
  board: [],
  priv: [],
  sos: [],
  safe: [],
  alerts: [],
  roads: [],
  opaque: [],
  shakes: [],
  sosActive: false,

  start() {
    startPromise ??= (async () => {
      set({ status: 'starting' });
      const identity = await getIdentity();
      const settings = useSettings.getState();
      const trusted = settings.serverKey ? [fromBase64(settings.serverKey)] : [];

      let t: BleTransport | null = null;
      if (BleTransport.available) {
        if (!(await ensurePermissions())) {
          set({ status: 'no-permission', radioError: 'Allow "Nearby devices" for Beacon · Beacon को "आस-पास के डिवाइस" की अनुमति दें' });
          startPromise = null;
          return;
        }
        t = new BleTransport();
        t.onState((st) => {
          const cur = get();
          const v = reduceRadioState({ status: cur.status, error: cur.radioError }, st);
          set({ status: v.status, radioError: v.error });
        });
        t.watch(() => node && set({ neighbours: node.neighbours }));
      }
      transport = t;
      // Without a radio (Expo Go, web, emulator) run the node on an isolated in-memory link so the UI is usable.
      const link = t ?? new MemoryNetwork().create('self');
      node = new MeshNode(identity, link, { nickname: settings.nickname || settings.kidName || 'Beacon user', trustedGateways: trusted });
      const n = node;
      set({ myId: n.id });
      // pending mail, carried envelopes and known peers survive restarts
      try {
        const snap = await AsyncStorage.getItem(SNAPSHOT_KEY);
        if (snap) n.restore(snap);
      } catch {
        /* start fresh */
      }
      const save = () => AsyncStorage.setItem(SNAPSHOT_KEY, n.snapshot()).catch(() => {});
      if (snapshotTimer) clearInterval(snapshotTimer);
      snapshotTimer = setInterval(save, 20_000);
      AppState.addEventListener('change', (st) => st !== 'active' && save());

      n.on('public', (m) => {
        if (m.kind === 'chat') set((s) => ({ chat: cap([...s.chat.filter((x) => x.id !== m.id), m]) }));
        else set((s) => ({ board: cap([...s.board.filter((x) => x.id !== m.id), m]) }));
      });
      n.on('private', (m) => set((s) => ({ priv: cap([...s.priv, m]) })));
      n.on('sos', (m) => set((s) => ({ sos: cap([...s.sos.filter((x) => x.id !== m.id), m]) })));
      n.on('safe', (m) => set((s) => ({ safe: cap([...s.safe, m]) })));
      n.on('alert', (a) => set((s) => ({ alerts: [...s.alerts.filter((x) => x.id !== a.id), a] })));
      n.on('road', (e) => set((s) => ({ roads: [...s.roads.filter((x) => x.report.id !== e.report.id), e].slice(-300) })));
      n.on('opaque', (o) =>
        set((s) => ({ opaque: [...s.opaque.filter((x) => !(x.tag === o.tag && x.blob === o.blob)), o].slice(-500) })),
      );
      n.on('shake', (e) =>
        set((s) => {
          const cutoff = Date.now() - 120_000;
          return { shakes: [...s.shakes.filter((x) => x.receivedAt >= cutoff && x.vote.id !== e.vote.id), e].slice(-100) };
        }),
      );
      // roads and opaque notes restored from the snapshot are held by the node; seed the store with them
      set({ roads: n.roadEvents().slice(0, 300), opaque: n.opaqueNotes().slice(-500) });
      n.on('peers', () => set({ peers: n.peerList(), neighbours: n.neighbours }));

      const fix = (await lastKnownFix()) ?? null;
      if (fix) {
        n.setLocation(fix.lat, fix.lon);
        n.setPosition(fix.lat, fix.lon);
      }
      set({ channels: n.joinedChannels });

      try {
        await n.start();
        set((s) => ({ running: true, status: s.status === 'starting' ? (BleTransport.available ? 'running' : 'unsupported') : s.status }));
      } catch (e) {
        set({ status: 'error', radioError: e instanceof Error ? e.message : 'The mesh could not start' });
        startPromise = null;
      }
      // keep neighbour count fresh (links change without a peer event)
      if (neighbourTimer) clearInterval(neighbourTimer);
      neighbourTimer = setInterval(() => node && set({ neighbours: node.neighbours }), 5000);
    })();
    return startPromise;
  },

  async stop() {
    if (snapshotTimer) clearInterval(snapshotTimer);
    if (neighbourTimer) clearInterval(neighbourTimer);
    snapshotTimer = neighbourTimer = null;
    await node?.stop();
    node = null;
    transport = null;
    startPromise = null;
    set({ running: false, status: 'idle', radioError: null, neighbours: 0, peers: [] });
  },

  sendChat(channel, text, kind = 'chat') {
    if (!node) return null;
    const id = node.sendPublic(channel, text, kind);
    const neighbours = node.neighbours;
    set((s) => {
      const keys = Object.keys(s.delivery);
      const keep = keys.length > 100 ? Object.fromEntries(Object.entries(s.delivery).slice(-80)) : s.delivery;
      return { delivery: { ...keep, [id]: { neighbours, at: Date.now() } } };
    });
    return id;
  },

  sendPrivate(to, text) {
    node?.sendPrivate(to, text);
  },

  async sendSos(note = '') {
    const fix = await getFix({ maxWaitMs: 4000 });
    const s = useSettings.getState();
    const med = [s.medical.bloodGroup && `Blood ${s.medical.bloodGroup}`, s.medical.allergies && `Allergy: ${s.medical.allergies}`, s.medical.conditions].filter(Boolean).join('; ');
    const info = { lat: fix?.lat ?? 0, lon: fix?.lon ?? 0, note: note || 'Need help', medical: med || undefined };
    await get().start();
    sosStop?.();
    sosStop = node?.startSosBeacon(info) ?? null;
    set({ sosActive: true });
    return 'sent';
  },

  cancelSos() {
    sosStop?.();
    sosStop = null;
    set({ sosActive: false });
  },

  async sendSafe(note) {
    const fix = await getFix({ maxWaitMs: 3000 });
    await get().start();
    node?.sendSafe({ lat: fix?.lat, lon: fix?.lon, note, family: useSettings.getState().familyCode });
    get().cancelSos();
  },

  relayAlert(alert, sig) {
    node?.broadcastAlert(alert, sig ?? new Uint8Array(64));
  },

  async refreshChannels() {
    const fix = await getFix({ maxWaitMs: 2000 });
    if (fix && node) {
      node.setLocation(fix.lat, fix.lon);
      node.setPosition(fix.lat, fix.lon);
      set({ channels: node.joinedChannels });
    }
  },

  sendRoad(report) {
    node?.sendRoad(report);
  },

  sendOpaque(tag, blobB64) {
    node?.sendOpaque(tag, blobB64);
  },

  sendShake(vote) {
    node?.sendShake(vote);
  },

  setPosition(lat, lon) {
    node?.setPosition(lat, lon);
  },
}));

export const meshTransportAvailable = () => transport != null;
