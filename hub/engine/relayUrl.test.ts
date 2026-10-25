import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { HubApp, cleanRelayUrl } from './app.ts';
import { BeaconLink } from './beaconLink.ts';

test('cleanRelayUrl keeps http and https addresses and drops trailing slashes, query and fragment', () => {
  assert.equal(cleanRelayUrl('https://beacon.example.org/'), 'https://beacon.example.org');
  assert.equal(cleanRelayUrl('  https://beacon.example.org///  '), 'https://beacon.example.org');
  assert.equal(cleanRelayUrl('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
  assert.equal(cleanRelayUrl('https://x.up.railway.app/base/?a=1#b'), 'https://x.up.railway.app/base');
});

test('cleanRelayUrl rejects other schemes, junk and empty input with a readable message', () => {
  for (const bad of ['ftp://x.org', 'javascript:alert(1)', 'beacon.example.org', '', 'https://']) {
    assert.throws(() => cleanRelayUrl(bad), /relay address/, bad);
  }
});

test('BeaconLink.setUrl changes where calls go, and the hub identity stays the same', async () => {
  const seen: string[] = [];
  const fetchFn = (async (url: string) => {
    seen.push(url);
    return new Response('{"ok":true}', { status: 200 });
  }) as unknown as typeof fetch;
  const link = new BeaconLink(mkdtempSync(join(tmpdir(), 'link-url-')), 'http://a.test', fetchFn);
  const id = link.hubId;
  link.setUrl('https://b.test');
  assert.equal(link.url, 'https://b.test');
  assert.equal(link.hubId, id);
  await link.register();
  assert.ok(seen[0].startsWith('https://b.test/v1/hub/register'), seen[0]);
});

let relay: Server;
let relayUrl = '';
let mode: 'ok' | 'html' | 'not-beacon' = 'ok';

before(async () => {
  relay = createServer((req, res) => {
    if (req.url !== '/healthz') {
      res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
      return;
    }
    if (mode === 'html') return void res.writeHead(200, { 'content-type': 'text/html' }).end('<html>hello</html>');
    if (mode === 'not-beacon') return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":false}');
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true,"uptime":3,"version":"1.0.0"}');
  });
  await new Promise<void>((r) => relay.listen(0, '127.0.0.1', r));
  relayUrl = `http://127.0.0.1:${(relay.address() as { port: number }).port}`;
});
after(() => relay.close());

test('the hub saves a new relay address, rewrites secrets.json and points its link at it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-relay-'));
  const app = new HubApp({ dir, offline: true, interactive: false });
  assert.equal(app.setRelayUrl('https://new.example.org/'), 'https://new.example.org');
  assert.equal(app.relayUrl, 'https://new.example.org');
  assert.equal(app.link.url, 'https://new.example.org');
  const saved = JSON.parse(readFileSync(join(dir, 'secrets.json'), 'utf8'));
  assert.equal(saved.relayUrl, 'https://new.example.org');
  assert.equal(app.state().connections.beacon.relayUrl, 'https://new.example.org');
  assert.throws(() => app.setRelayUrl('ftp://nope'), /http:\/\/ or https:\/\//);
  assert.equal(app.relayUrl, 'https://new.example.org', 'a rejected address changes nothing');
  const again = new HubApp({ dir, offline: true, interactive: false });
  assert.equal(again.relayUrl, 'https://new.example.org', 'the choice survives a restart');
});

test('checkRelay reports a Beacon server as ok, with timing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-check-'));
  const app = new HubApp({ dir, offline: true, interactive: false });
  mode = 'ok';
  const r = await app.checkRelay(relayUrl);
  assert.equal(r.ok, true);
  assert.equal(typeof r.ms, 'number');
  assert.equal(r.error, undefined);
});

test('checkRelay explains the failures: wrong server, not JSON, and nothing listening', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-check2-'));
  const app = new HubApp({ dir, offline: true, interactive: false });
  mode = 'html';
  const html = await app.checkRelay(relayUrl);
  assert.equal(html.ok, false);
  assert.match(html.error!, /not a Beacon server/);
  mode = 'not-beacon';
  assert.match((await app.checkRelay(relayUrl)).error!, /not a Beacon server/);
  mode = 'ok';
  const gone = await app.checkRelay('http://127.0.0.1:1');
  assert.equal(gone.ok, false);
  assert.match(gone.error!, /could not reach/);
});

test('checkRelay with no argument checks the saved address, and rejects a bad one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-check3-'));
  const app = new HubApp({ dir, offline: true, interactive: false });
  app.setRelayUrl(relayUrl);
  mode = 'ok';
  assert.equal((await app.checkRelay()).ok, true);
  await assert.rejects(app.checkRelay('nonsense'), /relay address/);
});
