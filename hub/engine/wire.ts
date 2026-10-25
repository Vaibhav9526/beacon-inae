import { randomBytes } from 'node:crypto';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import type { FeedItem, WireMessage } from './types.ts';

/**
 * Hub <-> phone wire format (see docs/hub-v2-plan.md).
 * blob = base64( nonce(12) || ciphertext || tag(16) ), ChaCha20-Poly1305 with the group key, AAD 'beacon-hub-v1'.
 * The Beacon server only ever sees these opaque blobs.
 */

const AAD = new TextEncoder().encode('beacon-hub-v1');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Encrypt with a caller-chosen nonce. Only for tests (the shared test vector); real code uses encodeWire. */
export function encodeWireWithNonce(msg: WireMessage, gk: Uint8Array, nonce: Uint8Array): string {
  if (nonce.length !== NONCE_BYTES) throw new Error('nonce must be 12 bytes');
  const ct = chacha20poly1305(gk, nonce, AAD).encrypt(enc.encode(JSON.stringify(msg)));
  const out = new Uint8Array(NONCE_BYTES + ct.length);
  out.set(nonce, 0);
  out.set(ct, NONCE_BYTES);
  return Buffer.from(out).toString('base64');
}

/** Encrypt a message for the phones with a fresh random nonce. */
export function encodeWire(msg: WireMessage, gk: Uint8Array): string {
  return encodeWireWithNonce(msg, gk, new Uint8Array(randomBytes(NONCE_BYTES)));
}

/** Decrypt a blob. Returns null on tamper, wrong key, bad base64 or bad JSON. Never throws. */
export function decodeWire(blob: string, gk: Uint8Array): WireMessage | null {
  try {
    if (typeof blob !== 'string' || blob.length === 0 || blob.length % 4 !== 0 || !B64.test(blob)) return null;
    const raw = new Uint8Array(Buffer.from(blob, 'base64'));
    if (raw.length < NONCE_BYTES + TAG_BYTES) return null;
    const nonce = raw.subarray(0, NONCE_BYTES);
    const ct = raw.subarray(NONCE_BYTES);
    const pt = chacha20poly1305(gk, nonce, AAD).decrypt(ct);
    const obj = JSON.parse(dec.decode(pt)) as unknown;
    if (!obj || typeof obj !== 'object' || typeof (obj as { t?: unknown }).t !== 'string') return null;
    return obj as WireMessage;
  } catch {
    return null;
  }
}

/** A fresh 32-byte group key. It is made on the desktop and travels only in the pairing QR. */
export function newGroupKey(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

/** Length of the base64 blob that `json` would encode to (the plaintext is JSON bytes). */
function blobLength(json: string): number {
  const bytes = NONCE_BYTES + Buffer.byteLength(json, 'utf8') + TAG_BYTES;
  return 4 * Math.ceil(bytes / 3);
}

const feedJson = (items: FeedItem[]) => JSON.stringify({ t: 'feed', items } satisfies WireMessage);

/** Shrink one item until its feed blob fits: body first, then data, title, and the optional fields. */
function fitItem(item: FeedItem, maxBlob: number): FeedItem {
  let it: FeedItem = { ...item };
  const fits = (x: FeedItem) => blobLength(feedJson([x])) <= maxBlob;
  while (!fits(it)) {
    if (it.body.length > 0) it = { ...it, body: it.body.slice(0, Math.floor(it.body.length * 0.7)) };
    else if (it.data) it = { ...it, data: undefined };
    else if (it.title.length > 0) it = { ...it, title: it.title.slice(0, Math.floor(it.title.length * 0.7)) };
    else if (it.url || it.place || it.tags.length) it = { ...it, url: undefined, place: undefined, tags: [] };
    else if (it.agentName.length > 0) it = { ...it, agentName: it.agentName.slice(0, Math.floor(it.agentName.length * 0.7)) };
    else break;
  }
  return it;
}

/**
 * Split a feed into as many encrypted blobs as needed. Each blob decodes to {t:'feed', items:[...]} and is at most
 * `maxBlob` characters. An item too big for a blob on its own is truncated (body first) so it still fits.
 */
export function chunkFeed(items: FeedItem[], gk: Uint8Array, maxBlob = 8000): string[] {
  const out: string[] = [];
  let batch: FeedItem[] = [];
  const flush = () => {
    if (batch.length) out.push(encodeWire({ t: 'feed', items: batch }, gk));
    batch = [];
  };
  for (const raw of items) {
    const item = blobLength(feedJson([raw])) <= maxBlob ? raw : fitItem(raw, maxBlob);
    if (batch.length && blobLength(feedJson([...batch, item])) > maxBlob) flush();
    batch.push(item);
  }
  flush();
  return out;
}
