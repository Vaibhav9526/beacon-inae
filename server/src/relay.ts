import { randomBytes } from 'node:crypto';
import type { Db } from './db.ts';
import { DryRunPusher, type Pusher } from './fcm.ts';
import { HttpError } from './http.ts';

/**
 * Hub <-> phone relay. The server only routes opaque encrypted blobs and short push texts; it never sees health data.
 * A caller is identified by the Ed25519 key that signed its request (x-device = base64 public key).
 * A hub is a key that has registered (its id is base32 of that key); any other key is a phone.
 */

const PAIR_TTL_MS = 15 * 60_000;
const MAIL_TTL_MS = 24 * 3600_000;
const MAX_BLOB_BYTES = 8 * 1024;
const MAX_PUSH_CHARS = 300;
const PUSH_PER_HOUR = 30;
const SEVERITIES = ['info', 'watch', 'warning', 'severe'];
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** Hub id: RFC 4648 base32 (lowercase, unpadded) of the hub's 32-byte Ed25519 public key. */
export function hubIdFor(pubKeyB64: string): string {
  const bytes = Buffer.from(pubKeyB64, 'base64');
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

const bad = (message: string) => new HttpError(400, message);

function checkBlob(blob: unknown): string {
  if (typeof blob !== 'string' || blob.length === 0 || blob.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(blob)) {
    throw bad('blob must be non-empty base64');
  }
  if (Buffer.from(blob, 'base64').length > MAX_BLOB_BYTES) throw new HttpError(413, 'blob too large (max 8 KB)');
  return blob;
}

interface MailRow {
  id: string;
  from: string;
  kind: string;
  blob: string;
  at: number;
}

export class RelayService {
  /** Push timestamps per hub for the hourly limit. In memory, like the report rate limits. */
  private pushLog = new Map<string, number[]>();

  constructor(
    private db: Db,
    private pusher: Pusher,
    private now: () => number = () => Date.now(),
  ) {}

  /** The hub id for a key that has registered as a hub, or undefined for a phone. */
  hubOf(pub: string): string | undefined {
    return (this.db.prepare('SELECT hub_id FROM hubs WHERE pub_key = ?').get(pub) as { hub_id: string } | undefined)?.hub_id;
  }

  private requireHub(pub: string): string {
    const hub = this.hubOf(pub);
    if (!hub) throw new HttpError(403, 'hub not registered');
    return hub;
  }

  /** Mailbox name of the caller: 'hub:<id>' or 'phone:<deviceId>'. */
  private addressOf(pub: string): string {
    const hub = this.hubOf(pub);
    return hub ? `hub:${hub}` : `phone:${pub}`;
  }

  private isLinked(hub: string, device: string): boolean {
    return !!this.db.prepare('SELECT 1 AS ok FROM hub_links WHERE hub_id = ? AND device = ?').get(hub, device);
  }

  /** POST /v1/hub/register {hubId, pubKey}: signed by the hub's own key. Idempotent. */
  register(pub: string, b: { hubId?: string; pubKey?: string }) {
    if (b.pubKey !== pub) throw bad('pubKey must be the signing key');
    const hubId = hubIdFor(pub);
    if (b.hubId !== hubId) throw bad('hubId must be base32 of pubKey');
    this.db.prepare('INSERT OR IGNORE INTO hubs (hub_id, pub_key, created) VALUES (?,?,?)').run(hubId, pub, this.now());
    return { ok: true, hubId };
  }

  /** POST /v1/hub/pair-token {hubId, token}: the hub puts a fresh 16-byte hex token in its QR code. */
  issuePairToken(pub: string, b: { hubId?: string; token?: string }) {
    const hub = this.requireHub(pub);
    if (b.hubId !== hub) throw new HttpError(403, 'a hub can only issue tokens for itself');
    if (!/^[0-9a-f]{32}$/.test(b.token ?? '')) throw bad('token must be 16 random bytes as hex');
    const expiresAt = this.now() + PAIR_TTL_MS;
    const r = this.db.prepare('INSERT OR IGNORE INTO hub_pair_tokens (token, hub_id, expires, used_by) VALUES (?,?,?,NULL)').run(b.token!, hub, expiresAt);
    if (Number(r.changes) === 0) throw new HttpError(409, 'token already issued');
    return { ok: true, expiresAt };
  }

  /** POST /v1/hub/pair {hubId, pairToken}: signed by the phone. Links the phone to the hub. */
  pair(phone: string, b: { hubId?: string; pairToken?: string }) {
    if (this.hubOf(phone)) throw bad('a hub cannot pair with another hub');
    const row = this.db.prepare('SELECT hub_id, expires, used_by FROM hub_pair_tokens WHERE token = ?').get(String(b.pairToken ?? '')) as
      | { hub_id: string; expires: number; used_by: string | null }
      | undefined;
    if (!row) throw new HttpError(404, 'unknown pair token');
    if (row.used_by) throw new HttpError(409, 'pair token already used');
    if (this.now() > row.expires) throw new HttpError(410, 'pair token expired');
    if (b.hubId !== row.hub_id) throw bad('pair token belongs to another hub');
    this.db.prepare('UPDATE hub_pair_tokens SET used_by = ? WHERE token = ?').run(phone, b.pairToken!);
    const dev = this.db.prepare('SELECT push_token FROM devices WHERE device = ?').get(phone) as { push_token: string | null } | undefined;
    this.db
      .prepare('INSERT OR REPLACE INTO hub_links (hub_id, device, push_token, paired_at) VALUES (?,?,?,?)')
      .run(row.hub_id, phone, dev?.push_token ?? null, this.now());
    const hub = this.db.prepare('SELECT pub_key FROM hubs WHERE hub_id = ?').get(row.hub_id) as { pub_key: string };
    return { ok: true, hubId: row.hub_id, hubPubKey: hub.pub_key };
  }

  /** POST /v1/mail/send {to: 'hub:<id>' | 'phone:<deviceId>', blob}: the sender must be linked to the recipient. */
  send(pub: string, b: { to?: string; blob?: string }) {
    const m = /^(hub|phone):(.+)$/.exec(String(b.to ?? ''));
    if (!m) throw bad('to must be hub:<id> or phone:<deviceId>');
    const blob = checkBlob(b.blob);
    const hub = this.hubOf(pub);
    // a phone may write to its own hub; a hub may write to its own phones; nothing else is linked
    const linked = hub ? m[1] === 'phone' && this.isLinked(hub, m[2]!) : m[1] === 'hub' && this.isLinked(m[2]!, pub);
    if (!linked) throw new HttpError(403, 'recipient is not linked to you');
    const id = randomBytes(8).toString('hex');
    const at = this.now();
    this.db
      .prepare('INSERT INTO mail (id, recipient, sender, kind, blob, at) VALUES (?,?,?,?,?,?)')
      .run(id, `${m[1]}:${m[2]}`, this.addressOf(pub), 'mail', blob, at);
    return { id, at };
  }

  /** GET /v1/mail/inbox?since=<ms>: items strictly newer than `since`. Items older than 24h are dropped. */
  inbox(pub: string, since: number): MailRow[] {
    const me = this.addressOf(pub);
    this.db.prepare('DELETE FROM mail WHERE recipient = ? AND at < ?').run(me, this.now() - MAIL_TTL_MS);
    return this.db
      .prepare('SELECT id, sender AS "from", kind, blob, at FROM mail WHERE recipient = ? AND at > ? ORDER BY at, id')
      .all(me, since) as unknown as MailRow[];
  }

  /**
   * POST /v1/hub/push {text, severity}: fan out to every phone linked to the hub.
   * Phones without a push token, and everyone when FCM is not configured, get the text in their mailbox instead.
   */
  async push(pub: string, b: { text?: string; severity?: string }) {
    const hub = this.requireHub(pub);
    if (typeof b.text !== 'string' || b.text.trim() === '' || b.text.length > MAX_PUSH_CHARS) {
      throw bad(`text must be 1-${MAX_PUSH_CHARS} characters`);
    }
    if (!SEVERITIES.includes(b.severity ?? '')) throw bad('severity must be info, watch, warning or severe');
    const text = b.text;
    const severity = b.severity!;

    const t = this.now();
    const recent = (this.pushLog.get(hub) ?? []).filter((x) => x > t - 3600_000);
    if (recent.length >= PUSH_PER_HOUR) {
      this.pushLog.set(hub, recent);
      throw new HttpError(429, `push rate limit: ${PUSH_PER_HOUR} per hour per hub`);
    }
    recent.push(t);
    this.pushLog.set(hub, recent);

    const phones = this.db
      .prepare('SELECT l.device AS device, COALESCE(d.push_token, l.push_token) AS token FROM hub_links l LEFT JOIN devices d ON d.device = l.device WHERE l.hub_id = ?')
      .all(hub) as { device: string; token: string | null }[];
    const fcm = !(this.pusher instanceof DryRunPusher);
    let sent = 0;
    let stored = 0;
    for (const p of phones) {
      if (fcm && p.token && (await this.pusher.send({ token: p.token, title: `Hub: ${severity}`, body: text, data: { kind: 'hub', hubId: hub, severity } }))) {
        sent++;
        continue;
      }
      this.db
        .prepare('INSERT INTO mail (id, recipient, sender, kind, blob, at) VALUES (?,?,?,?,?,?)')
        .run(randomBytes(8).toString('hex'), `phone:${p.device}`, `hub:${hub}`, 'push', Buffer.from(JSON.stringify({ text, severity })).toString('base64'), t);
      stored++;
    }
    return { ok: true, sent, stored };
  }

  /** GET /v1/hub/phones: the phones paired with this hub. */
  phones(pub: string) {
    const hub = this.requireHub(pub);
    return this.db
      .prepare('SELECT device AS deviceId, paired_at AS pairedAt FROM hub_links WHERE hub_id = ? ORDER BY paired_at')
      .all(hub) as unknown as { deviceId: string; pairedAt: number }[];
  }

  /** DELETE /v1/hub/phones/:deviceId: unpair a phone. */
  unpair(pub: string, device: string) {
    const hub = this.requireHub(pub);
    const r = this.db.prepare('DELETE FROM hub_links WHERE hub_id = ? AND device = ?').run(hub, device);
    if (Number(r.changes) === 0) throw new HttpError(404, 'phone not paired with this hub');
    return { ok: true };
  }
}
