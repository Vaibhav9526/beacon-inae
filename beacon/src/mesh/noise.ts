// Noise_XX_25519_ChaChaPoly_SHA256, the same pattern bitchat uses for live sessions.
//   -> e
//   <- e, ee, s, es
//   -> s, se
// Transport messages carry an explicit 8-byte nonce so they survive loss and reordering on the mesh.
import { x25519 } from '@noble/curves/ed25519.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concat, equal, utf8 } from './bytes';

const PROTOCOL = 'Noise_XX_25519_ChaChaPoly_SHA256';
const EMPTY = new Uint8Array(0);

export interface KeyPair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

function nonceBytes(n: number): Uint8Array {
  const out = new Uint8Array(12);
  const v = new DataView(out.buffer);
  v.setUint32(4, n % 2 ** 32, true);
  v.setUint32(8, Math.floor(n / 2 ** 32), true);
  return out;
}

class CipherState {
  n = 0;
  constructor(public k: Uint8Array | null = null) {}
  encrypt(ad: Uint8Array, pt: Uint8Array): Uint8Array {
    if (!this.k) return pt;
    return chacha20poly1305(this.k, nonceBytes(this.n++), ad).encrypt(pt);
  }
  decrypt(ad: Uint8Array, ct: Uint8Array): Uint8Array {
    if (!this.k) return ct;
    const pt = chacha20poly1305(this.k, nonceBytes(this.n), ad).decrypt(ct);
    this.n++;
    return pt;
  }
}

function kdf2(ck: Uint8Array, ikm: Uint8Array): [Uint8Array, Uint8Array] {
  const out = hkdf(sha256, ikm, ck, EMPTY, 64);
  return [out.slice(0, 32), out.slice(32, 64)];
}

class SymmetricState {
  ck: Uint8Array;
  h: Uint8Array;
  cs = new CipherState();
  constructor() {
    const name = utf8(PROTOCOL);
    this.h = name.length <= 32 ? concat(name, new Uint8Array(32 - name.length)) : sha256(name);
    this.ck = this.h;
  }
  mixHash(d: Uint8Array) {
    this.h = sha256(concat(this.h, d));
  }
  mixKey(ikm: Uint8Array) {
    const [ck, k] = kdf2(this.ck, ikm);
    this.ck = ck;
    this.cs = new CipherState(k);
  }
  encryptAndHash(pt: Uint8Array) {
    const ct = this.cs.encrypt(this.h, pt);
    this.mixHash(ct);
    return ct;
  }
  decryptAndHash(ct: Uint8Array) {
    const pt = this.cs.decrypt(this.h, ct);
    this.mixHash(ct);
    return pt;
  }
  split(): [CipherState, CipherState] {
    const [k1, k2] = kdf2(this.ck, EMPTY);
    return [new CipherState(k1), new CipherState(k2)];
  }
}

export class NoiseSession {
  /** Remote static public key once the handshake has authenticated it. */
  remoteStatic: Uint8Array | null = null;
  established = false;
  private sym = new SymmetricState();
  private e: KeyPair | null = null;
  private re: Uint8Array | null = null;
  private step: number;
  private send: CipherState | null = null;
  private recv: CipherState | null = null;
  private highestRecv = -1;

  constructor(
    readonly initiator: boolean,
    private s: KeyPair,
    private gen: () => KeyPair,
  ) {
    this.sym.mixHash(EMPTY); // empty prologue
    this.step = initiator ? 0 : 1;
  }

  /** Initiator: call first. Returns message 1. */
  start(): Uint8Array {
    if (!this.initiator || this.step !== 0) throw new Error('bad state');
    this.e = this.gen();
    this.sym.mixHash(this.e.publicKey);
    this.step = 2;
    return concat(this.e.publicKey, this.sym.encryptAndHash(EMPTY));
  }

  /** Feed a received handshake message; returns the reply (or null when finished). */
  read(msg: Uint8Array): Uint8Array | null {
    if (this.initiator) return this.readAsInitiator(msg);
    return this.readAsResponder(msg);
  }

