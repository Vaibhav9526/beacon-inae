import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import { AlertService, cachedFetch } from './alerts.ts';
import { createApp } from './app.ts';
import { openDb } from './db.ts';
import { DryRunPusher, type Pusher, type PushMessage } from './fcm.ts';
import { loadServerKey, sha256Hex } from './keys.ts';
import { heuristic } from './moderation.ts';
import { hubIdFor } from './relay.ts';
import { ReportService } from './reports.ts';

// The server and every signing client read this clock, so a test can jump forward in time.
let clock = Date.now();

/** A stand-in for FCM that records what would have been sent. */
class FakeFcm implements Pusher {
  sent: PushMessage[] = [];
  async send(m: PushMessage) {
    this.sent.push(m);
    return true;
  }
}

async function startApp(pusher: Pusher = new FakeFcm()) {
  clock = Date.now();
  const key = loadServerKey(':memory:');
  const db = openDb(':memory:');
  const alerts = new AlertService(key, cachedFetch(60_000, async () => ({ ok: true, text: async () => '{}', json: async () => ({}) })));
  const reports = new ReportService(db, mkdtempSync(join(tmpdir(), 'beacon-relay-')), { screen: async (i) => heuristic(i, 'test') });
  const app = createApp({ db, key, alerts, reports, pusher, dataDir: mkdtempSync(join(tmpdir(), 'beacon-relay-d-')), now: () => clock });
  const server: Server = createServer((req, res) => void app.handle(req, res, 20 * 1024 * 1024));
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    base,
    db,
    pusher,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
type App = Awaited<ReturnType<typeof startApp>>;

/** A hub or phone: an Ed25519 identity that signs every request the same way the apps do. */
interface Who {
  key: string;
  call(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }>;
}

function identity(app: App): Who {
  const k = ed25519.keygen();
  const key = Buffer.from(k.publicKey).toString('base64');
  return {
    key,
    async call(method, path, body) {
      const raw = body === undefined ? '' : JSON.stringify(body);
      const ts = String(clock);
      const signedPath = path.split('?')[0]; // the server signs the path without its query string
      const msg = new TextEncoder().encode(`${ts}.${method}.${signedPath}.${sha256Hex(raw)}`);
      const sig = Buffer.from(ed25519.sign(msg, k.secretKey)).toString('base64');
      const res = await fetch(app.base + path, {
        method,
        headers: { 'x-device': key, 'x-ts': ts, 'x-sig': sig, 'content-type': 'application/json' },
        body: raw || undefined,
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
  };
}

const b64 = (s: string) => Buffer.from(s).toString('base64');
const token = () => randomBytes(16).toString('hex');

async function registerHub(hub: Who): Promise<string> {
  const hubId = hubIdFor(hub.key);
  assert.equal((await hub.call('POST', '/v1/hub/register', { hubId, pubKey: hub.key })).status, 200);
  return hubId;
}

/** The hub issues a token, the phone redeems it. Returns the phone's pair response. */
async function pairPhone(hub: Who, phone: Who, hubId: string, t = token()) {
  assert.equal((await hub.call('POST', '/v1/hub/pair-token', { hubId, token: t })).status, 200);
  return phone.call('POST', '/v1/hub/pair', { hubId, pairToken: t });
}

test('hub ids are unpadded base32 of the 32-byte public key', () => {
  assert.equal(hubIdFor(Buffer.alloc(32).toString('base64')), 'a'.repeat(52));
  assert.match(hubIdFor(Buffer.from(ed25519.keygen().publicKey).toString('base64')), /^[a-z2-7]{52}$/);
});

test('pairing happy path: register, pair, list, mail both ways, unpair', async () => {
  const app = await startApp();
  try {
    const hub = identity(app);
    const phone = identity(app);
    const hubId = hubIdFor(hub.key);
    assert.equal((await hub.call('POST', '/v1/hub/register', { hubId, pubKey: hub.key })).body.hubId, hubId);
    assert.equal((await hub.call('POST', '/v1/hub/register', { hubId, pubKey: hub.key })).status, 200, 'register is idempotent');
    assert.equal((await hub.call('POST', '/v1/hub/register', { hubId: 'a'.repeat(52), pubKey: hub.key })).status, 400, 'hubId must match the key');

    assert.equal((await phone.call('POST', '/v1/devices', { pushToken: 'tok-phone' })).status, 200);
    const paired = await pairPhone(hub, phone, hubId);
    assert.equal(paired.status, 200);
    assert.equal(paired.body.hubPubKey, hub.key);

    const phones = await hub.call('GET', '/v1/hub/phones');
    assert.deepEqual(phones.body.map((p: any) => p.deviceId), [phone.key]);
    assert.equal(typeof phones.body[0].pairedAt, 'number');

    assert.equal((await phone.call('POST', '/v1/mail/send', { to: `hub:${hubId}`, blob: b64('from phone') })).status, 200);
    const atHub = await hub.call('GET', '/v1/mail/inbox?since=0');
    assert.equal(atHub.body.length, 1);
    assert.equal(atHub.body[0].from, `phone:${phone.key}`);
    assert.equal(atHub.body[0].blob, b64('from phone'));

    assert.equal((await hub.call('POST', '/v1/mail/send', { to: `phone:${phone.key}`, blob: b64('from hub') })).status, 200);
    const atPhone = await phone.call('GET', '/v1/mail/inbox?since=0');
    assert.equal(atPhone.body.length, 1);
    assert.equal(atPhone.body[0].from, `hub:${hubId}`);
    assert.deepEqual((await phone.call('GET', `/v1/mail/inbox?since=${atPhone.body[0].at}`)).body, [], 'since is exclusive');

    assert.equal((await hub.call('DELETE', `/v1/hub/phones/${encodeURIComponent(phone.key)}`)).status, 200);
    assert.equal((await hub.call('POST', '/v1/mail/send', { to: `phone:${phone.key}`, blob: b64('late') })).status, 403, 'unpaired phone is no longer reachable');
    assert.deepEqual((await hub.call('GET', '/v1/hub/phones')).body, []);
    assert.equal((await hub.call('DELETE', `/v1/hub/phones/${encodeURIComponent(phone.key)}`)).status, 404);
  } finally {
    app.close();
  }
});

test('pair tokens are single use, expire after 15 minutes, and only the hub may issue them', async () => {
  const app = await startApp();
  try {
    const hub = identity(app);
    const a = identity(app);
    const b = identity(app);
    const hubId = await registerHub(hub);

    const once = token();
    assert.equal((await pairPhone(hub, a, hubId, once)).status, 200);
    assert.equal((await b.call('POST', '/v1/hub/pair', { hubId, pairToken: once })).status, 409, 'reused token');

    const stale = token();
    assert.equal((await hub.call('POST', '/v1/hub/pair-token', { hubId, token: stale })).status, 200);
    clock += 15 * 60_000 + 1;
    assert.equal((await b.call('POST', '/v1/hub/pair', { hubId, pairToken: stale })).status, 410, 'expired token');

    assert.equal((await b.call('POST', '/v1/hub/pair', { hubId, pairToken: 'f'.repeat(32) })).status, 404, 'unknown token');
    assert.equal((await a.call('POST', '/v1/hub/pair-token', { hubId, token: token() })).status, 403, 'a phone cannot issue tokens');
  } finally {
    app.close();
  }
});

test('mail is rejected unless the sender is linked to the recipient', async () => {
  const app = await startApp();
  try {
    const hub = identity(app);
    const linked = identity(app);
    const loner = identity(app);
    const hubId = await registerHub(hub);
    assert.equal((await pairPhone(hub, linked, hubId)).status, 200);

    assert.equal((await loner.call('POST', '/v1/mail/send', { to: `hub:${hubId}`, blob: b64('x') })).status, 403, 'unpaired phone to hub');
    assert.equal((await hub.call('POST', '/v1/mail/send', { to: `phone:${loner.key}`, blob: b64('x') })).status, 403, 'hub to unpaired phone');
    assert.equal((await linked.call('POST', '/v1/mail/send', { to: `phone:${loner.key}`, blob: b64('x') })).status, 403, 'phone to phone');
    assert.equal((await hub.call('POST', '/v1/mail/send', { to: `hub:${hubId}`, blob: b64('x') })).status, 403, 'hub to hub');
    assert.equal((await linked.call('POST', '/v1/mail/send', { to: 'nobody', blob: b64('x') })).status, 400);
    assert.equal((await linked.call('POST', '/v1/mail/send', { to: `hub:${hubId}` })).status, 400, 'blob is required');
  } finally {
    app.close();
  }
});

test('blobs are capped at 8 KB and must be base64', async () => {
  const app = await startApp();
  try {
    const hub = identity(app);
    const phone = identity(app);
    const hubId = await registerHub(hub);
    assert.equal((await pairPhone(hub, phone, hubId)).status, 200);
    const to = `hub:${hubId}`;
    assert.equal((await phone.call('POST', '/v1/mail/send', { to, blob: Buffer.alloc(8192, 1).toString('base64') })).status, 200);
    assert.equal((await phone.call('POST', '/v1/mail/send', { to, blob: Buffer.alloc(8193, 1).toString('base64') })).status, 413);
    assert.equal((await phone.call('POST', '/v1/mail/send', { to, blob: 'not base64!' })).status, 400);
  } finally {
    app.close();
  }
});

test('push fans out through FCM to every linked phone with a token, and stores the rest', async () => {
  const fcm = new FakeFcm();
  const app = await startApp(fcm);
  try {
    const hub = identity(app);
    const hubId = await registerHub(hub);
    const withToken = [identity(app), identity(app)];
    const noToken = identity(app);
    const outsider = identity(app);
    for (const [i, p] of withToken.entries()) {
      assert.equal((await p.call('POST', '/v1/devices', { pushToken: `tok-${i}` })).status, 200);
      assert.equal((await pairPhone(hub, p, hubId)).status, 200);
    }
    assert.equal((await pairPhone(hub, noToken, hubId)).status, 200);
    assert.equal((await outsider.call('POST', '/v1/devices', { pushToken: 'tok-outsider' })).status, 200);

    const res = await hub.call('POST', '/v1/hub/push', { text: 'Flood warning near Ward 4', severity: 'warning' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, sent: 2, stored: 1 });
    assert.deepEqual(fcm.sent.map((m) => m.token).sort(), ['tok-0', 'tok-1']);
    assert.equal(fcm.sent[0]!.body, 'Flood warning near Ward 4');

    const stored = await noToken.call('GET', '/v1/mail/inbox?since=0');
    assert.equal(stored.body.length, 1);
    assert.equal(stored.body[0].kind, 'push');
    assert.equal(stored.body[0].from, `hub:${hubId}`);
    assert.deepEqual(JSON.parse(Buffer.from(stored.body[0].blob, 'base64').toString()), { text: 'Flood warning near Ward 4', severity: 'warning' });
    assert.deepEqual((await outsider.call('GET', '/v1/mail/inbox?since=0')).body, [], 'unpaired phones get nothing');
  } finally {
    app.close();
  }
});

test('without FCM configured, pushes land in the linked phones mailboxes', async () => {
  const app = await startApp(new DryRunPusher());
  try {
    const hub = identity(app);
    const phone = identity(app);
    const hubId = await registerHub(hub);
    assert.equal((await pairPhone(hub, phone, hubId)).status, 200);
    assert.deepEqual((await hub.call('POST', '/v1/hub/push', { text: 'Stay indoors', severity: 'severe' })).body, { ok: true, sent: 0, stored: 1 });
    const inbox = await phone.call('GET', '/v1/mail/inbox?since=0');
    assert.equal(inbox.body[0].kind, 'push');
    assert.equal(JSON.parse(Buffer.from(inbox.body[0].blob, 'base64').toString()).text, 'Stay indoors');
  } finally {
    app.close();
  }
});

test('push input is validated, only hubs may push, and a hub is limited to 30 per hour', async () => {
  const app = await startApp();
  try {
    const hub = identity(app);
    const phone = identity(app);
    const hubId = await registerHub(hub);
    assert.equal((await pairPhone(hub, phone, hubId)).status, 200);

    assert.equal((await phone.call('POST', '/v1/hub/push', { text: 'hi', severity: 'info' })).status, 403);
    assert.equal((await hub.call('POST', '/v1/hub/push', { text: 'x'.repeat(301), severity: 'info' })).status, 400);
    assert.equal((await hub.call('POST', '/v1/hub/push', { text: 'hi', severity: 'loud' })).status, 400);

    for (let i = 0; i < 30; i++) assert.equal((await hub.call('POST', '/v1/hub/push', { text: `update ${i}`, severity: 'info' })).status, 200);
    assert.equal((await hub.call('POST', '/v1/hub/push', { text: 'one too many', severity: 'info' })).status, 429);

    clock += 60 * 60_000 + 1;
    assert.equal((await hub.call('POST', '/v1/hub/push', { text: 'hour later', severity: 'info' })).status, 200, 'window slides');
  } finally {
    app.close();
  }
});

test('mailbox items older than 24 hours are dropped', async () => {
  const app = await startApp();
  try {
    const hub = identity(app);
    const phone = identity(app);
    const hubId = await registerHub(hub);
    assert.equal((await pairPhone(hub, phone, hubId)).status, 200);
    assert.equal((await phone.call('POST', '/v1/mail/send', { to: `hub:${hubId}`, blob: b64('old') })).status, 200);
    clock += 24 * 3600_000 + 1;
    assert.deepEqual((await hub.call('GET', '/v1/mail/inbox?since=0')).body, []);
  } finally {
    app.close();
  }
});
