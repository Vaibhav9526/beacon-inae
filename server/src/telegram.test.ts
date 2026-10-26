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
import { openDb, type Db } from './db.ts';
import { DryRunPusher } from './fcm.ts';
import { loadServerKey, sha256Hex } from './keys.ts';
import { heuristic } from './moderation.ts';
import { hubIdFor } from './relay.ts';
import { ReportService } from './reports.ts';
import { chunkMessage, redact, stripTags, type TelegramFetch } from './telegram.ts';

let clock = Date.now();
const MOD = 'mod-secret';
const GOOD = '123456789:AAHfakeTokenForTestsOnly_0123456789';
const WRONG = '987654321:AAHnotARealBotTokenAtAll_zzzzzzzzzz';
const PUBLIC = 'https://beacon.test';

/** A stand-in for api.telegram.org. Records every call and answers like the real Bot API. */
class FakeBot {
  calls: { method: string; token: string; body: any }[] = [];
  sends: { chat_id: number; text: string; parse_mode?: string }[] = [];
  webhook = '';
  lastError = '';
  setWebhookError = '';
  down = false;
  parseFail = false;
  failChats = new Set<number>();

  fetch: TelegramFetch = async (url, init) => {
    if (this.down) throw new Error(`socket hang up for ${url}`);
    const m = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/.exec(url);
    const token = m?.[1] ?? '';
    const method = m?.[2] ?? '';
    const body = init?.body ? JSON.parse(init.body) : {};
    this.calls.push({ method, token, body });
    const reply = (status: number, j: unknown) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });
    if (token !== GOOD) return reply(401, { ok: false, error_code: 401, description: 'Unauthorized' });
    switch (method) {
      case 'getMe':
        return reply(200, { ok: true, result: { id: 1, is_bot: true, username: 'BeaconFamilyBot' } });
      case 'setWebhook':
        if (this.setWebhookError) return reply(400, { ok: false, description: this.setWebhookError });
        this.webhook = body.url;
        return reply(200, { ok: true, result: true });
      case 'deleteWebhook':
        this.webhook = '';
        return reply(200, { ok: true, result: true });
      case 'getWebhookInfo':
        return reply(200, { ok: true, result: { url: this.webhook, pending_update_count: 0, ...(this.lastError ? { last_error_message: this.lastError } : {}) } });
      case 'sendMessage':
        if (this.failChats.has(body.chat_id)) return reply(403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
        if (body.parse_mode === 'HTML' && this.parseFail && /<\w/.test(body.text)) {
          return reply(400, { ok: false, error_code: 400, description: "Bad Request: can't parse entities: Unsupported start tag" });
        }
        this.sends.push({ chat_id: body.chat_id, text: body.text, parse_mode: body.parse_mode });
        return reply(200, { ok: true, result: { message_id: this.sends.length } });
      default:
        return reply(404, { ok: false, description: 'Not Found' });
    }
  };

  methods(name: string) {
    return this.calls.filter((c) => c.method === name);
  }
}

interface AppOpts {
  bot?: FakeBot;
  publicUrl?: string;
  db?: Db;
}

