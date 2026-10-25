import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, before, after } from 'node:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import { AlertService, cachedFetch } from './alerts.ts';
import { createApp, pushNewAlerts } from './app.ts';
import { openDb } from './db.ts';
import { DryRunPusher } from './fcm.ts';
import { loadServerKey, sha256Hex } from './keys.ts';
import { heuristic, type Screener } from './moderation.ts';
import { ReportService } from './reports.ts';

// ---- fakes for the outside world ----
const QUAKES = {
  features: [{ id: 'q1', properties: { mag: 6.4, place: '10 km N of Testville', time: Date.now() - 600000, url: '' }, geometry: { coordinates: [77.3, 28.9, 12] } }],
};
const RSS = `<rss><channel><item><title>Lightning warning</title><category>Met</category><link>https://x/FetchXMLFile?identifier=1</link>
<author>c@ndma.gov.in (Delhi SDMA)</author><guid isPermaLink="false">1</guid><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
const CAP = `<cap:alert><cap:info><cap:language>en-IN</cap:language><cap:severity>Severe</cap:severity><cap:headline>Lightning likely</cap:headline>
<cap:instruction>Stay indoors.</cap:instruction><cap:area><cap:areaDesc>North Delhi</cap:areaDesc></cap:area></cap:info></cap:alert>`;
let upstreamHits = 0;
const upstream = async (url: string) => {
  upstreamHits++;
  const body = url.includes('usgs') ? JSON.stringify(QUAKES) : url.includes('rss_india') ? RSS : url.includes('FetchXMLFile') ? CAP : '{}';
  return { ok: true, text: async () => body, json: async () => JSON.parse(body) };
};

// a screener that approves anything captioned "flood" and sends the rest to humans
const screener: Screener = {
  screen: async (i) =>
    /flood/i.test(i.caption)
      ? { decision: 'approve', category: 'flood', summary: 'Street waterlogged near the market.', concerns: [], authenticity: 'likely', relevant: true, source: 'ai' }
      : heuristic(i, 'test: needs a human'),
};

let server: Server;
let base = '';
const key = loadServerKey(':memory:');
const pusher = new DryRunPusher();
const db = openDb(':memory:');
const alerts = new AlertService(key, cachedFetch(60_000, upstream));
const reports = new ReportService(db, mkdtempSync(join(tmpdir(), 'beacon-')), screener);

before(async () => {
  const app = createApp({ db, key, alerts, reports, pusher, modToken: 'mod-secret', dataDir: mkdtempSync(join(tmpdir(), 'beacon-d-')) });
  server = createServer((req, res) => void app.handle(req, res, 20 * 1024 * 1024));
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => server.close());

// ---- device identity ----
function device() {
  const k = ed25519.keygen();
  const id = Buffer.from(k.publicKey).toString('base64');
  return {
    id,
    async call(method: string, path: string, body?: unknown) {
      const raw = body === undefined ? '' : JSON.stringify(body);
      const ts = String(Date.now());
      const msg = new TextEncoder().encode(`${ts}.${method}.${path}.${sha256Hex(raw)}`);
      const sig = Buffer.from(ed25519.sign(msg, k.secretKey)).toString('base64');
      const res = await fetch(base + path, { method, headers: { 'x-device': id, 'x-ts': ts, 'x-sig': sig, 'content-type': 'application/json' }, body: raw || undefined });
      return { status: res.status, body: (await res.json()) as any };
    },
  };
}
const get = async (path: string, headers: Record<string, string> = {}) => {
  const res = await fetch(base + path, { headers });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
};
const JPEG = Buffer.alloc(2000, 7).toString('base64');
const photo = (caption: string) => ({ kind: 'photo', mime: 'image/jpeg', media: JPEG, caption, lat: 28.61, lon: 77.21, capturedAt: Date.now() - 30_000 });

test('alerts are location-filtered, signed with the server key, and upstream is cached', async () => {
  const before = upstreamHits;
  const delhi = await get('/v1/alerts?lat=28.6&lon=77.2');
  assert.equal(delhi.status, 200);
  const titles = delhi.body.alerts.map((a: any) => a.alert.title);
  assert.ok(titles.includes('Earthquake M6.4'));
  assert.ok(titles.includes('Lightning likely'));
  const pub = new Uint8Array(Buffer.from((await get('/v1/pubkey')).body.publicKey, 'base64'));
  for (const { alert, sig } of delhi.body.alerts) {
    assert.ok(ed25519.verify(new Uint8Array(Buffer.from(sig, 'base64')), new TextEncoder().encode(JSON.stringify(alert)), pub), 'signature must verify');
  }
  const kochi = await get('/v1/alerts?lat=9.9&lon=76.3');
  assert.ok(!kochi.body.alerts.some((a: any) => a.alert.title === 'Lightning likely'), 'Delhi alert must not reach Kochi');
  assert.ok(!kochi.body.alerts.some((a: any) => a.alert.title.startsWith('Earthquake')), 'quake is too far from Kochi');
  const hitsAfterFirst = upstreamHits;
  await get('/v1/alerts?lat=28.6&lon=77.2');
  assert.equal(upstreamHits, hitsAfterFirst, 'second request served from cache');
  assert.ok(hitsAfterFirst > before);
});

test('the moderator console is served as a page (the API behind it still needs the token)', async () => {
  const res = await fetch(base + '/mod');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await res.text(), /Beacon moderators/);
});

test('writes without a valid signature are rejected', async () => {
  const unsigned = await fetch(base + '/v1/devices', { method: 'POST', body: '{}' });
  assert.equal(unsigned.status, 401);
  const d = device();
  assert.equal((await d.call('POST', '/v1/devices', { pushToken: 't', lat: 1, lon: 2 })).status, 200);
  // tamper: sign one body, send another
  const ts = String(Date.now());
  const k = ed25519.keygen();
  const sig = Buffer.from(ed25519.sign(new TextEncoder().encode(`${ts}.POST./v1/devices.${sha256Hex('{"a":1}')}`), k.secretKey)).toString('base64');
  const bad = await fetch(base + '/v1/devices', { method: 'POST', headers: { 'x-device': Buffer.from(k.publicKey).toString('base64'), 'x-ts': ts, 'x-sig': sig }, body: '{"a":2}' });
  assert.equal(bad.status, 401);
});

test('report lifecycle: AI approves, community votes, moderators handle the rest', async () => {
  const author = device();
  const ok = await author.call('POST', '/v1/reports', photo('Flood on main road'));
  assert.equal(ok.status, 202);
  const other = await author.call('POST', '/v1/reports', photo('something odd'));
  await Promise.all(reports.pending);

  const feed = await get('/v1/reports?lat=28.6&lon=77.2');
  assert.equal(feed.body.reports.length, 1, 'only the AI-approved one is public');
  assert.equal(feed.body.reports[0].summary, 'Street waterlogged near the market.');
  assert.equal(feed.body.reports[0].badge, 'new');

  // moderators see the other one with the screening reasons
  assert.equal((await get('/v1/mod/queue')).status, 401);
  const q = await get('/v1/mod/queue', { authorization: 'Bearer mod-secret' });
  assert.equal(q.body.reports.length, 1);
  assert.equal(q.body.reports[0].id, other.body.id);
  assert.ok(q.body.reports[0].aiVerdict.concerns.length > 0);

  // you cannot vote on your own post; five others say real
  const id = ok.body.id;
  assert.equal((await author.call('POST', `/v1/reports/${id}/vote`, { vote: 'real' })).status, 403);
  for (let i = 0; i < 5; i++) assert.equal((await device().call('POST', `/v1/reports/${id}/vote`, { vote: 'real' })).status, 200);
  const verified = (await get('/v1/reports?lat=28.6&lon=77.2')).body.reports[0];
  assert.equal(verified.badge, 'community-verified');
  assert.equal(verified.realVotes, 5);

  // one voter changing their mind is one vote, not two
  const flip = device();
  await flip.call('POST', `/v1/reports/${id}/vote`, { vote: 'real' });
  await flip.call('POST', `/v1/reports/${id}/vote`, { vote: 'fake' });
  assert.equal((await get('/v1/reports?lat=28.6&lon=77.2')).body.reports[0].realVotes, 5);

  // a moderator approves the held report
  const dec = await fetch(base + `/v1/mod/reports/${other.body.id}`, { method: 'POST', headers: { authorization: 'Bearer mod-secret' }, body: JSON.stringify({ decision: 'approve', note: 'checked' }) });
  assert.equal(dec.status, 200);
  assert.equal((await get('/v1/reports?lat=28.6&lon=77.2')).body.reports.length, 2);
});

test('a flood of fake votes pulls a post back for review', async () => {
  const a = device();
  const r = await a.call('POST', '/v1/reports', photo('Flood downtown'));
  await Promise.all(reports.pending);
  for (let i = 0; i < 5; i++) await device().call('POST', `/v1/reports/${r.body.id}/vote`, { vote: 'fake' });
  const feed = (await get('/v1/reports?lat=28.6&lon=77.2')).body.reports as any[];
  assert.ok(!feed.some((x) => x.id === r.body.id));
  const q = (await get('/v1/mod/queue', { authorization: 'Bearer mod-secret' })).body.reports as any[];
  assert.ok(q.some((x) => x.id === r.body.id));
});

test('upload validation: old, future, bad media and rate limits', async () => {
  const d = device();
  assert.equal((await d.call('POST', '/v1/reports', { ...photo('x'), capturedAt: Date.now() - 3 * 86400_000 })).status, 400);
  assert.equal((await d.call('POST', '/v1/reports', { ...photo('x'), capturedAt: Date.now() + 3600_000 })).status, 400);
  assert.equal((await d.call('POST', '/v1/reports', { ...photo('x'), mime: 'application/pdf' })).status, 400);
  assert.equal((await d.call('POST', '/v1/reports', { ...photo('x'), lat: 200 })).status, 400);
  for (let i = 0; i < 10; i++) assert.equal((await d.call('POST', '/v1/reports', photo('spam'))).status, 202);
  assert.equal((await d.call('POST', '/v1/reports', photo('spam'))).status, 429);
});

test('gateway sync stores what the mesh heard and returns official alerts and news cards', async () => {
  const g = device();
  const res = await g.call('POST', '/v1/gateway/sync', {
    location: { lat: 28.6, lon: 77.2 },
    sos: [{ id: 'abc123', name: 'Asha', lat: 28.5, lon: 77.1, note: 'trapped', medical: 'asthma', ts: Date.now() - 5000 }],
    safe: [{ from: 'ff00', name: 'Ravi', family: 'FAMILY1', ts: Date.now() - 1000 }],
    board: [{ id: 'b1', kind: 'need', text: 'insulin near ward 4', nickname: 'Ravi', lat: 28.6, lon: 77.2, ts: Date.now() }],
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.alerts.length > 0);
  assert.ok(res.body.cards.length > 0);
  for (const c of res.body.cards) assert.ok(c.summary.split(/\s+/).length <= 61, 'cards stay around 60 words');
  const sos = await get('/v1/mod/sos', { authorization: 'Bearer mod-secret' });
  assert.equal(sos.body.sos[0].note, 'trapped');
  assert.equal((await get('/v1/family/FAMILY1')).body.safe[0].name, 'Ravi');
  assert.equal((await get('/v1/board?lat=28.6&lon=77.2')).body.posts[0].text, 'insulin near ward 4');
});

test('family location pairing', async () => {
  const kid = device();
  assert.equal((await kid.call('POST', '/v1/family/location', { family: 'abc', name: 'Mia', lat: 1, lon: 2 })).status, 400);
  assert.equal((await kid.call('POST', '/v1/family/location', { family: 'KIDCODE1', name: 'Mia', lat: 28.6, lon: 77.2 })).status, 200);
  const parent = await get('/v1/family/KIDCODE1');
  assert.equal(parent.body.members[0].name, 'Mia');
  assert.equal((await get('/v1/family/OTHERCODE')).body.members.length, 0);
});

test('family safe zones, SOS and in-zone detection', async () => {
  const parent = device();
  const kid = device();
  const zones = [
    { id: 'h', name: 'Home', lat: 28.6, lon: 77.2, radius: 200 },
    { id: 's', name: 'School', lat: 28.7, lon: 77.3, radius: 150 },
  ];
  assert.equal((await parent.call('POST', '/v1/family/zones', { family: 'ZONEFAM1', zones })).status, 200);
  await kid.call('POST', '/v1/family/location', { family: 'ZONEFAM1', name: 'Mia', lat: 28.6005, lon: 77.2004 });
  let fam = (await get('/v1/family/ZONEFAM1')).body;
  assert.equal(fam.members[0].zone, 'Home');
  assert.equal(fam.zones.length, 2);
  await kid.call('POST', '/v1/family/location', { family: 'ZONEFAM1', name: 'Mia', lat: 28.65, lon: 77.25 });
  fam = (await get('/v1/family/ZONEFAM1')).body;
  assert.equal(fam.members[0].zone, null, 'between home and school is outside both');
  assert.equal((await kid.call('POST', '/v1/family/sos', { family: 'ZONEFAM1', name: 'Mia', lat: 28.65, lon: 77.25, note: 'help' })).status, 200);
  fam = (await get('/v1/family/ZONEFAM1')).body;
  assert.equal(fam.safe[0].kind, 'sos');
});

test('push goes to devices in the affected area, once per alert', async () => {
  const near = device();
  await near.call('POST', '/v1/devices', { pushToken: 'tok-delhi', lat: 28.6, lon: 77.2 });
  const far = device();
  await far.call('POST', '/v1/devices', { pushToken: 'tok-kochi', lat: 9.9, lon: 76.3 });
  const n1 = await pushNewAlerts({ db, alerts, pusher });
  assert.ok(n1 >= 2, `expected quake + lightning pushes, got ${n1}`);
  assert.ok(pusher.sent.some((m) => m.token === 'tok-delhi'));
  assert.ok(!pusher.sent.some((m) => m.token === 'tok-kochi' && /Lightning/.test(m.title)));
  const n2 = await pushNewAlerts({ db, alerts, pusher });
  assert.equal(n2, 0, 'no repeats');
});
