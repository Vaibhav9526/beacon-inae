import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HubApp } from './app.ts';
import { MSG_REJECTED } from './telegram.ts';

// Fake values: they only have the shape the Hub checks for.
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const OTHER_TOKEN = '987654321:ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ';
const OWM = 'owmkey0123456789abcd';
const OWM_NEW = 'newowmkey0123456789';

const netErr = () => Object.assign(new Error("Network request for 'getMe' failed!"), { name: 'HttpError' });

async function waitFor(cond: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const secretsOnDisk = (dir: string) => JSON.parse(readFileSync(join(dir, 'secrets.json'), 'utf8')) as Record<string, unknown>;

test('the bot token and the OpenWeather key survive a restart on the same folder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keys-'));
  const started: string[] = [];
  const first = new HubApp({
    dir,
    offline: true,
    interactive: false,
    telegramProbe: async () => 'family_bot',
    telegramStart: async (token) => {
      started.push(token);
      return 'family_bot';
    },
  });
  await first.connectTelegram(TOKEN);
  first.setOpenWeatherKey(OWM);
  assert.equal(first.telegramInfo().connected, true);
  assert.equal(secretsOnDisk(dir).telegramToken, TOKEN, 'written to disk at once');
  assert.equal(secretsOnDisk(dir).openWeatherKey, OWM);
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'secrets.json')).mode & 0o077, 0);

  // "closing and reopening the app": a new HubApp on the same folder reconnects by itself
  const second = new HubApp({
    dir,
    offline: true,
    interactive: false,
    telegramProbe: async () => 'family_bot',
    telegramStart: async (token) => {
      started.push(token);
      return 'family_bot';
    },
  });
  await waitFor(() => second.telegramSup.status.state === 'connected');
  assert.deepEqual(started, [TOKEN, TOKEN]);
  assert.equal(second.state().connections.openWeather.hasKey, true);
});

test('state never contains a full key; it shows only "Saved (ends ...xxxx)"', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keys-mask-'));
  const app = new HubApp({ dir, offline: true, interactive: false, telegramStart: async () => 'family_bot', telegramProbe: async () => 'family_bot' });
  await app.connectTelegram(TOKEN);
  app.setOpenWeatherKey(OWM);
  const text = JSON.stringify(app.state());
  assert.ok(!text.includes(TOKEN));
  assert.ok(!text.includes(OWM));
  assert.ok(!text.includes(TOKEN.slice(0, 20)), 'not even a long part of the token');
  assert.equal(app.state().connections.openWeather.hint, `Saved (ends ...${OWM.slice(-4)})`);
  assert.equal(app.telegramInfo().hint, `Saved (ends ...${TOKEN.slice(-4)})`);
  assert.equal(app.telegramInfo().saved, true);
});

test('an empty save does not erase a saved key; a new value replaces it; Remove key clears it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keys-empty-'));
  const app = new HubApp({ dir, offline: true, interactive: false, telegramStart: async () => 'family_bot', telegramProbe: async () => 'family_bot' });
  await app.connectTelegram(TOKEN);
  app.setOpenWeatherKey(OWM);

  app.setOpenWeatherKey('   ');
  assert.equal(app.state().connections.openWeather.hasKey, true);
  await assert.rejects(app.connectTelegram('  '), /Paste the bot token first/);
  assert.equal(app.telegramInfo().saved, true);
  assert.equal(secretsOnDisk(dir).openWeatherKey, OWM);
  assert.equal(secretsOnDisk(dir).telegramToken, TOKEN);

  app.setOpenWeatherKey(OWM_NEW);
  assert.equal(app.state().connections.openWeather.hint, `Saved (ends ...${OWM_NEW.slice(-4)})`);
  assert.equal(secretsOnDisk(dir).openWeatherKey, OWM_NEW);

  app.removeOpenWeatherKey();
  assert.equal(app.state().connections.openWeather.hasKey, false);
  assert.equal('openWeatherKey' in secretsOnDisk(dir), false);

  await app.removeTelegramToken();
  assert.equal(app.telegramInfo().saved, false);
  assert.equal(app.telegramInfo().state, 'none');
  assert.equal('telegramToken' in secretsOnDisk(dir), false);
});

test('Telegram refusing a new token keeps the working one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keys-reject-'));
  const app = new HubApp({
    dir,
    offline: true,
    interactive: false,
    telegramStart: async () => 'family_bot',
    telegramProbe: async (t) => {
      if (t === OTHER_TOKEN) throw Object.assign(new Error("Call to 'getMe' failed! (401: Unauthorized)"), { error_code: 401 });
      return 'family_bot';
    },
  });
  await app.connectTelegram(TOKEN);
  await assert.rejects(app.connectTelegram(OTHER_TOKEN), (e: Error) => e.message === MSG_REJECTED && !e.message.includes(OTHER_TOKEN));
  assert.equal(secretsOnDisk(dir).telegramToken, TOKEN);
  assert.equal(app.telegramInfo().connected, true);
});

test('no network at startup: the token stays saved, the app retries, and Retry now connects', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keys-net-'));
  // the state an earlier run left behind: a saved token and an OpenWeather key
  writeFileSync(join(dir, 'secrets.json'), JSON.stringify({ brain: 'none', allowed: [], telegram: { chats: [] }, relayUrl: 'http://127.0.0.1:8787', allowAdultAsks: false, inboxSince: 0, telegramToken: TOKEN, openWeatherKey: OWM }));

  let online = false;
  const app = new HubApp({
    dir,
    offline: true,
    interactive: false,
    telegramDelays: [1, 1],
    telegramStart: async () => {
      if (!online) throw netErr();
      return 'family_bot';
    },
  });
  await waitFor(() => app.telegramSup.status.state === 'unreachable');
  assert.equal(app.telegramInfo().saved, true, 'a failed start never removes the token');
  assert.equal(secretsOnDisk(dir).telegramToken, TOKEN);
  assert.equal(app.state().connections.openWeather.hasKey, true);

  online = true;
  await app.retryTelegram();
  assert.equal(app.telegramInfo().connected, true);
});
