import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519, ed25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { concat, equal, fromBase64, jsonBytes, parseJson, toBase64, toHex, utf8, fromHex } from './bytes';
import { buildGcs, decodeGcs, gcsHas } from './gcs';
import { channelsAt } from './geohash';
import { type Identity, newEphemeral, peerIdFromStatic } from './identity';
import { NoiseSession, pad, unpad } from './noise';
import {
  ORIGIN_TTL,
  type Packet,
  PacketType,
  VERSION,
  decode,
  encode,
  fragment,
  packetKey,
  parseFragment,
  sign,
  verify,
} from './packet';
import type { Transport } from './transport';

// ---------- public data shapes ----------

export type MsgKind = 'chat' | 'help' | 'need' | 'offer';

export interface PublicMessage {
  id: string;
  channel: string;
  from: string; // peer id hex
  nickname: string;
  text: string;
  kind: MsgKind;
  timestamp: number;
  verified: boolean;
  hops: number;
}
export interface PrivateMessage {
  id: string;
  from: string;
  nickname: string;
  text: string;
  timestamp: number;
  viaCourier: boolean;
}
export interface SosMessage {
  id: string;
  from: string;
  name: string;
  lat: number;
  lon: number;
  note: string;
  medical?: string;
  timestamp: number;
  verified: boolean;
  hops: number;
}
export interface SafeMessage {
  from: string;
  name: string;
  lat?: number;
  lon?: number;
  note?: string;
  family?: string; // family code, so only relatives need to care
  timestamp: number;
  verified: boolean;
}
export interface AlertBody {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'watch' | 'warning' | 'severe';
  source: string;
  lat?: number;
  lon?: number;
  radiusKm?: number;
  expires?: number;
}
export interface MeshAlert extends AlertBody {
  verified: boolean; // signed by a trusted gateway key
}
export interface PeerInfo {
  id: string;
  nickname: string;
  noiseKey: Uint8Array;
  signKey: Uint8Array;
  lastSeen: number;
  direct: boolean;
  link?: string;
}

export interface MeshEvents {
  public: (m: PublicMessage) => void;
  private: (m: PrivateMessage) => void;
  sos: (m: SosMessage) => void;
  safe: (m: SafeMessage) => void;
  alert: (a: MeshAlert) => void;
  peers: () => void;
  delivered: (id: string) => void;
}

export interface Scheduler {
  now(): number;
  after(ms: number, fn: () => void): () => void;
  every(ms: number, fn: () => void): () => void;
}

export const realScheduler: Scheduler = {
  now: () => Date.now(),
  after: (ms, fn) => {
    const h = setTimeout(fn, ms);
    return () => clearTimeout(h);
  },
  every: (ms, fn) => {
    const h = setInterval(fn, ms);
    return () => clearInterval(h);
  },
};

export interface MeshOptions {
  nickname: string;
  scheduler?: Scheduler;
  rand?: () => number;
  /** Ed25519 public keys of gateways whose alerts we trust (the cloud server's key). */
  trustedGateways?: Uint8Array[];
}

// ---------- tunables (numbers follow the bitchat whitepaper where it gives them) ----------

const DEDUP_MAX = 1000;
const DEDUP_TTL_MS = 5 * 60_000;
const DENSE_LINKS = 6;
const DENSE_TTL_CAP = 5;
const ANNOUNCE_ISOLATED_MS = 4_000;
const ANNOUNCE_CONNECTED_MS = 20_000;
const SYNC_MS = 15_000;
const SYNC_RETENTION_MS = 6 * 3600_000;
const SYNC_CACHE_MAX = 1000;
const SYNC_REPLY_MAX = 25;
const FRAGMENT_THRESHOLD = 512;
const FRAGMENT_TIMEOUT_MS = 30_000;
const FRAGMENT_MAX_ASSEMBLIES = 128;
const PEER_FRESH_MS = 60_000;
const OUTBOX_PER_PEER = 100;
const OUTBOX_TTL_MS = 24 * 3600_000;
const OUTBOX_RETRIES = 8;
const COURIER_MAX = 200;
const COURIER_TTL_MS = 24 * 3600_000;
const COURIER_MAX_BYTES = 16 * 1024;

const PRIORITY_TYPES = new Set<PacketType>([
  PacketType.Sos,
  PacketType.Safe,
  PacketType.Alert,
  PacketType.Courier,
  PacketType.NoiseHandshake,
  PacketType.NoiseEncrypted,
  PacketType.Fragment,
  PacketType.SyncRequest,
  PacketType.Announce,
]);
const CACHED_TYPES = new Set<PacketType>([
  PacketType.Public,
  PacketType.Board,
  PacketType.Sos,
  PacketType.Safe,
  PacketType.Alert,
]);
const TYPE_RANK: Partial<Record<PacketType, number>> = {
  [PacketType.Sos]: 0,
  [PacketType.Alert]: 1,
  [PacketType.Safe]: 2,
  [PacketType.Public]: 3,
  [PacketType.Board]: 3,
};

