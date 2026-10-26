import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { BeaconLink } from './beaconLink.ts';
import { HubApp } from './app.ts';
import { MSG_REJECTED } from './telegram.ts';
import { defaultTelegramMode, RELAY_MSG, TelegramViaRelay } from './telegramRelay.ts';
import type { RelayHttp, TelegramInbound } from './telegramRelay.ts';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const RELAY = 'https://relay.example';

/**
 * A fake of the relay's /v1/hub/telegram API (see the contract in the Hub notes). It keeps the state a real relay
 * would: whether Telegram is connected, the chats, and the inbound messages. Switches make it refuse or go away.
 */
class FakeRelay implements RelayHttp {
  hits: Array<{ method: string; path: string; body: any }> = [];
  connected = false;
  chats: Array<{ id: number; name: string }> = [];
  inbound: Array<{ id: number; chatId: number; name: string; text: string; at: number }> = [];
  sent: string[] = [];
  down = false;
  tgUnreachable = false;
  sendReply: { status: number; json: any } | null = null;
  sendFailed = 0;

  async request(method: string, fullPath: string, body?: any) {
    this.hits.push({ method, path: fullPath, body });
    if (this.down) throw new TypeError('fetch failed');
    const path = fullPath.split('?')[0];
    if (method === 'PUT' && path === '/v1/hub/telegram') {
      if (body?.token === 'bad') return { status: 400, json: { error: 'invalid-token' } };
      if (this.tgUnreachable) return { status: 400, json: { error: 'telegram-unreachable' } };
      this.connected = true;
      return { status: 200, json: { ok: true, bot: '@family_bot' } };
    }
    if (method === 'GET' && path === '/v1/hub/telegram') {
      return { status: 200, json: { connected: this.connected, ...(this.connected ? { bot: 'family_bot' } : {}), chats: this.chats, webhook: { ok: true } } };
    }
    if (method === 'DELETE' && path === '/v1/hub/telegram') {
      this.connected = false;
      return { status: 200, json: { ok: true } };
    }
    if (method === 'PUT' && path === '/v1/hub/telegram/chats') {
      this.chats = body.chats;
      return { status: 200, json: { ok: true } };
    }
    if (method === 'POST' && path === '/v1/hub/telegram/code') {
      if (!this.connected) return { status: 409, json: { error: 'not-connected' } };
      return { status: 200, json: { code: 'ABCD1234' } };
    }
    if (method === 'POST' && path === '/v1/hub/telegram/send') {
      if (this.sendReply) return this.sendReply;
      if (!this.connected) return { status: 409, json: { error: 'not-connected' } };
      if (this.chats.length === 0) return { status: 409, json: { error: 'no-chats' } };
      this.sent.push(body.text);
      return { status: 200, json: { ok: true, sent: this.chats.length - this.sendFailed, failed: this.sendFailed } };
    }
    if (method === 'GET' && path === '/v1/hub/telegram/inbound') {
      const since = Number(new URLSearchParams(fullPath.split('?')[1] ?? '').get('since') ?? 0);
      return { status: 200, json: { messages: this.inbound.filter((m) => m.id > since).map((m) => ({ ...m, id: m.id })) } };
    }
    return { status: 404, json: { error: 'not-found' } };
  }
}

function harness(init: { token?: string; chats?: number[] } = {}) {
  const relay = new FakeRelay();
  const logs: string[] = [];
  const store = {
    token: init.token as string | undefined,
    chats: init.chats ?? ([] as number[]),
    cursor: undefined as string | undefined,
    inbound: [] as TelegramInbound[],
  };
  let clock = 1_000_000;
  const tg = new TelegramViaRelay({
    relay,
    getToken: () => store.token,
    setToken: (t) => {
      store.token = t;
    },
    getChats: () => [...store.chats],
    setChats: (ids) => {
      store.chats = ids;
    },
    getCursor: () => store.cursor,
    setCursor: (c) => {
      store.cursor = c;
    },
    onInbound: (m) => store.inbound.push(m),
    log: (l) => logs.push(l),
    now: () => clock,
  });
  return { relay, store, tg, logs, advance: (ms: number) => (clock += ms) };
}

const sentBodies = (relay: FakeRelay) => relay.hits.filter((h) => h.method === 'PUT' && h.path === '/v1/hub/telegram').map((h) => h.body);