async function startApp(opts: AppOpts = {}) {
  clock = Date.now();
  const bot = opts.bot ?? new FakeBot();
  const logs: string[] = [];
  const key = loadServerKey(':memory:');
  const db = opts.db ?? openDb(':memory:');
  const alerts = new AlertService(key, cachedFetch(60_000, async () => ({ ok: true, text: async () => '{}', json: async () => ({}) })));
  const reports = new ReportService(db, mkdtempSync(join(tmpdir(), 'beacon-tg-')), { screen: async (i) => heuristic(i, 'test') });
  const app = createApp({
    db,
    key,
    alerts,
    reports,
    pusher: new DryRunPusher(),
    modToken: MOD,
    dataDir: mkdtempSync(join(tmpdir(), 'beacon-tg-d-')),
    now: () => clock,
    telegram: { fetch: bot.fetch, publicUrl: opts.publicUrl ?? PUBLIC, now: () => clock, log: (m) => logs.push(m) },
  });
  const server: Server = createServer((req, res) => void app.handle(req, res, 1024 * 1024));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    base,
    db,
    bot,
    logs,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
type App = Awaited<ReturnType<typeof startApp>>;

/** A hub or phone: an Ed25519 identity that signs every request the way the apps do. */
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
      const signedPath = path.split('?')[0];
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

async function makeHub(app: App) {
  const who = identity(app);
  const hubId = hubIdFor(who.key);
  const r = await who.call('POST', '/v1/hub/register', { hubId, pubKey: who.key });
  assert.equal(r.status, 200);
  return { ...who, hubId };
}

async function connectHub(app: App, hub: { call: Who['call']; hubId: string }, token = GOOD) {
  const r = await hub.call('PUT', '/v1/hub/telegram', { token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const secret = (app.db.prepare('SELECT secret FROM telegram_cfg WHERE hub_id = ?').get(hub.hubId) as { secret: string }).secret;
  return { secret };
}

let updateId = 1000;
const textUpdate = (chatId: number, text: string, name = 'Asha') => ({
  update_id: ++updateId,
  message: { message_id: updateId, date: 1, chat: { id: chatId, type: 'private', first_name: name }, from: { id: chatId, is_bot: false, first_name: name }, text },
});

async function webhook(app: App, secret: string, update: unknown, header = secret) {
  const res = await fetch(`${app.base}/v1/telegram/webhook/${secret}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': header },
    body: typeof update === 'string' ? update : JSON.stringify(update),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Issue a code on the hub and send /start CODE from a chat. */
async function pairChat(app: App, hub: { call: Who['call'] }, secret: string, chatId: number, name = 'Asha') {
  const c = await hub.call('POST', '/v1/hub/telegram/code');
  assert.equal(c.status, 200);
  const r = await webhook(app, secret, textUpdate(chatId, `/start ${c.body.code}`, name));
  assert.equal(r.status, 200);
  return c.body.code as string;
}

/** Every tag opened in the fragment is closed, in order. */
function balanced(html: string): boolean {
  const stack: string[] = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)[^<>]*>/g)) {
    if (m[1]) {
      if (stack.pop() !== m[2]) return false;
    } else stack.push(m[2]!);
  }
  return stack.length === 0;
}

// ---------- pure helpers ----------

test('redact hides bot tokens and any extra secret', () => {
  const out = redact(`failed for ${GOOD} and https://api.telegram.org/bot${GOOD}/getMe`, []);
  assert.ok(!out.includes(GOOD));
  assert.ok(!/\d+:[A-Za-z0-9_-]{30,}/.test(out));
  assert.equal(redact('secret abc123 here', ['abc123']), 'secret <redacted> here');
});

test('chunking splits plain text at 4000 and loses nothing', () => {
  const text = 'word '.repeat(3000) + 'x'.repeat(5000);
  const chunks = chunkMessage(text, false);
  assert.ok(chunks.length >= 4);
  for (const c of chunks) assert.ok(c.length <= 4000, `chunk of ${c.length}`);
  assert.equal(chunks.join(''), text);
});

test('HTML chunks never break a tag or an entity and stay balanced', () => {
  const para = '<b>Alert</b> road &amp; bridge <a href="https://example.com/x?a=1&amp;b=2">details</a> &lt;now&gt; <i>later</i>. ';
  const text = `<b>${para.repeat(200)}</b> tail`;
  const chunks = chunkMessage(text, true);
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok(c.length <= 4000, `chunk of ${c.length}`);
    assert.ok(balanced(c), `unbalanced: ${c.slice(0, 80)}...`);
    assert.ok(!/<[^>]*$/.test(c), 'chunk ends inside a tag');
    assert.ok(!/&[#a-zA-Z0-9]*$/.test(c), 'chunk ends inside an entity');
  }
  assert.equal(chunks.map(stripTags).join(''), stripTags(text));
});

test('stripTags gives plain words for the fallback', () => {
  assert.equal(stripTags('<b>Hi</b> &amp; <a href="x">there</a> &lt;3'), 'Hi & there <3');
});

test('token shape is checked before Telegram is called', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const hub = await makeHub(app);
  const r = await hub.call('PUT', '/v1/hub/telegram', { token: 'not-a-token' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid-token');
  assert.equal(app.bot.calls.length, 0);
});

test('a token Telegram rejects is invalid-token and is never echoed', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const hub = await makeHub(app);
  const r = await hub.call('PUT', '/v1/hub/telegram', { token: WRONG });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid-token');
  assert.ok(!JSON.stringify(r.body).includes(WRONG));
  assert.ok(!app.logs.join('\n').includes(WRONG));
});

test('an unreachable Telegram is telegram-unreachable and the error text is not echoed', async (t) => {
  const app = await startApp();
  t.after(app.close);
  app.bot.down = true;
  const hub = await makeHub(app);
  const r = await hub.call('PUT', '/v1/hub/telegram', { token: GOOD });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'telegram-unreachable');
  assert.ok(!JSON.stringify(r.body).includes(GOOD));
  assert.ok(!app.logs.join('\n').includes(GOOD));
});

test('a setWebhook error that repeats the token is redacted in the log', async (t) => {
  const app = await startApp();
  t.after(app.close);
  app.bot.setWebhookError = `bad webhook for ${GOOD}`;
  const hub = await makeHub(app);
  const r = await hub.call('PUT', '/v1/hub/telegram', { token: GOOD });
  assert.equal(r.body.error, 'telegram-unreachable');
  assert.ok(app.logs.length > 0);
  assert.ok(!app.logs.join('\n').includes(GOOD));
  assert.equal((app.db.prepare('SELECT COUNT(*) AS n FROM telegram_cfg').get() as { n: number }).n, 0, 'nothing stored when Telegram refuses');
});

test('no public URL is no-public-url', async (t) => {
  const app = await startApp({ publicUrl: '' });
  t.after(app.close);
  const hub = await makeHub(app);
  const r = await hub.call('PUT', '/v1/hub/telegram', { token: GOOD });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'no-public-url');
  assert.equal(app.bot.calls.length, 0);
});

test('connect registers the webhook with the secret and stores the config', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const hub = await makeHub(app);
  const r = await hub.call('PUT', '/v1/hub/telegram', { token: GOOD });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, bot: '@BeaconFamilyBot' });
  const sw = app.bot.methods('setWebhook')[0]!.body;
  assert.match(sw.secret_token, /^[0-9a-f]{32}$/);
  assert.equal(sw.url, `${PUBLIC}/v1/telegram/webhook/${sw.secret_token}`);
  assert.deepEqual(sw.allowed_updates, ['message']);
  assert.equal(sw.drop_pending_updates, false);
  const row = app.db.prepare('SELECT token, secret, username FROM telegram_cfg').get() as { token: string; secret: string; username: string };
  assert.deepEqual({ ...row }, { token: GOOD, secret: sw.secret_token, username: 'BeaconFamilyBot' });
});

