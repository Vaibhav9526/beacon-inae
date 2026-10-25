import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import QRCode from 'qrcode';
import type { Alert } from './types.ts';
import type { Sender } from './outbox.ts';

const utf8 = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

function base32(bytes: Uint8Array): string {
  const A = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += A[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += A[(value << (5 - bits)) & 31];
  return out;
}

/** The hub's identity on the Beacon server, plus the push channel to paired phones. */
export class BeaconLink implements Sender {
  readonly channel = 'beacon' as const;
  private secret: Uint8Array;
  readonly pubKey: string;
  readonly hubId: string;

  constructor(
    dir: string,
    private relayUrl: string,
    private fetchFn: typeof fetch = fetch,
  ) {
    const file = join(dir, 'hub-identity.json');
    if (existsSync(file)) this.secret = Buffer.from((JSON.parse(readFileSync(file, 'utf8')) as { secret: string }).secret, 'base64');
    else {
      this.secret = ed25519.utils.randomSecretKey();
      writeFileSync(file, JSON.stringify({ secret: b64(this.secret) }), { mode: 0o600 });
    }
    const pub = ed25519.getPublicKey(this.secret);
    this.pubKey = b64(pub);
    this.hubId = base32(pub);
  }

  private async call(method: string, path: string, payload?: unknown): Promise<any> {
    const raw = payload === undefined ? '' : JSON.stringify(payload);
    const ts = String(Date.now());
    const msg = utf8(`${ts}.${method}.${path.split('?')[0]}.${hex(sha256(utf8(raw)))}`);
    const res = await this.fetchFn(this.relayUrl + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-device': this.pubKey, 'x-ts': ts, 'x-sig': b64(ed25519.sign(msg, this.secret)) },
      body: raw || undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(json.error ?? `server said ${res.status}`);
    return json;
  }

  register = () => this.call('POST', '/v1/hub/register', { hubId: this.hubId, pubKey: this.pubKey });
  phones = (): Promise<Array<{ deviceId: string; pairedAt: number }>> => this.call('GET', '/v1/hub/phones');

  /** A QR for the phone to scan: who the hub is, a single-use token, and where the server is. */
  async pairingQr(): Promise<{ qr: string; payload: string }> {
    await this.register();
    const token = randomBytes(16).toString('hex');
    await this.call('POST', '/v1/hub/pair-token', { hubId: this.hubId, token });
    const payload = JSON.stringify({ v: 1, hub: this.hubId, key: this.pubKey, token, relay: this.relayUrl });
    return { qr: await QRCode.toDataURL(payload, { margin: 1, width: 260 }), payload };
  }

  async send(text: string, alert: Alert): Promise<void> {
    await this.call('POST', '/v1/hub/push', { text: text.slice(0, 300), severity: alert.severity });
  }
}