test('a relay that lost the token gets it uploaded, and the lost chats are restored', async () => {
  const { relay, store, tg } = harness({ token: TOKEN, chats: [7] });
  const status = await tg.sync();
  assert.deepEqual(status, { state: 'connected', bot: 'family_bot' });
  assert.deepEqual(sentBodies(relay), [{ token: TOKEN }]);
  const chatPut = relay.hits.find((h) => h.path === '/v1/hub/telegram/chats');
  assert.deepEqual(chatPut?.body, { chats: [{ id: 7, name: '' }] }, 'the Hub puts its own chats back');
  assert.deepEqual(relay.chats, [{ id: 7, name: '' }]);
  assert.deepEqual(store.chats, [7]);
});

test('a relay that is already connected does not get the token again', async () => {
  const { relay, tg } = harness({ token: TOKEN, chats: [7] });
  relay.connected = true;
  relay.chats = [{ id: 7, name: 'Maa' }];
  assert.equal((await tg.sync()).state, 'connected');
  assert.equal(sentBodies(relay).length, 0);
  assert.equal(relay.hits.filter((h) => h.path === '/v1/hub/telegram/chats').length, 0, 'nothing to restore');
});

test('chats the relay has and the Hub does not know are adopted and saved', async () => {
  const { relay, store, tg } = harness({ token: TOKEN, chats: [7] });
  relay.connected = true;
  relay.chats = [{ id: 42, name: 'Dadi' }];
  await tg.sync();
  assert.deepEqual(store.chats, [7, 42]);
  assert.deepEqual(tg.chatList(), [
    { id: 7, name: '' },
    { id: 42, name: 'Dadi' },
  ]);
  assert.equal(relay.hits.filter((h) => h.path === '/v1/hub/telegram/chats').length, 0, 'adopting does not write back');
});

test('a removed token is removed on the relay as well (the Hub is the source of truth)', async () => {
  const { relay, tg } = harness({});
  relay.connected = true;
  await tg.sync();
  assert.equal(relay.connected, false);
  assert.ok(relay.hits.some((h) => h.method === 'DELETE' && h.path === '/v1/hub/telegram'));
});

test('inbound messages from paired chats reach the handler; others are dropped; the cursor moves on', async () => {
  const { relay, store, tg } = harness({ token: TOKEN, chats: [7] });
  await tg.sync();
  relay.inbound = [
    { id: 1, chatId: 7, name: 'Papa', text: 'run', at: 1 },
    { id: 2, chatId: 99, name: 'Stranger', text: 'hello', at: 2 },
    { id: 3, chatId: 7, name: 'Papa', text: 'how is Maa', at: 3 },
  ];
  assert.equal(await tg.pollInbound(), 2);
  assert.deepEqual(
    store.inbound.map((m) => [m.chatId, m.text]),
    [
      [7, 'run'],
      [7, 'how is Maa'],
    ],
  );
  assert.equal(store.cursor, '3');
  assert.match(relay.hits.at(-1)!.path, /inbound\?since=0$/);
  assert.equal(await tg.pollInbound(), 0);
  assert.match(relay.hits.at(-1)!.path, /inbound\?since=3$/, 'the next poll asks only for what is newer');
});

test('inbound is not read while the relay is not connected', async () => {
  const { relay, tg } = harness({ token: TOKEN, chats: [7] });
  relay.connected = false;
  await tg.sync();
  relay.connected = false;
  tg.status = { state: 'none' };
  assert.equal(await tg.pollInbound(), 0);
  assert.equal(relay.hits.filter((h) => h.path.startsWith('/v1/hub/telegram/inbound')).length, 0);
});

test('send goes to the relay and returns when the relay sent it', async () => {
  const { relay, tg } = harness({ token: TOKEN, chats: [7, 8] });
  await tg.sync();
  await tg.send('Heat alert for Maa', undefined, { html: false });
  assert.deepEqual(relay.sent, ['Heat alert for Maa']);
  const send = relay.hits.find((h) => h.path === '/v1/hub/telegram/send');
  assert.deepEqual(send?.body, { text: 'Heat alert for Maa' }, 'plain text sends no html flag');
});

