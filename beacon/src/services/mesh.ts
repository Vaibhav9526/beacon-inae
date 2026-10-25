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
  status: 'idle' | 'starting' | 'running' | 'no-permission' | 'bluetooth-off' | 'unsupported' | 'error';
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
  sendChat(channel: string, text: string, kind?: MsgKind): void;
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

async function ensurePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const api = Number(Platform.Version);
  const wanted =
    api >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT, PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const res = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every((p) => res[p] === PermissionsAndroid.RESULTS.GRANTED);
}

export const useMesh = create<MeshState>((set, get) => ({
  running: false,
  radioAvailable: BleTransport.available,
  status: 'idle',
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
          set({ status: 'no-permission' });
          startPromise = null;
          return;
        }
        t = new BleTransport();
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
        set({ running: true, status: BleTransport.available ? 'running' : 'unsupported' });
      } catch {
        set({ status: 'error' });
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
    startPromise = null;
    set({ running: false, status: 'idle' });
  },

  sendChat(channel, text, kind = 'chat') {
    node?.sendPublic(channel, text, kind);
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