  private readAsResponder(msg: Uint8Array): Uint8Array | null {
    if (this.step === 1) {
      // <- e (from initiator), then we send: e, ee, s, es
      this.re = msg.slice(0, 32);
      this.sym.mixHash(this.re);
      this.sym.decryptAndHash(msg.slice(32));
      this.e = this.gen();
      this.sym.mixHash(this.e.publicKey);
      this.sym.mixKey(x25519.getSharedSecret(this.e.secretKey, this.re)); // ee
      const encS = this.sym.encryptAndHash(this.s.publicKey);
      this.sym.mixKey(x25519.getSharedSecret(this.s.secretKey, this.re)); // es
      const payload = this.sym.encryptAndHash(EMPTY);
      this.step = 3;
      return concat(this.e.publicKey, encS, payload);
    }
    if (this.step === 3) {
      // -> s, se
      const rs = this.sym.decryptAndHash(msg.slice(0, 48));
      this.remoteStatic = rs;
      this.sym.mixKey(x25519.getSharedSecret(this.e!.secretKey, rs)); // se
      this.sym.decryptAndHash(msg.slice(48));
      const [c1, c2] = this.sym.split();
      this.recv = c1; // initiator -> responder
      this.send = c2;
      this.established = true;
      return null;
    }
    throw new Error('bad state');
  }

  private readAsInitiator(msg: Uint8Array): Uint8Array | null {
    if (this.step !== 2) throw new Error('bad state');
    this.re = msg.slice(0, 32);
    this.sym.mixHash(this.re);
    this.sym.mixKey(x25519.getSharedSecret(this.e!.secretKey, this.re)); // ee
    const rs = this.sym.decryptAndHash(msg.slice(32, 80));
    this.remoteStatic = rs;
    this.sym.mixKey(x25519.getSharedSecret(this.e!.secretKey, rs)); // es
    this.sym.decryptAndHash(msg.slice(80));
    const encS = this.sym.encryptAndHash(this.s.publicKey);
    this.sym.mixKey(x25519.getSharedSecret(this.s.secretKey, this.re)); // se
    const payload = this.sym.encryptAndHash(EMPTY);
    const [c1, c2] = this.sym.split();
    this.send = c1;
    this.recv = c2;
    this.established = true;
    this.step = 4;
    return concat(encS, payload);
  }

  /** Transport encrypt: nonce(8) || ciphertext. */
  seal(plain: Uint8Array): Uint8Array {
    if (!this.established || !this.send) throw new Error('not established');
    const n = this.send.n;
    const ct = this.send.encrypt(EMPTY, plain);
    const head = new Uint8Array(8);
    new DataView(head.buffer).setUint32(0, Math.floor(n / 2 ** 32));
    new DataView(head.buffer).setUint32(4, n >>> 0);
    return concat(head, ct);
  }

  /** Transport decrypt. Returns null on forgery or replay. */
  open(msg: Uint8Array): Uint8Array | null {
    if (!this.established || !this.recv || msg.length < 8 + 16) return null;
    const v = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
    const n = v.getUint32(0) * 2 ** 32 + v.getUint32(4);
    if (n <= this.highestRecv) return null; // replay or duplicate
    try {
      const pt = chacha20poly1305(this.recv.k!, nonceBytes(n)).decrypt(msg.slice(8));
      this.highestRecv = n;
      return pt;
    } catch {
      return null;
    }
  }
}

/** Pad to a size bucket (256/512/1024/2048) with PKCS#7-style bytes, as the bitchat whitepaper describes. */
export function pad(data: Uint8Array): Uint8Array {
  for (const bucket of [256, 512, 1024, 2048]) {
    if (data.length < bucket) {
      const n = bucket - data.length;
      if (n > 255) return data; // pad length must fit in one byte; otherwise send unpadded
      const out = new Uint8Array(bucket);
      out.set(data);
      out.fill(n, data.length);
      return out;
    }
  }
  return data;
}

export function unpad(data: Uint8Array): Uint8Array {
  if (data.length === 0) return data;
  const n = data[data.length - 1];
  if (n === 0 || n > data.length || n > 255) return data;
  for (let i = data.length - n; i < data.length; i++) if (data[i] !== n) return data;
  return data.slice(0, data.length - n);
}

export const samePub = equal;
