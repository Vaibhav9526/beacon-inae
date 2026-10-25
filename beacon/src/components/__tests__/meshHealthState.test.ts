import assert from 'node:assert/strict';
import { test } from 'node:test';
import { peerBars, relayedToday, seenAgo, transportLabel, waitingToRelay } from '../meshHealthState';

const peer = (over: { direct?: boolean; lastSeen?: number }) =>
  ({ id: 'a', nickname: 'A', noiseKey: new Uint8Array(), signKey: new Uint8Array(), lastSeen: 1, direct: false, ...over }) as Parameters<typeof peerBars>[0];

test('seenAgo walks seconds, minutes, hours and days', () => {
  const now = 1_700_000_000_000;
  assert.equal(seenAgo(now, now), 'seen 0 seconds ago');
  assert.equal(seenAgo(now - 12_000, now), 'seen 12 seconds ago');
  assert.equal(seenAgo(now - 60_000, now), 'seen 1 minute ago');
  assert.equal(seenAgo(now - 5 * 60_000, now), 'seen 5 minutes ago');
  assert.equal(seenAgo(now - 2 * 3600_000, now), 'seen 2 hours ago');
  assert.equal(seenAgo(now - 24 * 3600_000, now), 'seen yesterday');
  assert.equal(seenAgo(now - 3 * 24 * 3600_000, now), 'seen 3 days ago');
  assert.ok(!seenAgo(now - 500, now).includes('-'), 'future timestamps clamp to zero');
});

test('signal bars: direct beats via relay, staleness takes one, nothing is beyond 3', () => {
  const now = 1_700_000_000_000;
  assert.equal(peerBars(peer({ direct: true, lastSeen: now - 5_000 }), now), 3, 'fresh direct link');
  assert.equal(peerBars(peer({ direct: true, lastSeen: now - 120_000 }), now), 2, 'direct but stale');
  assert.equal(peerBars(peer({ direct: false, lastSeen: now - 5_000 }), now), 1, 'reached through other phones');
  assert.equal(peerBars(peer({ direct: false, lastSeen: now - 300_000 }), now), 0, 'known only from an old announcement');
  for (const ms of [0, 5_000, 120_000, 300_000]) assert.ok(peerBars(peer({ lastSeen: now - ms }), now) <= 3);
});

test('relayedToday counts only hopped messages from today (midnight boundary by clock)', () => {
  const base = new Date(1_700_024_000_000);
  base.setHours(15, 0, 0, 0);
  const now = base.getTime();
  const morning = new Date(base); morning.setHours(9, 0, 0, 0);
  const lunch = new Date(base); lunch.setHours(12, 0, 0, 0);
  const yesterday = new Date(base); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(15, 0, 0, 0);
  assert.equal(
    relayedToday(
      [
        { hops: 3, timestamp: morning.getTime() },
        { hops: 0, timestamp: lunch.getTime() },
        { hops: 1, timestamp: lunch.getTime() },
        { hops: 2, timestamp: yesterday.getTime() },
      ],
      now,
    ),
    2,
    "hop-less and yesterday's messages stay out of today's tally",
  );
});

test('waitingToRelay counts only peers without a direct link', () => {
  const now = 1_700_000_000_000;
  const peers = [peer({ direct: true, lastSeen: now }), peer({ direct: false, lastSeen: now }), peer({ direct: false, lastSeen: now })];
  assert.equal(waitingToRelay(peers), 2);
  assert.equal(waitingToRelay([]), 0);
});

test('transportLabel reads every mesh status', () => {
  assert.equal(transportLabel('running', true), 'Bluetooth on');
  assert.equal(transportLabel('starting', true), 'Starting the Bluetooth radio');
  assert.equal(transportLabel('no-permission', true), 'Bluetooth permission missing');
  assert.equal(transportLabel('bluetooth-off', true), 'Bluetooth is turned off');
  assert.equal(transportLabel('unsupported', false), 'No radio in this build: chat still works over the in-memory link', 'no radio wins over any status');
  assert.equal(transportLabel('unsupported', true), 'No radio here (emulator or Expo Go)');
  assert.equal(transportLabel('error', true), 'The mesh could not start');
  assert.equal(transportLabel('idle', true), 'Not started yet');
  assert.equal(transportLabel('running', false), 'No radio in this build: chat still works over the in-memory link');
});