test('every hub telegram route needs a signed request from a registered hub', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const phone = identity(app); // signed, but never registered as a hub
  const routes: [string, string, unknown?][] = [
    ['GET', '/v1/hub/telegram'],
    ['PUT', '/v1/hub/telegram', { token: GOOD }],
    ['DELETE', '/v1/hub/telegram'],
    ['POST', '/v1/hub/telegram/code'],
    ['PUT', '/v1/hub/telegram/chats', { chats: [] }],
    ['POST', '/v1/hub/telegram/send', { text: 'hi' }],
    ['GET', '/v1/hub/telegram/inbound?since=0'],
  ];
  for (const [method, path, body] of routes) {
    const unsigned = await fetch(app.base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    assert.equal(unsigned.status, 401, `${method} ${path} unsigned`);
    const r = await phone.call(method, path, body);
    assert.equal(r.status, 403, `${method} ${path} from a phone`);
  }
});

test('webhook: a wrong path secret or header is a bare 404', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const hub = await makeHub(app);
  const { secret } = await connectHub(app, hub);
  const badPath = await webhook(app, randomBytes(16).toString('hex'), textUpdate(1, '/start'), secret);
  assert.equal(badPath.status, 404);
  assert.deepEqual(badPath.body, { error: 'not found' });
  const badHeader = await webhook(app, secret, textUpdate(1, '/start'), 'wrong');
  assert.equal(badHeader.status, 404);
  const noHeader = await webhook(app, secret, textUpdate(1, '/start'), '');
  assert.equal(noHeader.status, 404);
  assert.equal(app.bot.sends.length, 0);
});

test('a valid code pairs the chat and confirms it', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const hub = await makeHub(app);
  const { secret } = await connectHub(app, hub);
  await pairChat(app, hub, secret, 4242, 'Grandma');
  assert.equal(app.bot.sends.at(-1)!.text, 'Paired with Beacon. You will get family alerts here.');
  assert.equal(app.bot.sends.at(-1)!.chat_id, 4242);
  const st = await hub.call('GET', '/v1/hub/telegram');
  assert.deepEqual(st.body.chats, [{ id: 4242, name: 'Grandma' }]);
});