test('html sends carry the html flag and long text is split like direct mode', async () => {
  const { relay, tg } = harness({ token: TOKEN, chats: [7] });
  await tg.sync();
  await tg.send('<b>Alert</b>', undefined, { html: true });
  assert.equal((relay.hits.at(-1)!.body as { html: boolean }).html, true);
  const long = Array.from({ length: 900 }, (_, i) => `line ${i} ${'x'.repeat(10)}`).join('\n');
  relay.sent = [];
  await tg.send(long);
  assert.ok(relay.sent.length > 1, 'split into several sends');
  assert.ok(relay.sent.every((t) => t.length <= 4000));
});

test('send refusals become readable messages', async () => {
  const { relay, tg, store } = harness({ token: TOKEN, chats: [7] });
  await tg.sync();

  store.chats = [];
  await assert.rejects(tg.send('x'), (e: Error) => e.message === RELAY_MSG.noChats);
  store.chats = [7];

  relay.connected = false;
  await assert.rejects(tg.send('x'), (e: Error) => e.message === RELAY_MSG.notSetUp);
  relay.connected = true;

  relay.sendReply = { status: 429, json: { error: 'rate-limited' } };
  await assert.rejects(tg.send('x'), (e: Error) => e.message === RELAY_MSG.busy);

  relay.sendReply = { status: 400, json: { error: 'telegram-unreachable' } };
  await assert.rejects(tg.send('x'), (e: Error) => e.message === RELAY_MSG.unreachable);

  relay.sendReply = null;
  relay.down = true;
  await assert.rejects(tg.send('x'), (e: Error) => e.message === RELAY_MSG.cannotReach);
  relay.down = false;

  // a 5xx means the relay itself is unwell (a restart, a sleeping server): the same "cannot be reached" message
  relay.sendReply = { status: 500, json: { error: 'boom' } };
  await assert.rejects(tg.send('x'), (e: Error) => e.message === RELAY_MSG.cannotReach);
  relay.sendReply = { status: 418, json: { error: 'teapot' } };
  await assert.rejects(tg.send('x'), (e: Error) => e.message === RELAY_MSG.failed);
  relay.sendReply = null;

  relay.sendFailed = 1;
  relay.chats = [{ id: 7, name: '' }, { id: 8, name: '' }];
  await assert.rejects(tg.send('x'), /could not reach 1 of 2/);
});

test('a token Telegram refuses is not saved and throws the BotFather message', async () => {
  const { relay, store, tg } = harness({});
  await assert.rejects(tg.connect('bad'), (e: Error) => e.message === MSG_REJECTED);
  assert.equal(store.token, undefined);
  assert.equal(relay.connected, false);
});

test('saving while the relay cannot reach Telegram keeps the token and says so', async () => {
  const { relay, store, tg } = harness({});
  relay.tgUnreachable = true;
  const s = await tg.connect(TOKEN);
  assert.equal(s.state, 'unreachable');
  assert.equal(s.message, RELAY_MSG.unreachable);
  assert.equal(store.token, TOKEN, 'kept on this computer');
});

test('saving while the relay is unreachable is "waiting", and the sync uploads it later', async () => {
  const { relay, store, tg } = harness({});
  relay.down = true;
  const s = await tg.connect(TOKEN);
  assert.equal(s.state, 'waiting');
  assert.equal(store.token, TOKEN);
  relay.down = false;
  assert.equal(tg.status.state, 'waiting');
  const after = await tg.tick().then(() => tg.status);
  assert.equal(after.state, 'connected', 'the next tick uploads the token');
  assert.equal(relay.connected, true);
});

test('the tick re-syncs after a failure without waiting a minute', async () => {
  const { relay, tg, advance } = harness({ token: TOKEN, chats: [7] });
  await tg.sync();
  relay.connected = false;
  tg.requestSync();
  advance(1_000);
  await tg.tick();
  assert.equal(relay.connected, true, 'a requested sync uploads the token again');
});

test('pairing: the code comes from the relay and the chat it adds is adopted on the next tick', async () => {
  const { relay, store, tg, advance } = harness({ token: TOKEN });
  await tg.sync();
  assert.equal(await tg.pairingCode(), 'ABCD1234');
  relay.chats = [{ id: 55, name: 'Dadi' }];
  advance(8_000);
  await tg.tick();
  assert.deepEqual(store.chats, [55]);
});

test('pairing refused by the relay gives a readable message', async () => {
  const { tg, relay } = harness({ token: TOKEN });
  relay.connected = false;
  await assert.rejects(tg.pairingCode(), (e: Error) => e.message === RELAY_MSG.notSetUp);
});

