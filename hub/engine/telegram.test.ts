import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TelegramLink } from './telegram.ts';
import type { TelegramState } from './telegram.ts';

// Pure parts only: the constructor must not create a Bot or touch the network.

test('newPairingCode is 6 digits', () => {
  const state: TelegramState = { chats: [] };
  const tg = new TelegramLink('123:fake-token', state, () => {});
  for (let i = 0; i < 50; i++) {
    const code = tg.newPairingCode();
    assert.match(code, /^\d{6}$/);
    assert.ok(Number(code) >= 100000, 'no leading-zero codes');
    assert.ok(Number(code) <= 999999);
  }
});

test('send() throws when the bot was never started', async () => {
  const state: TelegramState = { chats: [] };
  const tg = new TelegramLink('123:fake-token', state, () => {});
  await assert.rejects(tg.send('hello'), /not started/i);
});

test('send() throws when no chat is paired yet', async () => {
  const state: TelegramState = { chats: [] };
  const tg = new TelegramLink('123:fake-token', state, () => {});
  // A fake, already-wired bot so we reach the pairing check without touching Telegram.
  (tg as unknown as { bot: object }).bot = { api: { sendMessage: async () => {} } };
  await assert.rejects(tg.send('hello'), /paired/i);
});