interface OutboxItem {
  id: string;
  to: string;
  text: string;
  created: number;
  attempts: number;
  lastAttempt: number;
  courierSent: number;
}

interface CourierEntry {
  tag: string;
  raw: Uint8Array;
  expires: number;
}

type Listener<K extends keyof MeshEvents> = MeshEvents[K];

export class MeshNode {
  readonly id: string;
  private sched: Scheduler;
  private rand: () => number;
  private listeners: { [K in keyof MeshEvents]?: Listener<K>[] } = {};
  private seen = new Map<string, number>();
  private pending = new Map<string, () => void>();
  private peers = new Map<string, PeerInfo>();
  private sessions = new Map<string, NoiseSession>();
  private outbox = new Map<string, OutboxItem[]>();
  private couriers = new Map<string, CourierEntry>();
  private cache = new Map<string, { raw: Uint8Array; ts: number; type: PacketType }>();
  private assemblies = new Map<string, { parts: Map<number, Uint8Array>; total: number; started: number }>();
  private linkPeer = new Map<string, string>(); // link -> peer id hex of a direct neighbour
  private lastTs = 0;
  private deliveredIds = new Set<string>();
  private stops: (() => void)[] = [];
  private channels = new Set<string>();
  private sosRepeat: (() => void) | null = null;
  readonly stats = { relayed: 0, received: 0, duplicates: 0 };

  constructor(
    private identity: Identity,
    private transport: Transport,
    private opts: MeshOptions,
  ) {
    this.id = toHex(identity.peerId);
    this.sched = opts.scheduler ?? realScheduler;
    this.rand = opts.rand ?? Math.random;
    transport.onPacket((link, data) => this.onRaw(link, data));
    transport.onLink((link, up) => this.onLink(link, up));
  }

  // ---------- lifecycle ----------

  async start() {
    await this.transport.start();
    this.announce();
    const scheduleAnnounce = () => {
      const interval = this.transport.links().length === 0 ? ANNOUNCE_ISOLATED_MS : ANNOUNCE_CONNECTED_MS * (0.75 + this.rand() / 2);
      this.stops.push(
        this.sched.after(interval, () => {
          this.announce();
          scheduleAnnounce();
        }),
      );
    };
    scheduleAnnounce();
    this.stops.push(this.sched.every(SYNC_MS, () => this.syncTick()));
    this.stops.push(this.sched.every(10_000, () => this.housekeeping()));
  }

  async stop() {
    this.stops.forEach((s) => s());
    this.stops = [];
    this.sosRepeat?.();
    for (const cancel of this.pending.values()) cancel();
    this.pending.clear();
    await this.transport.stop();
  }

