import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import { AlertService, cachedFetch } from './alerts.ts';
import { createApp } from './app.ts';
import { cleanText, deviceTag, filterWords, redact } from './chat.ts';
import { openDb } from './db.ts';
import { DryRunPusher } from './fcm.ts';
import { loadServerKey, sha256Hex } from './keys.ts';
import { heuristic } from './moderation.ts';
import { ReportService } from './reports.ts';

let clock = Date.now();
const MOD = 'mod-secret';

async function startApp() {
  clock = Date.now();
  const key = loadServerKey(':memory:');
  const db = openDb(':memory:');
  const alerts = new AlertService(key, cachedFetch(60_000, async () => ({ ok: true, text: async () => '{}', json: async () => ({}) })));
  const reports = new ReportService(db, mkdtempSync(join(tmpdir(), 'beacon-chat-')), { screen: async (i) => heuristic(i, 'test') });
  const app = createApp({ db, key, alerts, reports, pusher: new DryRunPusher(), modToken: MOD, dataDir: mkdtempSync(join(tmpdir(), 'beacon-chat-d-')), now: () => clock });
  const server: Server = createServer((req, res) => void app.handle(req, res, 20 * 1024 * 1024));
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    base,
    db,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
type App = Awaited<ReturnType<typeof startApp>>;

interface Who {
  key: string;
  tag: string;
  call(method: string, path: string, body?: unknown, signIt?: boolean): Promise<{ status: number; body: any }>;
  say(room: string, text: string, nick?: string): Promise<{ status: number; body: any }>;
}

function phone(app: App): Who {
  const k = ed25519.keygen();
  const key = Buffer.from(k.publicKey).toString('base64');
  const call: Who['call'] = async (method, path, body, signIt = true) => {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (signIt) {
      const ts = String(clock);
      const msg = new TextEncoder().encode(`${ts}.${method}.${path.split('?')[0]}.${sha256Hex(raw)}`);
      headers['x-device'] = key;
      headers['x-ts'] = ts;
      headers['x-sig'] = Buffer.from(ed25519.sign(msg, k.secretKey)).toString('base64');
    }
    const res = await fetch(app.base + path, { method, headers, body: raw || undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { key, tag: deviceTag(key), call, say: (room, text, nick) => call('POST', `/v1/chat/${room}`, { text, nick }) };
}

async function mod(app: App, method: string, path: string, body?: unknown) {
  const res = await fetch(app.base + path, { method, headers: { authorization: `Bearer ${MOD}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const list = async (app: App, room = 'global', q = '') => {
  const res = await fetch(`${app.base}/v1/chat/${room}${q}`);
  return { status: res.status, cache: res.headers.get('cache-control'), body: (await res.json()) as any };
};

test('post and list round trip, oldest first, device is a short hash', async () => {
  const app = await startApp();
  try {
    const a = phone(app);
    const r = await a.say('global', '  hello   world  ', '  Asha\u0007  ');
    assert.equal(r.status, 200);
    assert.equal(r.body.message.text, 'hello world');
    assert.equal(r.body.message.nick, 'Asha');
    assert.match(r.body.message.device, /^[0-9a-f]{8}$/);
    assert.equal(r.body.message.device, a.tag);
    assert.notEqual(r.body.message.device, a.key);
    clock += 1000;
    await a.say('global', 'second');
    const l = await list(app);
    assert.equal(l.status, 200);
    assert.equal(l.cache, 'no-store');
    assert.deepEqual(l.body.messages.map((m: any) => m.text), ['hello world', 'second']);
    assert.equal(l.body.messages[1].nick, 'Guest');
    const info = await (await fetch(`${app.base}/v1/chat/global/info`)).json() as any;
    assert.equal(info.count, 2);
    assert.match(info.rules.hi, /112/);
    assert.equal(info.limits.perMinute, 6);
  } finally {
    app.close();
  }
});

test('since cursor returns only newer messages', async () => {
  const app = await startApp();
  try {
    const a = phone(app);
    const m1 = (await a.say('global', 'one')).body.message;
    clock += 5000;
    const m2 = (await a.say('global', 'two')).body.message;
    const l = await list(app, 'global', `?since=${m1.ts}`);
    assert.deepEqual(l.body.messages.map((m: any) => m.id), [m2.id]);
    assert.equal((await list(app, 'global', `?since=${m2.ts}`)).body.messages.length, 0);
    assert.equal((await list(app, 'global', '?limit=1')).body.messages[0].text, 'two');
  } finally {
    app.close();
  }
});

test('phones, emails and urls are redacted', async () => {
  assert.equal(redact('call +91 98765 43210 now').text, 'call [removed] now');
  assert.equal(redact('call 9876543210').text, 'call [removed]');
  assert.equal(redact('+1 (415) 555-2671').text, '[removed]');
  assert.equal(redact('mail me a.b@example.com ok').text, 'mail me [removed] ok');
  assert.equal(redact('see https://x.io/a?b=1 and www.foo.com/bar').text, 'see [removed] and [removed]');
  assert.equal(redact('112 and 2024 fine').changed, false);
  const app = await startApp();
  try {
    const a = phone(app);
    const r = await a.say('global', 'ring 9876543210 or mail a@b.com');
    assert.equal(r.body.message.text, 'ring [removed] or mail [removed]');
    assert.ok(r.body.message.flags.includes('redacted'));
  } finally {
    app.close();
  }
});

test('word filter masks whole words only, with leetspeak', async () => {
  assert.equal(filterWords('you are a Bitch').text, 'you are a ***');
  assert.equal(filterWords('5h1t happens'.replace('5h1t', 'sh1t')).text, '*** happens');
  assert.equal(filterWords('chutiya hai').text, '*** hai');
  assert.equal(filterWords('तू हरामी है').text, 'तू *** है');
  assert.equal(filterWords('class assistant Scunthorpe').filtered, false);
  const app = await startApp();
  try {
    const a = phone(app);
    const r = await a.say('global', 'what the f u c k, you bastard');
    assert.equal(r.body.message.text, 'what the f u c k, you ***');
    assert.deepEqual(r.body.message.flags, ['filtered']);
    assert.equal(cleanText('   \u0000 ')?.text, undefined);
    assert.equal((await a.say('global', '   \n\t ')).status, 400);
    assert.equal((await phone(app).say('global', 'x'.repeat(500))).body.message.text.length, 300);
  } finally {
    app.close();
  }
});

test('identical message from the same device within 60 s is dropped', async () => {
  const app = await startApp();
  try {
    const a = phone(app);
    assert.ok((await a.say('global', 'same')).body.message);
    clock += 10_000;
    const dup = await a.say('global', 'same');
    assert.equal(dup.status, 200);
    assert.equal(dup.body.dropped, true);
    assert.equal((await list(app)).body.messages.length, 1);
    clock += 61_000;
    assert.ok((await a.say('global', 'same')).body.message);
    assert.equal((await list(app)).body.messages.length, 2);
  } finally {
    app.close();
  }
});

test('per device limits: 6 a minute, 60 an hour', async () => {
  const app = await startApp();
  try {
    const a = phone(app);
    for (let i = 0; i < 6; i++) assert.equal((await a.say('global', `m${i}`)).status, 200);
    const slow = await a.say('global', 'm6');
    assert.equal(slow.status, 429);
    assert.match(slow.body.error, /too fast/);
    clock += 61_000;
    assert.equal((await a.say('global', 'm6')).status, 200);
  } finally {
    app.close();
  }
});

test('hourly cap triggers with bursts inside one hour', async () => {
  const app = await startApp();
  try {
    const a = phone(app);
    let blocked: any = null;
    for (let i = 0; i < 200 && !blocked; i++) {
      if (i % 6 === 0) clock += 1; // stay far inside the hour
      const r = await a.say('global', `h${i}`);
      if (r.status === 429) {
        if (/Hourly/.test(r.body.error)) blocked = r;
        else clock += 60_000; // minute limit: move on a minute (60 steps stay under an hour)
      }
    }
    assert.ok(blocked, 'hourly limit reached');
  } finally {
    app.close();
  }
});

test('per IP limit on posts', async () => {
  const app = await startApp();
  try {
    let n = 0;
    let status = 200;
    for (let i = 0; i < 31 && status === 200; i++) {
      const a = phone(app);
      const raw = JSON.stringify({ text: `ip${i}` });
      const ts = String(clock);
      const k = ed25519.keygen();
      const dev = Buffer.from(k.publicKey).toString('base64');
      const msg = new TextEncoder().encode(`${ts}.POST./v1/chat/global.${sha256Hex(raw)}`);
      const res = await fetch(`${app.base}/v1/chat/global`, {
        method: 'POST',
        headers: { 'x-device': dev, 'x-ts': ts, 'x-sig': Buffer.from(ed25519.sign(msg, k.secretKey)).toString('base64'), 'x-forwarded-for': '9.9.9.9' },
        body: raw,
      });
      status = res.status;
      if (status === 200) n++;
      void a;
    }
    assert.equal(n, 30);
    assert.equal(status, 429);
  } finally {
    app.close();
  }
});

test('invalid room, oversize body and unsigned post are refused', async () => {
  const app = await startApp();
  try {
    const a = phone(app);
    for (const room of ['Global', 'region-i', 'region-abcd', 'secret', 'region-%2e%2e']) {
      const r = await a.say(room, 'hi');
      assert.equal(r.status, 400, room);
    }
    assert.equal((await fetch(`${app.base}/v1/chat/nope`)).status, 400);
    assert.equal((await a.say('region-u0', 'hi')).status, 200);
    assert.equal((await a.say('region-u0z', 'hi again')).status, 200);
  } finally {
    app.close();
  }
});

test('oversize body and unsigned post', async () => {
  const app = await startApp();
  try {
    const a = phone(app);
    const big = await a.call('POST', '/v1/chat/global', { text: 'hi', pad: 'x'.repeat(5000) });
    assert.equal(big.status, 413);
    const unsigned = await a.call('POST', '/v1/chat/global', { text: 'hi' }, false);
    assert.equal(unsigned.status, 401);
    assert.equal((await list(app)).body.messages.length, 0);
  } finally {
    app.close();
  }
});

test('at most 50 rooms', async () => {
  const app = await startApp();
  try {
    const a = phone(app);
    const alphabet = '0123456789bcdefghjkmnpqrstuvwxyz';
    let made = 0;
    for (let i = 0; i < 32 && made < 50; i++) for (let j = 0; j < 4 && made < 50; j++, made++) {
      clock += 11_000;
      assert.equal((await a.say(`region-${alphabet[i]}${alphabet[j]}`, `r${made}`)).status, 200, `room ${made}`);
    }
    clock += 11_000;
    const over = await a.say('region-zz', 'one more');
    assert.equal(over.status, 400);
    clock += 11_000;
    assert.equal((await a.say('region-00', 'existing room still works')).status, 200);
  } finally {
    app.close();
  }
});

test('three distinct reporters hide a message', async () => {
  const app = await startApp();
  try {
    const author = phone(app);
    const msg = (await author.say('global', 'rude thing')).body.message;
    const [r1, r2, r3] = [phone(app), phone(app), phone(app)];
    assert.equal((await author.call('POST', '/v1/chat/report', { room: 'global', id: msg.id })).status, 400);
    assert.equal((await r1.call('POST', '/v1/chat/report', { room: 'global', id: msg.id, reason: 'abuse' })).status, 200);
    assert.equal((await r1.call('POST', '/v1/chat/report', { room: 'global', id: msg.id })).body.reports, 1); // same reporter counts once
    await r2.call('POST', '/v1/chat/report', { room: 'global', id: msg.id });
    assert.equal((await list(app)).body.messages.length, 1);
    await r3.call('POST', '/v1/chat/report', { room: 'global', id: msg.id });
    assert.equal((await list(app)).body.messages.length, 0);
    assert.equal((await r1.call('POST', '/v1/chat/report', { room: 'global', id: 'nope' })).status, 404);
    assert.equal((await r1.call('POST', '/v1/chat/report', { room: 'global', id: msg.id }, false)).status, 401);
    const q = await mod(app, 'GET', '/v1/mod/chat/reported');
    assert.equal(q.body.messages[0].reports, 3);
    assert.equal(q.body.messages[0].hidden, true);
  } finally {
    app.close();
  }
});

test('moderators can hide, ban and unban', async () => {
  const app = await startApp();
  try {
    assert.equal((await fetch(`${app.base}/v1/mod/chat/reported`)).status, 401);
    const bad = phone(app);
    const good = phone(app);
    const m1 = (await bad.say('global', 'spam one')).body.message;
    await good.say('global', 'fine');
    assert.equal((await mod(app, 'POST', '/v1/mod/chat/hide', { room: 'global', id: m1.id })).status, 200);
    assert.deepEqual((await list(app)).body.messages.map((m: any) => m.text), ['fine']);

    clock += 11_000;
    await bad.say('global', 'spam two');
    assert.equal((await mod(app, 'POST', '/v1/mod/chat/ban', { device: 'zz' })).status, 400);
    assert.equal((await mod(app, 'POST', '/v1/mod/chat/ban', { device: bad.tag })).status, 200);
    assert.deepEqual((await list(app)).body.messages.map((m: any) => m.text), ['fine']);
    const blocked = await bad.say('global', 'let me in');
    assert.equal(blocked.status, 403);
    assert.equal((await good.say('global', 'still ok')).status, 200);

    assert.equal((await mod(app, 'POST', '/v1/mod/chat/unban', { device: bad.tag })).status, 200);
    assert.equal((await bad.say('global', 'back again')).status, 200);
    assert.ok((await list(app)).body.messages.some((m: any) => m.text === 'spam two')); // ban-hidden messages return
  } finally {
    app.close();
  }
});

test('messages older than 48 h or beyond 500 per room are pruned', async () => {
  const app = await startApp();
  try {
    const a = phone(app);
    await a.say('global', 'old');
    clock += 49 * 3600_000;
    await a.say('global', 'new');
    assert.deepEqual((await list(app)).body.messages.map((m: any) => m.text), ['new']);
    const ins = app.db.prepare('INSERT INTO chat_msgs (id, room, ts, nick, text, device, flags, hidden) VALUES (?,?,?,?,?,?,?,0)');
    for (let i = 0; i < 520; i++) ins.run(`bulk${i}`, 'global', clock + 1 + i, 'n', `b${i}`, '00000000', '');
    clock += 100_000;
    await a.say('global', 'trigger');
    const n = (app.db.prepare("SELECT COUNT(*) AS n FROM chat_msgs WHERE room='global'").get() as { n: number }).n;
    assert.equal(n, 500);
  } finally {
    app.close();
  }
});
