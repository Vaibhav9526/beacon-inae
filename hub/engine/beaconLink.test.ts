import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { BeaconLink } from './beaconLink.ts';
import type { Alert } from './types.ts';

interface Call {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: string;
}

const fakeFetch = (calls: Call[]) =>
  (async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body == null ? undefined : String(init.body),
    });
    return { ok: true, status: 200, text: async () => '{}' } as unknown as Response;
  }) as typeof fetch;

const RELAY = 'http://127.0.0.1:8787';
const utf8 = (s: string) => new TextEncoder().encode(s);

const signedMsg = (c: Call) => {
  const path = c.url.replace(RELAY, '');
  return utf8(`${c.headers['x-ts']}.${c.method}.${path.split('?')[0]}.${Buffer.from(sha256(utf8(c.body ?? ''))).toString('hex')}`);
};

const newLink = (calls: Call[]) =>
  new BeaconLink(mkdtempSync(join(tmpdir(), 'link-')), RELAY, fakeFetch(calls));

test('register signs its request; the signature verifies with @noble/curves ed25519', async () => {
  const calls: Call[] = [];
  const link = newLink(calls);
  await link.register();
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.url, `${RELAY}/v1/hub/register`);
  assert.equal(c.method, 'POST');
  assert.equal(c.headers['content-type'], 'application/json');
  assert.ok(c.headers['x-device'] && c.headers['x-ts'] && c.headers['x-sig'], 'x-device, x-ts and x-sig are all present');
  assert.equal(c.headers['x-device'], link.pubKey);
  const pub = Buffer.from(c.headers['x-device'], 'base64');
  const sigGiven = Buffer.from(c.headers['x-sig'], 'base64');
  const msg = signedMsg(c);
  assert.ok(ed25519.verify(sigGiven, msg, pub), 'the signature is over `${ts}.${METHOD}.${path}.${sha256hex(body)}`');
  assert.ok(!ed25519.verify(sigGiven, utf8(`${c.headers['x-ts']}.GET./v1/hub/register.x`), pub), 'a tampered message does not verify');
  assert.deepEqual(JSON.parse(c.body!), { hubId: link.hubId, pubKey: link.pubKey });
});

test('pairingQr registers, posts a pair token and returns a scannable payload', async () => {
  const calls: Call[] = [];
  const link = newLink(calls);
  const { qr, payload } = await link.pairingQr();
  assert.match(qr, /^data:image\/png;base64,/);
  const token = (JSON.parse(payload) as { token: string }).token;
  assert.equal(calls.length, 2, 'one call to register, one pair-token call');
  assert.equal(calls[0].url, `${RELAY}/v1/hub/register`);
  assert.equal(calls[1].url, `${RELAY}/v1/hub/pair-token`);
  for (const c of calls) {
    const pub = Buffer.from(c.headers['x-device'], 'base64');
    assert.ok(ed25519.verify(Buffer.from(c.headers['x-sig'], 'base64'), signedMsg(c), pub), `${c.url} is signed`);
  }
  assert.match(calls[1].body!, new RegExp(`"hubId":"${link.hubId}"`));
  assert.ok(calls[1].body!.includes(token));
  assert.equal(payload, JSON.stringify({ v: 1, hub: link.hubId, key: link.pubKey, token, relay: RELAY }));
});

test('send() pushes the short text with severity, signed', async () => {
  const calls: Call[] = [];
  const link = newLink(calls);
  const alert: Alert = {
    id: 'a1',
    severity: 'severe',
    title: 'Flood',
    body: 'Water level rising',
    channels: ['beacon'],
    signals: [],
    at: Date.now(),
    status: 'pending-approval',
  };
  await link.send('Flood warning: move now', alert);
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.url, `${RELAY}/v1/hub/push`);
  assert.equal(c.method, 'POST');
  assert.deepEqual(JSON.parse(c.body!), { text: 'Flood warning: move now', severity: 'severe' });
  const pub = Buffer.from(c.headers['x-device'], 'base64');
  assert.ok(ed25519.verify(Buffer.from(c.headers['x-sig'], 'base64'), signedMsg(c), pub));
});

test('hubId is 52 lowercase base32 characters', () => {
  const link = newLink([]);
  assert.match(link.hubId, /^[a-z2-7]{52}$/);
  assert.ok(!['0', '1', '8', '9'].some((d) => link.hubId.includes(d)), 'the base32 alphabet has no 0, 1, 8 or 9');
});

test('a second BeaconLink in the same directory reuses the identity file', async () => {
  const calls: Call[] = [];
  const dir = mkdtempSync(join(tmpdir(), 'link-'));
  const first = new BeaconLink(dir, RELAY, fakeFetch(calls));
  const file = join(dir, 'hub-identity.json');
  const written = readFileSync(file, 'utf8');
  const second = new BeaconLink(dir, RELAY, fakeFetch(calls));
  assert.equal(second.hubId, first.hubId);
  assert.equal(second.pubKey, first.pubKey);
  assert.equal(readFileSync(file, 'utf8'), written, 'the secret on disk did not change');
  const fresh = new BeaconLink(mkdtempSync(join(tmpdir(), 'link-')), RELAY, fakeFetch(calls));
  assert.notEqual(fresh.hubId, first.hubId, 'a different directory silently mints a new identity');
});