test('wrong, expired and other-hub codes are refused the same way, and a code works once', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const hub = await makeHub(app);
  const other = await makeHub(app);
  const { secret } = await connectHub(app, hub);
  const { secret: otherSecret } = await connectHub(app, other, GOOD);
  const refusal = 'That pairing code is not valid. Ask for a new one in the Beacon Hub.';

  await webhook(app, secret, textUpdate(7, '/start ZZZZZZZZ'));
  assert.equal(app.bot.sends.at(-1)!.text, refusal);

  const expired = (await hub.call('POST', '/v1/hub/telegram/code')).body.code;
  clock += 11 * 60_000;
  await webhook(app, secret, textUpdate(8, `/start ${expired}`));
  assert.equal(app.bot.sends.at(-1)!.text, refusal);
  clock -= 11 * 60_000;

  const foreign = (await other.call('POST', '/v1/hub/telegram/code')).body.code;
  await webhook(app, secret, textUpdate(9, `/start ${foreign}`));
  assert.equal(app.bot.sends.at(-1)!.text, refusal, 'a code from another hub does not pair here');
  await webhook(app, otherSecret, textUpdate(9, `/start ${foreign}`));
  assert.equal(app.bot.sends.at(-1)!.text, 'Paired with Beacon. You will get family alerts here.');

  const once = (await hub.call('POST', '/v1/hub/telegram/code')).body.code;
  await webhook(app, secret, textUpdate(11, `/start ${once}`));
  assert.equal(app.bot.sends.at(-1)!.text, 'Paired with Beacon. You will get family alerts here.');
  await webhook(app, secret, textUpdate(12, `/start ${once}`));
  assert.equal(app.bot.sends.at(-1)!.text, refusal, 'a spent code does not pair again');
});

test('a new code replaces the previous one for that hub', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const hub = await makeHub(app);
  const { secret } = await connectHub(app, hub);
  const first = (await hub.call('POST', '/v1/hub/telegram/code')).body.code;
  const second = (await hub.call('POST', '/v1/hub/telegram/code')).body.code;
  assert.match(second, /^[A-HJ-KM-NP-Z2-9]{8}$/);
  await webhook(app, secret, textUpdate(20, `/start ${first}`));
  assert.match(app.bot.sends.at(-1)!.text, /not valid/);
  await webhook(app, secret, textUpdate(20, `/start ${second}`));
  assert.match(app.bot.sends.at(-1)!.text, /^Paired/);
});

test('code needs a connected bot', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const hub = await makeHub(app);
  const r = await hub.call('POST', '/v1/hub/telegram/code');
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'not-connected');
});

test('/start alone explains pairing, /stop unpairs with confirmation, strangers are ignored', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const hub = await makeHub(app);
  const { secret } = await connectHub(app, hub);

  const sendsBefore = app.bot.sends.length;
  await webhook(app, secret, textUpdate(30, 'hello there'));
  await webhook(app, secret, textUpdate(30, '/stop'));
  assert.equal(app.bot.sends.length, sendsBefore, 'unpaired text and /stop are silent');

  await webhook(app, secret, textUpdate(30, '/start'));
  assert.match(app.bot.sends.at(-1)!.text, /open the Beacon Hub/);

  await pairChat(app, hub, secret, 30);
  await webhook(app, secret, textUpdate(30, '/stop'));
  assert.match(app.bot.sends.at(-1)!.text, /^Stopped\./);
  const st = await hub.call('GET', '/v1/hub/telegram');
  assert.deepEqual(st.body.chats, []);
});

test('text from paired chats goes to the inbox, with a since cursor and a 100 message cap', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const hub = await makeHub(app);
  const { secret } = await connectHub(app, hub);
  await pairChat(app, hub, secret, 50, 'Dad');
  await webhook(app, secret, textUpdate(50, 'Are you home?', 'Dad'));
  // a pairing command is not a message for the hub
  const first = await hub.call('GET', '/v1/hub/telegram/inbound?since=0');
  assert.equal(first.body.messages.length, 1);
  assert.deepEqual(
    { chatId: first.body.messages[0].chatId, name: first.body.messages[0].name, text: first.body.messages[0].text },
    { chatId: 50, name: 'Dad', text: 'Are you home?' },
  );
  const cursor = first.body.messages[0].id;
  const none = await hub.call('GET', `/v1/hub/telegram/inbound?since=${cursor}`);
  assert.deepEqual(none.body.messages, []);

  for (let i = 0; i < 105; i++) await webhook(app, secret, textUpdate(50, `msg ${i}`));
  const all = await hub.call('GET', '/v1/hub/telegram/inbound?since=0');
  assert.equal(all.body.messages.length, 100);
  const ids = all.body.messages.map((m: { id: number }) => m.id);
  assert.deepEqual(ids, [...ids].sort((a: number, b: number) => a - b));
  assert.equal(all.body.messages.at(-1).text, 'msg 104');
});

