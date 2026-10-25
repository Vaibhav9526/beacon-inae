import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
const utf8 = (s: string) => new TextEncoder().encode(s);

export interface ServerKey {
  publicKey: Uint8Array;
  publicKeyB64: string;
  sign(message: string): string; // base64 signature
}

/** The server's Ed25519 key. Apps pin the public half and treat anything it signs as official. */
export function loadServerKey(path: string): ServerKey {
  let secret: Uint8Array;
  if (path !== ':memory:' && existsSync(path)) {
    secret = unb64(JSON.parse(readFileSync(path, 'utf8')).secret);
  } else {
    secret = ed25519.keygen().secretKey;
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify({ secret: b64(secret) }), { mode: 0o600 });
    }
  }
  const publicKey = ed25519.getPublicKey(secret);
  return {
    publicKey,
    publicKeyB64: b64(publicKey),
    sign: (m) => b64(ed25519.sign(utf8(m), secret)),
  };
}

export const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
export const sha256Hex = (data: Uint8Array | string) => hex(sha256(typeof data === 'string' ? utf8(data) : data));

/** A device identifies itself with its Ed25519 public key and signs `${ts}.${METHOD}.${path}.${sha256(body)}`. */
export function verifyDeviceRequest(opts: {
  device: string;
  ts: string;
  sig: string;
  method: string;
  path: string;
  body: Uint8Array;
  now: number;
}): boolean {
  const ts = Number(opts.ts);
  if (!Number.isFinite(ts) || Math.abs(opts.now - ts) > 10 * 60_000) return false;
  try {
    const msg = utf8(`${opts.ts}.${opts.method}.${opts.path}.${sha256Hex(opts.body)}`);
    return ed25519.verify(unb64(opts.sig), msg, unb64(opts.device));
  } catch {
    return false;
  }
}
