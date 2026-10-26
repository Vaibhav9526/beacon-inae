import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyTelegramError, MSG_GAVE_UP, MSG_NETWORK, MSG_REJECTED, redactToken, TELEGRAM_RETRY_MS, TelegramSupervisor } from './telegram.ts';
import type { TelegramStatus } from './telegram.ts';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const netErr = () => Object.assign(new Error("Network request for 'getMe' failed!"), { name: 'HttpError' });
const refusedErr = (code = 401) => Object.assign(new Error(`Call to 'getMe' failed! (${code}: Unauthorized)`), { error_code: code });

/** Timers the test fires by hand, so retry waits are checked without real time passing. */
function fakeTimers() {
  const queue: Array<{ id: number; fn: () => void; ms: number }> = [];
  let next = 1;
  return {
    queue,
    set: (fn: () => void, ms: number) => {
      const id = next++;
      queue.push({ id, fn, ms });
      return id;
    },
    clear: (h: unknown) => {
      const i = queue.findIndex((t) => t.id === h);
      if (i >= 0) queue.splice(i, 1);
    },
    fire: () => queue.shift()?.fn(),
  };
}
const flush = () => new Promise((r) => setImmediate(r));

test('a 401 or 404 from Telegram means the token is refused; no retry', () => {
  for (const code of [401, 404]) {
    const f = classifyTelegramError(refusedErr(code));
    assert.equal(f.kind, 'rejected');
    assert.equal(f.message, MSG_REJECTED);
    assert.match(f.message, /@BotFather/);
  }
});

test('no answer from Telegram (grammY HttpError) is network trouble and is retried', () => {
  const f = classifyTelegramError(netErr());
  assert.equal(f.kind, 'network');
  assert.equal(f.message, MSG_NETWORK);
  assert.equal(classifyTelegramError(Object.assign(new Error("Network request for 'getMe' timed out"), { name: 'HttpError' })).kind, 'network');
});

test('other Telegram errors (500, 429) are retried as "other"', () => {
  const f = classifyTelegramError(refusedErr(500));
  assert.equal(f.kind, 'other');
  assert.equal(f.code, 500);
  assert.equal(classifyTelegramError(new Error('weird')).kind, 'other');
});

test('redactToken hides bot-token shapes and the exact token', () => {
  const text = `failed for ${TOKEN} and bot${TOKEN.slice(0, 9)}:${TOKEN.slice(10)}`;
  const out = redactToken(text, TOKEN);
  assert.ok(!out.includes(TOKEN));
  assert.ok(!/\d{9}:AAH/.test(out));
  assert.match(out, /\[token hidden\]/);
});

test('network failures retry on 2, 4, 8, 16, 30 seconds, then succeed and reset', async () => {
  const timers = fakeTimers();
  const starts: string[] = [];
  let failures = 3;
  const sup = new TelegramSupervisor({
    start: async (token) => {
      starts.push(token);
      if (failures-- > 0) throw netErr();
      return 'family_bot';
    },
    stop: async () => {},
    setTimer: timers.set,
    clearTimer: timers.clear,
    log: () => {},
  });
  const first = await sup.connect(TOKEN);
  assert.deepEqual(first, { state: 'reconnecting', attempt: 1, of: 5, message: MSG_NETWORK });
  assert.deepEqual(timers.queue.map((t) => t.ms), [2000]);

  timers.fire();
  await flush();
  assert.equal(sup.status.state, 'reconnecting');
  assert.deepEqual(timers.queue.map((t) => t.ms), [4000]);
  timers.fire();
  await flush();
  timers.fire();
  await flush();
  assert.equal(timers.queue.length, 0);
  assert.equal(sup.status.state, 'connected');
  assert.deepEqual(sup.status, { state: 'connected', bot: 'family_bot' });
  assert.equal(starts.length, 4);
  assert.ok(starts.every((t) => t === TOKEN));
});