test('junk, oversized and non-message bodies get a plain 200 and nothing else', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const hub = await makeHub(app);
  const { secret } = await connectHub(app, hub);
  await pairChat(app, hub, secret, 60);
  const sends = app.bot.sends.length;
  assert.equal((await webhook(app, secret, '{not json')).status, 200);
  assert.equal((await webhook(app, secret, { update_id: 1 })).status, 200);
  assert.equal((await webhook(app, secret, textUpdate(60, 'x'.repeat(70 * 1024)))).status, 200);
  const inbox = await hub.call('GET', '/v1/hub/telegram/inbound?since=0');
  assert.equal(inbox.body.messages.length, 0);
  assert.equal(app.bot.sends.length, sends);
});

test('send splits long HTML at 4000 with balanced tags and reports sent and failed per chat', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const hub = await makeHub(app);
  const { secret } = await connectHub(app, hub);
  await pairChat(app, hub, secret, 70, 'Mum');
  await pairChat(app, hub, secret, 71, 'Sam');
  app.bot.failChats.add(71);
  const sentBefore = app.bot.sends.length;

  const text = `<b>Family update</b> ${'<i>all well</i> at the farm &amp; the school. '.repeat(250)}`;
  const r = await hub.call('POST', '/v1/hub/telegram/send', { text, html: true });
  assert.deepEqual(r.body, { ok: true, sent: 1, failed: 1 });
  const toMum = app.bot.sends.slice(sentBefore).filter((s) => s.chat_id === 70);
  assert.ok(toMum.length > 1);
  for (const s of toMum) {
    assert.ok(s.text.length <= 4000);
    assert.ok(balanced(s.text));
    assert.equal(s.parse_mode, 'HTML');
  }
  assert.equal(toMum.map((s) => stripTags(s.text)).join(''), stripTags(text));
});

test('send falls back to plain text, tags stripped, when Telegram cannot parse the markup', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const hub = await makeHub(app);
  const { secret } = await connectHub(app, hub);
  await pairChat(app, hub, secret, 80);
  app.bot.parseFail = true;
  const r = await hub.call('POST', '/v1/hub/telegram/send', { text: '<b>Hi</b> &amp; welcome', html: true });
  assert.deepEqual(r.body, { ok: true, sent: 1, failed: 0 });
  const last = app.bot.sends.at(-1)!;
  assert.equal(last.text, 'Hi & welcome');
  assert.equal(last.parse_mode, undefined);
});

test('plain sends carry no parse mode and link previews are off', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const hub = await makeHub(app);
  const { secret } = await connectHub(app, hub);
  await pairChat(app, hub, secret, 85);
  await hub.call('POST', '/v1/hub/telegram/send', { text: 'See https://example.com' });
  const call = app.bot.methods('sendMessage').at(-1)!.body;
  assert.equal(call.parse_mode, undefined);
  assert.equal(call.link_preview_options.is_disabled, true);
});

test('send needs a connection, then paired chats', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const hub = await makeHub(app);
  const r0 = await hub.call('POST', '/v1/hub/telegram/send', { text: 'hi' });
  assert.equal(r0.status, 409);
  assert.equal(r0.body.error, 'not-connected');
  await connectHub(app, hub);
  const r1 = await hub.call('POST', '/v1/hub/telegram/send', { text: 'hi' });
  assert.equal(r1.status, 409);
  assert.equal(r1.body.error, 'no-chats');
});

test('send is limited to 30 a minute per hub', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const hub = await makeHub(app);
  await connectHub(app, hub);
  await hub.call('PUT', '/v1/hub/telegram/chats', { chats: [{ id: 90, name: 'Family' }] });
  for (let i = 0; i < 30; i++) assert.equal((await hub.call('POST', '/v1/hub/telegram/send', { text: `n${i}` })).status, 200);
  const limited = await hub.call('POST', '/v1/hub/telegram/send', { text: 'one more' });
  assert.equal(limited.status, 429);
  clock += 61_000;
  assert.equal((await hub.call('POST', '/v1/hub/telegram/send', { text: 'later' })).status, 200);
});

