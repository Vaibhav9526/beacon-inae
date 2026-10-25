import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { fromBase64, toBase64 } from './bytes';
import type { KeyPair } from './noise';

export interface Identity {
  noise: KeyPair; // Curve25519 static key (Noise)
  signing: KeyPair; // Ed25519 signing key
  peerId: Uint8Array; // first 8 bytes of SHA-256(noise static public key)
}

export const peerIdFromStatic = (noisePub: Uint8Array) => sha256(noisePub).slice(0, 8);

export function createIdentity(): Identity {
  const noise = x25519.keygen();
  const signing = ed25519.keygen();
  return { noise, signing, peerId: peerIdFromStatic(noise.publicKey) };
}

export const newEphemeral = (): KeyPair => x25519.keygen();

export function serializeIdentity(i: Identity): string {
  return JSON.stringify({
    ns: toBase64(i.noise.secretKey),
    ss: toBase64(i.signing.secretKey),
  });
}

export function deserializeIdentity(s: string): Identity {
  const j = JSON.parse(s) as { ns: string; ss: string };
  const nsk = fromBase64(j.ns);
  const ssk = fromBase64(j.ss);
  const noise = { secretKey: nsk, publicKey: x25519.getPublicKey(nsk) };
  const signing = { secretKey: ssk, publicKey: ed25519.getPublicKey(ssk) };
  return { noise, signing, peerId: peerIdFromStatic(noise.publicKey) };
}

/** Where the identity lives (SecureStore on device, memory in tests). */
export interface KeyStore {
  get(): Promise<string | null>;
  set(v: string): Promise<void>;
}

export async function loadOrCreateIdentity(store: KeyStore): Promise<Identity> {
  const saved = await store.get();
  if (saved) {
    try {
      return deserializeIdentity(saved);
    } catch {
      /* corrupted, fall through and mint a new one */
    }
  }
  const id = createIdentity();
  await store.set(serializeIdentity(id));
  return id;
}