test('after five retries the supervisor stops by itself and waits for Retry now', async () => {
  const timers = fakeTimers();
  let online = false;
  let calls = 0;
  const sup = new TelegramSupervisor({
    start: async () => {
      calls++;
      if (!online) throw netErr();
      return 'family_bot';
    },
    stop: async () => {},
    setTimer: timers.set,
    clearTimer: timers.clear,
    log: () => {},
  });
  await sup.connect(TOKEN);
  const seen: number[] = [];
  for (let i = 0; i < TELEGRAM_RETRY_MS.length; i++) {
    seen.push(timers.queue[0]!.ms);
    timers.fire();
    await flush();
  }
  assert.deepEqual(seen, TELEGRAM_RETRY_MS);
  assert.equal(calls, TELEGRAM_RETRY_MS.length + 1);
  assert.deepEqual(sup.status, { state: 'unreachable', message: MSG_GAVE_UP });
  assert.equal(timers.queue.length, 0, 'no timer after giving up');

  online = true;
  const again = await sup.retryNow();
  assert.deepEqual(again, { state: 'connected', bot: 'family_bot' });
});

test('a rejected token is not retried and the status says so', async () => {
  const timers = fakeTimers();
  let calls = 0;
  const sup = new TelegramSupervisor({
    start: async () => {
      calls++;
      throw refusedErr(401);
    },
    stop: async () => {},
    setTimer: timers.set,
    clearTimer: timers.clear,
    log: () => {},
  });
  const st = await sup.connect(TOKEN);
  assert.deepEqual(st, { state: 'rejected', message: MSG_REJECTED });
  assert.equal(timers.queue.length, 0);
  assert.equal(calls, 1);
});

test('losing the connection after it was up schedules a reconnect', async () => {
  const timers = fakeTimers();
  let onLost: ((e: unknown) => void) | undefined;
  let stops = 0;
  const sup = new TelegramSupervisor({
    start: async (_t, lost) => {
      onLost = lost;
      return 'family_bot';
    },
    stop: async () => {
      stops++;
    },
    setTimer: timers.set,
    clearTimer: timers.clear,
    log: () => {},
  });
  await sup.connect(TOKEN);
  assert.equal(sup.status.state, 'connected');
  onLost!(netErr());
  await flush();
  assert.equal(sup.status.state, 'reconnecting');
  assert.ok(stops >= 2, 'the dead poller is stopped before the retry');
  assert.deepEqual(timers.queue.map((t) => t.ms), [TELEGRAM_RETRY_MS[0]]);
});

test('forget cancels the pending retry, stops polling and reports none', async () => {
  const timers = fakeTimers();
  let stops = 0;
  const sup = new TelegramSupervisor({
    start: async () => {
      throw netErr();
    },
    stop: async () => {
      stops++;
    },
    setTimer: timers.set,
    clearTimer: timers.clear,
    log: () => {},
  });
  await sup.connect(TOKEN);
  assert.equal(timers.queue.length, 1);
  await sup.forget();
  assert.equal(timers.queue.length, 0);
  assert.deepEqual(sup.status, { state: 'none' });
  assert.ok(stops >= 1);
});

test('an empty token means none and never calls start', async () => {
  let calls = 0;
  const sup = new TelegramSupervisor({
    start: async () => {
      calls++;
      return 'x';
    },
    stop: async () => {},
    log: () => {},
  });
  assert.deepEqual(await sup.connect(''), { state: 'none' });
  assert.equal(calls, 0);
});

test('the token never appears in statuses or log lines', async () => {
  const timers = fakeTimers();
  const seen: string[] = [];
  const logs: string[] = [];
  let n = 0;
  const sup = new TelegramSupervisor({
    start: async () => {
      if (n++ < 1) throw Object.assign(new Error(`bad ${TOKEN}`), { name: 'HttpError' });
      throw refusedErr(404);
    },
    stop: async () => {},
    onChange: (s: TelegramStatus) => seen.push(JSON.stringify(s)),
    setTimer: timers.set,
    clearTimer: timers.clear,
    log: (l) => logs.push(l),
  });
  await sup.connect(TOKEN);
  timers.fire();
  await flush();
  const everything = [...seen, ...logs].join('\n');
  assert.ok(logs.length >= 2);
  assert.ok(!everything.includes(TOKEN));
  assert.ok(!everything.includes('AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'));
});