  on<K extends keyof MeshEvents>(ev: K, fn: MeshEvents[K]) {
    (this.listeners[ev] ??= [] as never).push(fn as never);
    return () => {
      const arr = this.listeners[ev] as unknown[];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  private emit<K extends keyof MeshEvents>(ev: K, ...args: Parameters<MeshEvents[K]>) {
    for (const fn of (this.listeners[ev] ?? []) as ((...a: unknown[]) => void)[]) {
      try {
        fn(...args);
      } catch {
        /* a bad listener must not break the radio loop */
      }
    }
  }

  // ---------- public API ----------

  setNickname(n: string) {
    this.opts.nickname = n;
    this.announce();
  }

  /** Join the geohash channels for a position (block ... region). Call again when the phone moves. */
  setLocation(lat: number, lon: number) {
    this.channels = new Set(channelsAt(lat, lon));
  }

  get joinedChannels() {
    return [...this.channels];
  }

  get neighbours() {
    return this.transport.links().length;
  }

  peerList(): PeerInfo[] {
    return [...this.peers.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  }

  sendPublic(channel: string, text: string, kind: MsgKind = 'chat') {
    const p = this.build(PacketType.Public, jsonBytes({ ch: channel, n: this.opts.nickname, t: text, k: kind }));
    return this.originate(p);
  }

  sendSos(info: { lat: number; lon: number; note: string; medical?: string }) {
    const id = toHex(randomBytes(4));
    const p = this.build(
      PacketType.Sos,
      jsonBytes({ id, n: this.opts.nickname, la: info.lat, lo: info.lon, t: info.note, m: info.medical }),
    );
    this.originate(p);
    return id;
  }

  /** Re-broadcast an SOS every 30 s so late arrivals and fresh links still hear it. */
  startSosBeacon(info: { lat: number; lon: number; note: string; medical?: string }) {
    this.sosRepeat?.();
    this.sendSos(info);
    this.sosRepeat = this.sched.every(30_000, () => this.sendSos(info));
    return () => {
      this.sosRepeat?.();
      this.sosRepeat = null;
    };
  }

  sendSafe(info: { lat?: number; lon?: number; note?: string; family?: string } = {}) {
    const p = this.build(PacketType.Safe, jsonBytes({ n: this.opts.nickname, la: info.lat, lo: info.lon, t: info.note, f: info.family }));
    return this.originate(p);
  }

  /** Gateway: push a server-signed alert into the mesh. `sig` is the server's Ed25519 signature over JSON.stringify(alert). */
  broadcastAlert(alert: AlertBody, sig: Uint8Array) {
    const p = this.build(PacketType.Alert, jsonBytes({ a: alert, s: toBase64(sig) }));
    return this.originate(p);
  }

  /** Queue a private message. Delivered over a live Noise session, or sealed to the recipient via couriers. */
  sendPrivate(to: string, text: string): string {
    const id = toHex(randomBytes(6));
    const q = this.outbox.get(to) ?? [];
    if (q.length >= OUTBOX_PER_PEER) q.shift();
    q.push({ id, to, text, created: this.sched.now(), attempts: 0, lastAttempt: 0, courierSent: 0 });
    this.outbox.set(to, q);
    this.deliverOutbox(to);
    return id;
  }

  // ---------- building and sending ----------

  private nextTs() {
    this.lastTs = Math.max(this.sched.now(), this.lastTs + 1);
    return this.lastTs;
  }

  private build(type: PacketType, payload: Uint8Array, recipient?: Uint8Array, signed = true): Packet {
    const p: Packet = {
      version: VERSION,
      type,
      ttl: ORIGIN_TTL,
      timestamp: this.nextTs(),
      sender: this.identity.peerId,
      recipient,
      payload,
    };
    return signed ? sign(p, this.identity.signing.secretKey) : p;
  }

  private originate(p: Packet) {
    const raw = encode(p);
    this.markSeen(packetKey(p));
    if (CACHED_TYPES.has(p.type)) this.remember(p, raw);
    this.emitLocal(p, true);
    this.transmit(p, raw);
    return toHex(p.sender) + ':' + p.timestamp;
  }

  private transmit(p: Packet, raw: Uint8Array, except?: string) {
    if (raw.length > FRAGMENT_THRESHOLD && p.type !== PacketType.Fragment) {
      for (const f of fragment(raw, p, randomBytes(8))) {
        this.transport.broadcast(encode(f), except);
      }
      return;
    }
    this.transport.broadcast(raw, except);
  }

  private sendDirected(p: Packet) {
    const raw = encode(p);
    this.markSeen(packetKey(p));
    const rid = p.recipient ? toHex(p.recipient) : '';
    const link = this.directLink(rid);
    if (link) {
      if (raw.length > FRAGMENT_THRESHOLD) {
        for (const f of fragment(raw, p, randomBytes(8))) this.transport.send(link, encode(f));
      } else this.transport.send(link, raw);
    } else this.transmit(p, raw);
  }

  private directLink(peerHex: string): string | undefined {
    const peer = this.peers.get(peerHex);
    if (peer?.direct && peer.link && this.transport.links().includes(peer.link)) return peer.link;
    return undefined;
  }

  // ---------- link events ----------

  private onLink(link: string, up: boolean) {
    if (up) {
      // greet the new neighbour immediately so it learns who we are
      this.announce(link);
      this.syncWith(link);
    } else {
      const pid = this.linkPeer.get(link);
      this.linkPeer.delete(link);
      if (pid) {
        const peer = this.peers.get(pid);
        if (peer) peer.direct = false;
        this.emit('peers');
      }
    }
  }

  // ---------- announce ----------

  announce(onlyLink?: string) {
    const neighbours = [...this.linkPeer.values()].slice(0, 10);
    const payload = jsonBytes({
      n: this.opts.nickname,
      ns: toBase64(this.identity.noise.publicKey),
      sg: toBase64(this.identity.signing.publicKey),
      nb: neighbours,
    });
    const p = this.build(PacketType.Announce, payload);
    const raw = encode(p);
    this.markSeen(packetKey(p));
    if (onlyLink) this.transport.send(onlyLink, raw);
    else this.transport.broadcast(raw);
  }

  private handleAnnounce(p: Packet, link: string | null) {
    let body: { n: string; ns: string; sg: string };
    try {
      body = parseJson(p.payload);
    } catch {
      return;
    }
    const noiseKey = fromBase64(body.ns);
    const signKey = fromBase64(body.sg);
    // self-certifying: the sender id must be derived from the claimed static key, and the packet signed by the claimed signing key
    if (!equal(peerIdFromStatic(noiseKey), p.sender) || !verify(p, signKey)) return;
    const id = toHex(p.sender);
    if (id === this.id) return;
    const direct = p.ttl === ORIGIN_TTL && link != null;
    const existing = this.peers.get(id);
    const info: PeerInfo = {
      id,
      nickname: String(body.n ?? '').slice(0, 32),
      noiseKey,
      signKey,
      lastSeen: this.sched.now(),
      direct: direct || (existing?.direct && existing.link ? this.transport.links().includes(existing.link) : false),
      link: direct ? link! : existing?.link,
    };
    this.peers.set(id, info);
    if (direct && link) this.linkPeer.set(link, id);
    this.emit('peers');
    // a peer just became reachable: push anything we were holding for them
    this.deliverOutbox(id);
    this.handoverCouriers(info);
  }

  // ---------- receive ----------

  private onRaw(link: string, data: Uint8Array) {
    const p = decode(data);
    if (!p) return;
    this.handlePacket(p, data, link, false);
  }

  private handlePacket(p: Packet, raw: Uint8Array, link: string | null, fromFragment: boolean) {
    if (equal(p.sender, this.identity.peerId)) return;
    // reject timestamps far in the future (clock abuse); the past is fine for store-and-forward
    if (p.timestamp > this.sched.now() + 10 * 60_000) return;
    const key = packetKey(p);
    this.pruneSeen();
    if (this.seen.has(key)) {
      this.stats.duplicates++;
      // someone else already relayed it: cancel our pending relay
      const cancel = this.pending.get(key);
      if (cancel) {
        cancel();
        this.pending.delete(key);
      }
      return;
    }
    this.markSeen(key);
    this.stats.received++;

    const mine = !p.recipient || equal(p.recipient, this.identity.peerId);
    if (p.type === PacketType.Fragment) {
      this.handleFragment(p, link); // reassembly dispatches the inner packet; the fragment itself still relays
    } else if (mine) {
      this.dispatch(p, raw, link);
    }
    if (!fromFragment && p.type !== PacketType.SyncRequest) this.maybeRelay(p, raw, link, mine);
  }

  private dispatch(p: Packet, raw: Uint8Array, link: string | null) {
    switch (p.type) {
      case PacketType.Announce:
        this.handleAnnounce(p, link);
        break;
      case PacketType.Public:
      case PacketType.Board:
      case PacketType.Sos:
      case PacketType.Safe:
      case PacketType.Alert:
        if (CACHED_TYPES.has(p.type)) this.remember(p, raw);
        this.emitLocal(p, false);
        break;
      case PacketType.NoiseHandshake:
        this.handleHandshake(p);
        break;
      case PacketType.NoiseEncrypted:
        this.handleEncrypted(p);
        break;
      case PacketType.Courier:
        this.handleCourier(p, raw);
        break;
      case PacketType.SyncRequest:
        if (link) this.handleSync(p, link);
        break;
    }
  }

  private handleFragment(p: Packet, link: string | null) {
    const f = parseFragment(p);
    if (!f || f.total === 0 || f.total > 4000 || f.index >= f.total) return;
    let a = this.assemblies.get(f.id);
    if (!a) {
      if (this.assemblies.size >= FRAGMENT_MAX_ASSEMBLIES) return;
      a = { parts: new Map(), total: f.total, started: this.sched.now() };
      this.assemblies.set(f.id, a);
    }
    a.parts.set(f.index, f.chunk);
    if (a.parts.size === a.total) {
      this.assemblies.delete(f.id);
      const raw = concat(...Array.from({ length: a.total }, (_, i) => a.parts.get(i)!));
      if (raw.length > 1024 * 1024) return;
      const inner = decode(raw);
      if (inner) this.handlePacket(inner, raw, link, true);
    }
  }

  // ---------- relay ----------

  private maybeRelay(p: Packet, raw: Uint8Array, ingress: string | null, mine: boolean) {
    // directed packets addressed to us end here
    if (p.recipient && mine) return;
    if (p.ttl <= 1) return;
    const dense = this.transport.links().length >= DENSE_LINKS;
    let ttl = p.ttl - 1;
    const priority = PRIORITY_TYPES.has(p.type);
    if (dense && !priority) ttl = Math.min(ttl, DENSE_TTL_CAP);
    if (dense && p.type === PacketType.Announce) ttl = Math.min(ttl, DENSE_TTL_CAP);
    const relayed: Packet = { ...p, ttl };
    const relayedRaw = encode(relayed);
    const directed = !!p.recipient;
    const jitter = directed ? 5 + this.rand() * 15 : (dense ? 40 : 10) + this.rand() * (dense ? 300 : 210);
    const key = packetKey(p);
    const cancel = this.sched.after(jitter, () => {
      this.pending.delete(key);
      this.fanout(relayed, relayedRaw, ingress);
    });
    this.pending.set(key, cancel);
  }

  private fanout(p: Packet, raw: Uint8Array, ingress: string | null) {
    const all = this.transport.links().filter((l) => l !== ingress);
    if (all.length === 0) return;
    let targets = all;
    if (p.recipient) {
      const l = this.directLink(toHex(p.recipient));
      if (l && l !== ingress) targets = [l];
    } else if (!PRIORITY_TYPES.has(p.type) && all.length > 2) {
      // broadcast: about log2(degree) links, picked deterministically from the packet id
      const n = Math.max(2, Math.ceil(Math.log2(all.length + 1)));
      const seed = parseInt(toHex(sha256(utf8(packetKey(p)))).slice(0, 8), 16);
      const start = seed % all.length;
      targets = Array.from({ length: Math.min(n, all.length) }, (_, i) => all[(start + i) % all.length]);
    }
    this.stats.relayed++;
    for (const l of targets) this.transport.send(l, raw);
  }

  // ---------- delivering to the app ----------

  private emitLocal(p: Packet, own: boolean) {
    const from = toHex(p.sender);
    const peer = this.peers.get(from);
    let verified = own || (!!peer && verify(p, peer.signKey));
    const hops = ORIGIN_TTL - p.ttl;
    try {
      if (p.type === PacketType.Public || p.type === PacketType.Board) {
        const b = parseJson<{ ch: string; n: string; t: string; k?: MsgKind }>(p.payload);
        if (!own && !this.channelMatches(b.ch)) return;
        this.emit('public', {
          id: from + ':' + p.timestamp,
          channel: b.ch,
          from,
          nickname: String(b.n).slice(0, 32),
          text: String(b.t).slice(0, 1000),
          kind: b.k ?? 'chat',
          timestamp: p.timestamp,
          verified,
          hops,
        });
      } else if (p.type === PacketType.Sos) {
        const b = parseJson<{ id: string; n: string; la: number; lo: number; t: string; m?: string }>(p.payload);
        this.emit('sos', {
          id: b.id,
          from,
          name: String(b.n).slice(0, 32),
          lat: b.la,
          lon: b.lo,
          note: String(b.t ?? '').slice(0, 300),
          medical: b.m,
          timestamp: p.timestamp,
          verified,
          hops,
        });
      } else if (p.type === PacketType.Safe) {
        const b = parseJson<{ n: string; la?: number; lo?: number; t?: string; f?: string }>(p.payload);
        this.emit('safe', {
          from,
          name: String(b.n).slice(0, 32),
          lat: b.la,
          lon: b.lo,
          note: b.t,
          family: b.f,
          timestamp: p.timestamp,
          verified,
        });
      } else if (p.type === PacketType.Alert) {
        const b = parseJson<{ a: AlertBody; s: string }>(p.payload);
        const sig = fromBase64(b.s);
        const msg = utf8(JSON.stringify(b.a));
        verified = (this.opts.trustedGateways ?? []).some((k) => {
          try {
            return ed25519.verify(sig, msg, k);
          } catch {
            return false;
          }
        });
        this.emit('alert', { ...b.a, verified });
      }
    } catch {
      /* malformed payload from a stranger: ignore */
    }
  }

  private channelMatches(ch: string) {
    // no position yet (or the shared fallback room): listen to everything rather than miss help requests
    if (ch === 'geo:local' || this.channels.size === 0) return true;
    if (this.channels.has(ch)) return true;
    // a message from a larger or smaller cell that contains or is contained by one of ours
    for (const mine of this.channels) if (ch.startsWith(mine) || mine.startsWith(ch)) return true;
    return !ch.startsWith('geo:'); // non-geo channels (e.g. #sos-help) are open to all
  }

  // ---------- Noise sessions and private messages ----------

  /** Same message can arrive by courier and by live session; show it once. */
  private firstDelivery(key: string) {
    if (this.deliveredIds.has(key)) return false;
    this.deliveredIds.add(key);
    if (this.deliveredIds.size > 500) this.deliveredIds.delete(this.deliveredIds.values().next().value as string);
    return true;
  }

  private reachable(peer: PeerInfo) {
    return this.sched.now() - peer.lastSeen < PEER_FRESH_MS;
  }

  private deliverOutbox(to: string) {
    const q = this.outbox.get(to);
    if (!q || q.length === 0) return;
    const now = this.sched.now();
    const peer = this.peers.get(to);
    const session = this.sessions.get(to);
    if (session?.established) {
      for (const item of q) {
        if (item.attempts >= OUTBOX_RETRIES || now - item.lastAttempt < 5_000) continue;
        item.attempts++;
        item.lastAttempt = now;
        this.sendEncrypted(to, session, { t: 'msg', id: item.id, x: item.text, n: this.opts.nickname });
      }
      return;
    }
    if (peer && this.reachable(peer)) {
      if (!session) this.startHandshake(to, peer);
      return;
    }
    // no route right now: seal for couriers so the message can ride other phones until it meets the recipient
    if (peer) {
      for (const item of q) {
        if (now - item.courierSent > 5 * 60_000) {
          item.courierSent = now;
          this.sendCourier(peer, item);
        }
      }
    }
  }

  private startHandshake(to: string, peer: PeerInfo) {
    const s = new NoiseSession(true, this.identity.noise, newEphemeral);
    this.sessions.set(to, s);
    const m1 = s.start();
    this.sendDirected(this.build(PacketType.NoiseHandshake, concat(Uint8Array.of(1), m1), fromHex(peer.id), false));
  }

  private handleHandshake(p: Packet) {
    const from = toHex(p.sender);
    const step = p.payload[0];
    const body = p.payload.slice(1);
    try {
      if (step === 1) {
        const existing = this.sessions.get(from);
        // simultaneous initiation: the lower peer id keeps the initiator role
        if (existing && !existing.established && existing.initiator && this.id < from) return;
        const s = new NoiseSession(false, this.identity.noise, newEphemeral);
        const reply = s.read(body)!;
        this.sessions.set(from, s);
        this.sendDirected(this.build(PacketType.NoiseHandshake, concat(Uint8Array.of(2), reply), p.sender, false));
      } else if (step === 2) {
        const s = this.sessions.get(from);
        if (!s || !s.initiator) return;
        const reply = s.read(body)!;
        this.sendDirected(this.build(PacketType.NoiseHandshake, concat(Uint8Array.of(3), reply), p.sender, false));
        this.onEstablished(from, s);
      } else if (step === 3) {
        const s = this.sessions.get(from);
        if (!s || s.initiator) return;
        s.read(body);
        this.onEstablished(from, s);
      }
    } catch {
      this.sessions.delete(from);
    }
  }

  private onEstablished(from: string, s: NoiseSession) {
    // the authenticated static key must hash to the sender id, otherwise someone is impersonating
    if (!s.remoteStatic || !equal(peerIdFromStatic(s.remoteStatic), fromHex(from))) {
      this.sessions.delete(from);
      return;
    }
    this.deliverOutbox(from);
  }

  private sendEncrypted(to: string, s: NoiseSession, body: object) {
    const sealed = s.seal(pad(jsonBytes(body)));
    this.sendDirected(this.build(PacketType.NoiseEncrypted, sealed, fromHex(to), false));
  }

  private handleEncrypted(p: Packet) {
    const from = toHex(p.sender);
    const s = this.sessions.get(from);
    if (!s?.established) {
      // we lost the session (restart): ask the sender to re-handshake by starting one ourselves
      const peer = this.peers.get(from);
      if (peer && !s) this.startHandshake(from, peer);
      return;
    }
    const plain = s.open(p.payload);
    if (!plain) return;
    let b: { t: string; id: string; x?: string; n?: string };
    try {
      b = parseJson(unpad(plain));
    } catch {
      return;
    }
    if (b.t === 'msg') {
      if (!this.firstDelivery(from + b.id)) {
        this.sendEncrypted(from, s, { t: 'ack', id: b.id });
        return;
      }
      this.emit('private', {
        id: b.id,
        from,
        nickname: String(b.n ?? this.peers.get(from)?.nickname ?? '').slice(0, 32),
        text: String(b.x ?? '').slice(0, 2000),
        timestamp: p.timestamp,
        viaCourier: false,
      });
      this.sendEncrypted(from, s, { t: 'ack', id: b.id });
    } else if (b.t === 'ack') {
      const q = this.outbox.get(from);
      if (q) {
        const i = q.findIndex((m) => m.id === b.id);
        if (i >= 0) {
          q.splice(i, 1);
          this.emit('delivered', b.id);
        }
      }
    }
  }

  // ---------- courier (sealed store-and-forward) ----------

  private courierTag(noisePub: Uint8Array, dayOffset = 0) {
    const day = Math.floor(this.sched.now() / 86_400_000) + dayOffset;
    return hmac(sha256, noisePub, utf8('day:' + day)).slice(0, 16);
  }

  private sendCourier(peer: PeerInfo, item: OutboxItem) {
    const ts = this.sched.now();
    const inner = {
      id: item.id,
      x: item.text,
      ts,
      fk: toBase64(this.identity.noise.publicKey),
      sk: toBase64(this.identity.signing.publicKey),
      n: this.opts.nickname,
    };
    const innerBytes = jsonBytes(inner);
    const sig = ed25519.sign(innerBytes, this.identity.signing.secretKey);
    const plain = jsonBytes({ i: toBase64(innerBytes), s: toBase64(sig) });
    const eph = newEphemeral();
    const key = hkdf(sha256, x25519.getSharedSecret(eph.secretKey, peer.noiseKey), eph.publicKey, utf8('beacon-courier'), 32);
    const nonce = randomBytes(12);
    const ct = chacha20poly1305(key, nonce).encrypt(plain);
    const payload = concat(this.courierTag(peer.noiseKey), eph.publicKey, nonce, ct);
    if (payload.length > COURIER_MAX_BYTES) return;
    const p = this.build(PacketType.Courier, payload);
    this.markSeen(packetKey(p));
    this.keepCourier(p, encode(p));
    this.transmit(p, encode(p));
  }

  private keepCourier(p: Packet, raw: Uint8Array) {
    const tag = toHex(p.payload.slice(0, 16));
    const key = tag + toHex(p.payload.slice(16, 24));
    if (this.couriers.size >= COURIER_MAX) {
      const oldest = this.couriers.keys().next().value;
      if (oldest) this.couriers.delete(oldest);
    }
    this.couriers.set(key, { tag, raw, expires: this.sched.now() + COURIER_TTL_MS });
  }

  private handleCourier(p: Packet, raw: Uint8Array) {
    if (p.payload.length < 16 + 32 + 12 + 16 || p.payload.length > COURIER_MAX_BYTES) return;
    const tag = p.payload.slice(0, 16);
    this.keepCourier(p, raw); // carry it for others regardless
    const mineToday = equal(tag, this.courierTag(this.identity.noise.publicKey, 0));
    const mineYesterday = equal(tag, this.courierTag(this.identity.noise.publicKey, -1));
    if (!mineToday && !mineYesterday) return;
    try {
      const eph = p.payload.slice(16, 48);
      const nonce = p.payload.slice(48, 60);
      const ct = p.payload.slice(60);
      const key = hkdf(sha256, x25519.getSharedSecret(this.identity.noise.secretKey, eph), eph, utf8('beacon-courier'), 32);
      const plain = chacha20poly1305(key, nonce).decrypt(ct);
      const outer = parseJson<{ i: string; s: string }>(plain);
      const innerBytes = fromBase64(outer.i);
      const inner = parseJson<{ id: string; x: string; ts: number; fk: string; sk: string; n: string }>(innerBytes);
      const sk = fromBase64(inner.sk);
      const fk = fromBase64(inner.fk);
      if (!ed25519.verify(fromBase64(outer.s), innerBytes, sk)) return;
      if (!this.firstDelivery(toHex(peerIdFromStatic(fk)) + inner.id)) return;
      this.emit('private', {
        id: inner.id,
        from: toHex(peerIdFromStatic(fk)),
        nickname: String(inner.n).slice(0, 32),
        text: String(inner.x).slice(0, 2000),
        timestamp: inner.ts,
        viaCourier: true,
      });
    } catch {
      /* not decryptable: a tag collision or tampered envelope */
    }
  }

  /** A peer we hold sealed mail for just showed up directly: hand it over. */
  private handoverCouriers(peer: PeerInfo) {
    if (!peer.direct || !peer.link) return;
    const tags = [toHex(this.courierTag(peer.noiseKey, 0)), toHex(this.courierTag(peer.noiseKey, -1))];
    for (const c of this.couriers.values()) {
      if (tags.includes(c.tag)) this.transport.send(peer.link, c.raw);
    }
  }

  // ---------- gossip sync (public history) ----------

  private remember(p: Packet, raw: Uint8Array) {
    const key = packetKey(p);
    if (this.cache.has(key)) return;
    if (this.cache.size >= SYNC_CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { raw, ts: p.timestamp, type: p.type });
  }

  private syncTick() {
    const links = this.transport.links();
    if (links.length === 0) return;
    this.syncWith(links[Math.floor(this.rand() * links.length)]);
  }

  private syncWith(link: string) {
    const keys = [...this.cache.keys()].slice(-200);
    const g = buildGcs(keys);
    const head = new Uint8Array(2);
    new DataView(head.buffer).setUint16(0, g.n);
    const p: Packet = { ...this.build(PacketType.SyncRequest, concat(head, g.data), undefined, false), ttl: 1 };
    this.transport.send(link, encode(p));
  }

  private handleSync(p: Packet, link: string) {
    if (p.payload.length < 2) return;
    const n = new DataView(p.payload.buffer, p.payload.byteOffset, p.payload.byteLength).getUint16(0);
    const have = decodeGcs(n, p.payload.slice(2));
    const missing = [...this.cache.entries()]
      .filter(([k]) => !gcsHas(have, n, k))
      .sort((a, b) => (TYPE_RANK[a[1].type] ?? 9) - (TYPE_RANK[b[1].type] ?? 9) || b[1].ts - a[1].ts)
      .slice(0, SYNC_REPLY_MAX);
    for (const [, v] of missing) this.transport.send(link, v.raw);
  }

  // ---------- persistence (store-and-forward must survive an app restart) ----------

  /** Everything that is worth keeping across restarts: pending mail, carried envelopes, recent history, known peers. */
  snapshot(): string {
    return JSON.stringify({
      v: 1,
      outbox: [...this.outbox.entries()],
      couriers: [...this.couriers.values()].map((c) => ({ tag: c.tag, raw: toBase64(c.raw), expires: c.expires })),
      cache: [...this.cache.entries()].map(([k, v]) => ({ k, raw: toBase64(v.raw), ts: v.ts, type: v.type })),
      peers: [...this.peers.values()].map((p) => ({ id: p.id, nickname: p.nickname, noiseKey: toBase64(p.noiseKey), signKey: toBase64(p.signKey), lastSeen: p.lastSeen })),
      delivered: [...this.deliveredIds].slice(-200),
    });
  }

  restore(json: string) {
    try {
      const s = JSON.parse(json);
      if (s.v !== 1) return;
      const now = this.sched.now();
      for (const [to, q] of s.outbox as [string, OutboxItem[]][]) {
        const keep = q.filter((m) => now - m.created < OUTBOX_TTL_MS && m.attempts < OUTBOX_RETRIES);
        if (keep.length) this.outbox.set(to, keep.map((m) => ({ ...m, lastAttempt: 0, courierSent: 0 })));
      }
      for (const c of s.couriers as { tag: string; raw: string; expires: number }[]) {
        if (c.expires <= now) continue;
        const raw = fromBase64(c.raw);
        const p = decode(raw);
        if (p) this.couriers.set(c.tag + toHex(p.payload.slice(16, 24)), { tag: c.tag, raw, expires: c.expires });
      }
      for (const c of s.cache as { k: string; raw: string; ts: number; type: PacketType }[]) {
        if (now - c.ts < SYNC_RETENTION_MS) this.cache.set(c.k, { raw: fromBase64(c.raw), ts: c.ts, type: c.type });
      }
      for (const p of s.peers as { id: string; nickname: string; noiseKey: string; signKey: string; lastSeen: number }[]) {
        // restored peers are known but not reachable until they announce again (direct is false)
        this.peers.set(p.id, { id: p.id, nickname: p.nickname, noiseKey: fromBase64(p.noiseKey), signKey: fromBase64(p.signKey), lastSeen: p.lastSeen, direct: false });
      }
      for (const d of s.delivered as string[]) this.deliveredIds.add(d);
    } catch {
      /* a corrupt snapshot must never stop the mesh from starting */
    }
  }

  // ---------- housekeeping ----------

  private markSeen(key: string) {
    this.seen.set(key, this.sched.now());
    if (this.seen.size > DEDUP_MAX) {
      const oldest = this.seen.keys().next().value;
      if (oldest) this.seen.delete(oldest);
    }
  }

  private pruneSeen() {
    const cutoff = this.sched.now() - DEDUP_TTL_MS;
    for (const [k, t] of this.seen) {
      if (t >= cutoff) break;
      this.seen.delete(k);
    }
  }

  private housekeeping() {
    const now = this.sched.now();
    for (const [k, v] of this.cache) if (now - v.ts > SYNC_RETENTION_MS) this.cache.delete(k);
    for (const [k, c] of this.couriers) if (now > c.expires) this.couriers.delete(k);
    for (const [k, a] of this.assemblies) if (now - a.started > FRAGMENT_TIMEOUT_MS) this.assemblies.delete(k);
    for (const [to, q] of this.outbox) {
      const keep = q.filter((m) => now - m.created < OUTBOX_TTL_MS && m.attempts < OUTBOX_RETRIES);
      if (keep.length) this.outbox.set(to, keep);
      else this.outbox.delete(to);
      this.deliverOutbox(to);
    }
  }
}