test('the token never appears in status, chat names or logs', async () => {
  const { relay, tg, logs, store } = harness({});
  relay.down = true;
  await tg.connect(TOKEN);
  relay.down = false;
  relay.tgUnreachable = true;
  await tg.sync();
  relay.tgUnreachable = false;
  await tg.sync();
  relay.sendReply = { status: 500, json: { error: `oops ${TOKEN}` } };
  store.chats = [7];
  await tg.send('x').catch(() => {});
  await tg.disconnect();
  const all = JSON.stringify([tg.status, tg.chatList(), logs]);
  assert.ok(!all.includes(TOKEN), 'no copy of the token in what the Hub shows or logs');
});

test('removing the key clears it here and on the relay; paired chats stay', async () => {
  const { relay, store, tg } = harness({ token: TOKEN, chats: [7] });
  await tg.sync();
  const s = await tg.disconnect();
  assert.equal(s.state, 'none');
  assert.equal(store.token, undefined);
  assert.equal(relay.connected, false);
  assert.deepEqual(store.chats, [7]);
});

test('the default mode is relay for a real address and direct for this computer', () => {
  assert.equal(defaultTelegramMode('https://beacon.example.org'), 'relay');
  assert.equal(defaultTelegramMode('http://127.0.0.1:8787'), 'direct');
  assert.equal(defaultTelegramMode('http://localhost:8787'), 'direct');
  assert.equal(defaultTelegramMode('not an address'), 'direct');
});

/** A BeaconLink whose HTTP goes to the fake relay, so HubApp runs the real relay client end to end. */
function linkTo(relay: FakeRelay, dir: string) {
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const path = url.replace(RELAY, '');
    const payload = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (relay.down) throw new TypeError('fetch failed');
    const r = await relay.request(init?.method ?? 'GET', path, payload);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => JSON.stringify(r.json) } as unknown as Response;
  }) as typeof fetch;
  return new BeaconLink(dir, RELAY, fetchFn);
}

/** HubApp with a relay address, so the default mode is relay; Telegram's own API is never reached. */
function appOn(dir: string, relay: FakeRelay, interactive = false) {
  return new HubApp({
    dir,
    offline: true,
    interactive,
    link: linkTo(relay, dir),
    telegramStart: async () => {
      throw Object.assign(new Error("Network request for 'getMe' failed!"), { name: 'HttpError' });
    },
    telegramDelays: [],
  });
}

test('HubApp: relay mode by default, the token goes to the relay, and the mode choice is saved', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgrelay-'));
  const relay = new FakeRelay();
  const app = appOn(dir, relay);
  await app.setRelayUrl(RELAY);
  assert.equal(app.telegramMode(), 'relay');

  const s = await app.connectTelegram(TOKEN);
  assert.equal(s.state, 'connected');
  assert.equal(relay.connected, true);
  assert.equal(app.telegramInfo().mode, 'relay');
  assert.equal(app.telegramInfo().saved, true);
  assert.ok(!JSON.stringify(app.state()).includes(TOKEN), 'the token is not in the UI state');

  await app.setTelegramMode('direct');
  assert.equal(relay.connected, false, 'switching to direct removes the token from the relay');
  const again = appOn(dir, new FakeRelay());
  assert.equal(again.telegramMode(), 'direct', 'the choice survives a restart');
  assert.equal(readFileSync(join(dir, 'secrets.json'), 'utf8').includes(`"telegramMode":"direct"`), true);
});

test('HubApp: a chat message needs the approval gate; declining sends nothing to the relay', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgrelay-gate-'));
  const relay = new FakeRelay();
  const app = appOn(dir, relay, false);
  await app.setRelayUrl(RELAY);
  await app.connectTelegram(TOKEN);
  await app.telegramRelay.sync();
  relay.chats = [{ id: 7, name: 'Papa' }];
  await app.telegramRelay.sync();
  const r = await app.testTelegram();
  assert.equal(r.ok, false, 'a headless hub has nobody to approve: declined');
  assert.deepEqual(relay.sent, [], 'nothing was sent');
  assert.ok(app.audit.read(20).some((l) => l.event === 'declined'), 'the decision is in the audit log');
});

test('HubApp: the test button reports when no chat is paired', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgrelay-none-'));
  const app = appOn(dir, new FakeRelay());
  const r = await app.testTelegram();
  assert.equal(r.ok, false);
  assert.match(r.note, /No chat is paired/);
});