test('send input is validated', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const hub = await makeHub(app);
  await connectHub(app, hub);
  assert.equal((await hub.call('POST', '/v1/hub/telegram/send', { text: '' })).status, 400);
  assert.equal((await hub.call('POST', '/v1/hub/telegram/send', { text: 'x'.repeat(20001) })).status, 400);
});

test('restore: PUT chats replaces the paired chats and rejects more than 50', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const hub = await makeHub(app);
  await connectHub(app, hub);
  const put = await hub.call('PUT', '/v1/hub/telegram/chats', { chats: [{ id: -100123, name: 'Family group' }, { id: 5, name: 'Nan' }] });
  assert.equal(put.status, 200);
  const st = await hub.call('GET', '/v1/hub/telegram');
  assert.deepEqual(st.body.chats, [
    { id: -100123, name: 'Family group' },
    { id: 5, name: 'Nan' },
  ]);
  const tooMany = Array.from({ length: 51 }, (_, i) => ({ id: i + 1, name: 'c' }));
  assert.equal((await hub.call('PUT', '/v1/hub/telegram/chats', { chats: tooMany })).status, 400);
  assert.equal((await hub.call('PUT', '/v1/hub/telegram/chats', { chats: [{ id: 'abc', name: 'x' }] })).status, 400);
});

test('status reports webhook health and tolerates a Telegram outage', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const hub = await makeHub(app);
  const none = await hub.call('GET', '/v1/hub/telegram');
  assert.deepEqual(none.body, { connected: false, chats: [] });

  await connectHub(app, hub);
  const ok = await hub.call('GET', '/v1/hub/telegram');
  assert.equal(ok.body.connected, true);
  assert.equal(ok.body.bot, '@BeaconFamilyBot');
  assert.deepEqual(ok.body.webhook, { ok: true });

  app.bot.lastError = `Wrong response from the webhook for ${GOOD}`;
  const bad = await hub.call('GET', '/v1/hub/telegram');
  assert.equal(bad.body.webhook.ok, true);
  assert.ok(!JSON.stringify(bad.body).includes(GOOD));

  app.bot.down = true;
  const down = await hub.call('GET', '/v1/hub/telegram');
  assert.equal(down.status, 200);
  assert.equal(down.body.webhook.ok, false);
});

test('delete removes the webhook and every row for the hub', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const hub = await makeHub(app);
  const { secret } = await connectHub(app, hub);
  await pairChat(app, hub, secret, 100);
  await hub.call('POST', '/v1/hub/telegram/code');
  const r = await hub.call('DELETE', '/v1/hub/telegram');
  assert.deepEqual(r.body, { ok: true });
  assert.equal(app.bot.methods('deleteWebhook').length, 1);
  assert.equal(app.bot.webhook, '');
  for (const table of ['telegram_cfg', 'telegram_chats', 'telegram_codes', 'telegram_inbox']) {
    assert.equal((app.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, 0, table);
  }
  assert.deepEqual((await hub.call('GET', '/v1/hub/telegram')).body, { connected: false, chats: [] });
});

test('a fresh start re-registers every stored webhook', async (t) => {
  const db = openDb(':memory:');
  const hubId = 'testhub';
  db.prepare('INSERT INTO telegram_cfg (hub_id, token, secret, username) VALUES (?,?,?,?)').run(hubId, GOOD, 'a'.repeat(32), 'BeaconFamilyBot');
  const app = await startApp({ db });
  t.after(app.close);
  const deadline = Date.now() + 2000;
  while (app.bot.methods('setWebhook').length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  const sw = app.bot.methods('setWebhook');
  assert.equal(sw.length, 1);
  assert.equal(sw[0]!.body.url, `${PUBLIC}/v1/telegram/webhook/${'a'.repeat(32)}`);
  assert.equal(sw[0]!.body.secret_token, 'a'.repeat(32));
});

test('a restart with no PUBLIC_URL logs and does not call Telegram', async (t) => {
  const db = openDb(':memory:');
  db.prepare('INSERT INTO telegram_cfg (hub_id, token, secret, username) VALUES (?,?,?,?)').run('h', GOOD, 'b'.repeat(32), 'x');
  const app = await startApp({ db, publicUrl: '' });
  t.after(app.close);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(app.bot.methods('setWebhook').length, 0);
  assert.ok(app.logs.some((l) => /PUBLIC_URL not set/.test(l)));
});
