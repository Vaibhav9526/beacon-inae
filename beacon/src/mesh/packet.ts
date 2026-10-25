import { ed25519 } from '@noble/curves/ed25519.js';
import { concat, toHex } from './bytes';

export const VERSION = 1;
export const ORIGIN_TTL = 7;
export const ID_LEN = 8;
export const SIG_LEN = 64;
export const FRAGMENT_SIZE = 469;

export enum PacketType {
  Announce = 1,
  Public = 2,
  NoiseHandshake = 3,
  NoiseEncrypted = 4,
  Fragment = 5,
  SyncRequest = 6,
  Sos = 7,
  Safe = 8,
  Courier = 9,
  Alert = 10,
  Board = 11,
}

const F_RECIPIENT = 1;
const F_SIGNATURE = 2;
const HEADER = 20; // version, type, ttl, flags, 8 timestamp, 8 sender

export interface Packet {
  version: number;
  type: PacketType;
  ttl: number;
  timestamp: number; // ms since epoch
  sender: Uint8Array; // 8 bytes
  recipient?: Uint8Array; // 8 bytes, directed traffic only
  payload: Uint8Array;
  signature?: Uint8Array;
}

function writeU64(view: DataView, off: number, v: number) {
  view.setUint32(off, Math.floor(v / 2 ** 32));
  view.setUint32(off + 4, v >>> 0);
}
const readU64 = (view: DataView, off: number) => view.getUint32(off) * 2 ** 32 + view.getUint32(off + 4);

/** Bytes covered by the signature: the whole packet minus the signature, with TTL zeroed so relays can decrement it. */
function signedBytes(p: Packet): Uint8Array {
  const unsigned = encode({ ...p, ttl: 0, signature: undefined });
  return unsigned;
}

export function encode(p: Packet): Uint8Array {
  const hasR = !!p.recipient;
  const hasS = !!p.signature;
  const len = HEADER + (hasR ? ID_LEN : 0) + 2 + p.payload.length + (hasS ? SIG_LEN : 0);
  const out = new Uint8Array(len);
  const view = new DataView(out.buffer);
  out[0] = p.version;
  out[1] = p.type;
  out[2] = p.ttl;
  out[3] = (hasR ? F_RECIPIENT : 0) | (hasS ? F_SIGNATURE : 0);
  writeU64(view, 4, p.timestamp);
  out.set(p.sender, 12);
  let o = HEADER;
  if (hasR) {
    out.set(p.recipient!, o);
    o += ID_LEN;
  }
  view.setUint16(o, p.payload.length);
  o += 2;
  out.set(p.payload, o);
  o += p.payload.length;
  if (hasS) out.set(p.signature!, o);
  return out;
}

export function decode(b: Uint8Array): Packet | null {
  if (b.length < HEADER + 2) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b[0] !== VERSION) return null;
  const flags = b[3];
  let o = HEADER;
  let recipient: Uint8Array | undefined;
  if (flags & F_RECIPIENT) {
    if (b.length < o + ID_LEN + 2) return null;
    recipient = b.slice(o, o + ID_LEN);
    o += ID_LEN;
  }
  const plen = view.getUint16(o);
  o += 2;
  if (b.length < o + plen) return null;
  const payload = b.slice(o, o + plen);
  o += plen;
  let signature: Uint8Array | undefined;
  if (flags & F_SIGNATURE) {
    if (b.length < o + SIG_LEN) return null;
    signature = b.slice(o, o + SIG_LEN);
  }
  return {
    version: b[0],
    type: b[1],
    ttl: b[2],
    timestamp: readU64(view, 4),
    sender: b.slice(12, 20),
    recipient,
    payload,
    signature,
  };
}

export function sign(p: Packet, signingSecret: Uint8Array): Packet {
  return { ...p, signature: ed25519.sign(signedBytes(p), signingSecret) };
}

export function verify(p: Packet, signingPublic: Uint8Array): boolean {
  if (!p.signature) return false;
  try {
    return ed25519.verify(p.signature, signedBytes(p), signingPublic);
  } catch {
    return false;
  }
}

/** Dedup key: sender + timestamp + type + payload digest (cheap FNV, not security relevant). */
export function packetKey(p: Packet): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < p.payload.length; i++) {
    h1 = Math.imul(h1 ^ p.payload[i], 0x01000193) >>> 0;
    h2 = Math.imul(h2 + p.payload[i], 0x85ebca6b) >>> 0;
  }
  return `${toHex(p.sender)}:${p.timestamp}:${p.type}:${h1.toString(16)}${h2.toString(16)}:${p.payload.length}`;
}

/** Split one encoded packet into FRAGMENT packets. Each carries fragId(8) index(2) total(2) chunk. */
export function fragment(raw: Uint8Array, base: Packet, fragId: Uint8Array): Packet[] {
  const total = Math.ceil(raw.length / FRAGMENT_SIZE);
  const out: Packet[] = [];
  for (let i = 0; i < total; i++) {
    const chunk = raw.slice(i * FRAGMENT_SIZE, (i + 1) * FRAGMENT_SIZE);
    const head = new Uint8Array(12);
    head.set(fragId, 0);
    new DataView(head.buffer).setUint16(8, i);
    new DataView(head.buffer).setUint16(10, total);
    out.push({
      version: VERSION,
      type: PacketType.Fragment,
      ttl: base.ttl,
      timestamp: base.timestamp,
      sender: base.sender,
      recipient: base.recipient,
      payload: concat(head, chunk),
    });
  }
  return out;
}

export function parseFragment(p: Packet) {
  if (p.payload.length < 12) return null;
  const v = new DataView(p.payload.buffer, p.payload.byteOffset, p.payload.byteLength);
  return {
    id: toHex(p.payload.slice(0, 8)),
    index: v.getUint16(8),
    total: v.getUint16(10),
    chunk: p.payload.slice(12),
  };
}
