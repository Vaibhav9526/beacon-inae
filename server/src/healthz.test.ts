import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, before, after } from 'node:test';
import { AlertService } from './alerts.ts';
import { createApp } from './app.ts';
import { openDb } from './db.ts';
import { DryRunPusher } from './fcm.ts';
import { loadServerKey } from './keys.ts';
import { heuristic } from './moderation.ts';
import { ReportService } from './reports.ts';

const key = loadServerKey(':memory:');
const db = openDb(':memory:');
const dataDir = mkdtempSync(join(tmpdir(), 'beacon-h-'));
let server: Server;
let base = '';

before(async () => {
  const app = createApp({
    db,
    key,
    alerts: new AlertService(key),
    reports: new ReportService(db, dataDir, { screen: async (i) => heuristic(i, 'test') }),
    pusher: new DryRunPusher(),
    modToken: 'mod-secret',
    dataDir,
    version: '9.9.9',
  });
  server = createServer((req, res) => void app.handle(req, res, 1024 * 1024));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => server.close());

test('GET /healthz is open and returns ok, uptime and version', async () => {
  const res = await fetch(base + '/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const j = (await res.json()) as { ok: boolean; uptime: number; version: string };
  assert.equal(j.ok, true);
  assert.equal(j.version, '9.9.9');
  assert.equal(typeof j.uptime, 'number');
});

test('the moderator queue rejects a wrong token of the same length and a missing one', async () => {
  const wrong = await fetch(base + '/v1/mod/queue', { headers: { authorization: 'Bearer mod-secreX' } });
  assert.equal(wrong.status, 401);
  const none = await fetch(base + '/v1/mod/queue');
  assert.equal(none.status, 401);
  const ok = await fetch(base + '/v1/mod/queue', { headers: { authorization: 'Bearer mod-secret' } });
  assert.equal(ok.status, 200);
});
