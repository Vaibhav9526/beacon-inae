// Phone side of the hub wire format. Mirrors hub/engine/wire.ts: ChaCha20-Poly1305 with the per-hub
// group key, AAD 'beacon-hub-v1', blob = base64(nonce(12) || ciphertext || tag(16)). Pure: no react-native.
// Types are copied from hub/engine/types.ts on purpose (see docs/hub-v2-plan.md); do not import from hub/.

import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { concat, fromBase64, fromUtf8, toBase64, utf8 } from '../mesh/bytes';

export const WIRE_AAD = 'beacon-hub-v1';
export const WIRE_NONCE_BYTES = 12;
export const WIRE_TAG_BYTES = 16;
export const WIRE_KEY_BYTES = 32;
/** Longest blob we send. The relay accepts more, but feed batches are split to fit under this. */
export const WIRE_MAX_BLOB = 8000;

export type Severity = 'info' | 'watch' | 'warning' | 'severe';
export type MemberRole = 'adult' | 'elder' | 'child';
export type FeedKind = 'news' | 'weather' | 'wind' | 'quake' | 'flood' | 'alert' | 'health' | 'supply' | 'advisory' | 'chat' | 'custom';

export interface Look {
  hair: number;
  skin: number;
  color: string;
}

/** One thing an agent found, ready to show on a phone. */
export interface FeedItem {
  id: string;
  agentId: string;
  agentName: string;
  nodeId?: string;
  kind: FeedKind;
  title: string;
  body: string;
  severity: Severity;
  at: number;
  url?: string;
  tags: string[];
  place?: string;
  data?: Record<string, number | string>;
  /** longer text for the detail page (up to 1500 characters); may be absent */
  detail?: string;
}

export interface WireMember {
  id: string;
  name: string;
  role: MemberRole;
  look?: Look;
}

export interface GroupMessage {
  id: string;
  /** a member id, or 'hub' for system and agent messages, or 'phone' when the sender is unknown */
  from: string;
  fromName: string;
  text: string;
  at: number;
  kind: 'text' | 'sos' | 'safe' | 'alert' | 'agent';
}

/** What travels between hub and phones inside an encrypted blob. */
export type WireMessage =
  | { t: 'feed'; items: FeedItem[] }
  | { t: 'members'; members: WireMember[]; you?: string }
  | { t: 'chat'; msg: GroupMessage }
  | { t: 'ask'; id: string; text: string }
  | { t: 'answer'; id: string; text: string; ok: boolean }
  | { t: 'hello'; name: string; role?: MemberRole; invite?: string }
  | { t: 'safe'; name: string; note?: string }
  | { t: 'sos'; name: string; lat?: number; lon?: number; note?: string };

/** Decodes the base64 group key from the pairing QR. Null unless it is exactly 32 bytes. */
export function parseGroupKey(b64: string): Uint8Array | null {
  if (!b64 || typeof b64 !== 'string') return null;
  try {
    const k = fromBase64(b64);
    return k.length === WIRE_KEY_BYTES ? k : null;
  } catch {
    return null;
  }
}

/** Encrypts with a caller-chosen nonce. Only for tests and the shared test vector; use encodeWire otherwise. */
export function encodeWireWithNonce(msg: WireMessage, gk: Uint8Array, nonce: Uint8Array): string {
  if (gk.length !== WIRE_KEY_BYTES) throw new Error('group key must be 32 bytes');
  if (nonce.length !== WIRE_NONCE_BYTES) throw new Error('nonce must be 12 bytes');
  const ct = chacha20poly1305(gk, nonce, utf8(WIRE_AAD)).encrypt(utf8(JSON.stringify(msg)));
  const blob = toBase64(concat(nonce, ct));
  if (blob.length > WIRE_MAX_BLOB) throw new RangeError(`wire blob too large: ${blob.length} > ${WIRE_MAX_BLOB}`);
  return blob;
}

/** Encrypts a WireMessage for the group key with a fresh random nonce. Throws RangeError when the blob is too big. */
export function encodeWire(msg: WireMessage, gk: Uint8Array): string {
  return encodeWireWithNonce(msg, gk, randomBytes(WIRE_NONCE_BYTES));
}

/** Decrypts a blob. Returns null for anything that is not a valid, authentic message for this key. Never throws. */
export function decodeWire(blob: string, gk: Uint8Array): WireMessage | null {
  try {
    if (gk.length !== WIRE_KEY_BYTES || typeof blob !== 'string') return null;
    const raw = fromBase64(blob);
    if (raw.length < WIRE_NONCE_BYTES + WIRE_TAG_BYTES) return null;
    const nonce = raw.subarray(0, WIRE_NONCE_BYTES);
    const ct = raw.subarray(WIRE_NONCE_BYTES);
    const pt = chacha20poly1305(gk, nonce, utf8(WIRE_AAD)).decrypt(ct);
    const j = JSON.parse(fromUtf8(pt)) as unknown;
    if (!j || typeof j !== 'object' || typeof (j as { t?: unknown }).t !== 'string') return null;
    return j as WireMessage;
  } catch {
    return null;
  }
}
