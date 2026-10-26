import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { toHex, utf8 } from '../../mesh/bytes';
import { decodeGeohash } from '../../mesh/geohash';
import { type GlobalMsg, canSend, cursorOf, deviceTagOf, errorText, filterMuted, isOffline, mergeMessages, replaceLocal, roomForCoords, setStatus } from '../globalChatCore';

const msg = (id: string, ts: number, o: Partial<GlobalMsg> = {}): GlobalMsg => ({ id, room: 'global', ts, nick: 'A', text: id, device: 'aaaaaaaa', flags: [], ...o });

test('merge dedupes by id, sorts by time and caps', () => {
  const a = [msg('b', 20), msg('a', 10)];
  const out = mergeMessages(a, [msg('c', 30), msg('a', 10)]);
  assert.deepEqual(out.map((m) => m.id), ['a', 'b', 'c']);
  const many = Array.from({ length: 250 }, (_, i) => msg(`m${i}`, i));
  const capped = mergeMessages([], many);
  assert.equal(capped.length, 200);
  assert.equal(capped[0]!.id, 'm50');
});

test('pending messages stay at the end and do not move the cursor', () => {
  const out = mergeMessages([msg('x', 5, { status: 'sending' })], [msg('s1', 100)]);
  assert.deepEqual(out.map((m) => m.id), ['s1', 'x']);
  assert.equal(cursorOf(out), 100);
});

test('status updates and replacing a local echo with the server copy', () => {
  let list = mergeMessages([], [msg('local-1', 1, { status: 'sending' })]);
  list = setStatus(list, 'local-1', 'failed', 'You are sending too fast');
  assert.equal(list[0]!.status, 'failed');
  assert.equal(list[0]!.error, 'You are sending too fast');
  list = setStatus(list, 'local-1', 'sending');
  const real = msg('srv1', 50);
  // the poll can deliver the real message before the send call returns
  list = mergeMessages(list, [real]);
  list = replaceLocal(list, 'local-1', real);
  assert.deepEqual(list.map((m) => m.id), ['srv1']);
  assert.equal(list[0]!.status, undefined);
});

test('muted devices are filtered out', () => {
  const l = [msg('1', 1, { device: 'aaaaaaaa' }), msg('2', 2, { device: 'bbbbbbbb' })];
  assert.deepEqual(filterMuted(l, ['bbbbbbbb']).map((m) => m.id), ['1']);
  assert.equal(filterMuted(l, []).length, 2);
});

test('region room comes from a 2 character geohash', () => {
  const room = roomForCoords(28.61, 77.21); // Delhi
  assert.equal(room, 'region-tt');
  assert.match(room, /^region-[0-9bcdefghjkmnpqrstuvwxyz]{2}$/);
  const c = decodeGeohash(room.slice(7));
  assert.ok(Math.abs(c.lat - 28.61) < 6 && Math.abs(c.lon - 77.21) < 12);
});

test('device tag is the first 8 hex of sha256, matching the server', () => {
  assert.equal(deviceTagOf('abc'), toHex(sha256(utf8('abc'))).slice(0, 8));
  assert.equal(deviceTagOf('abc'), 'ba7816bf');
});

test('send validation and friendly errors', () => {
  assert.equal(canSend('   '), false);
  assert.equal(canSend('hi'), true);
  assert.equal(canSend('x'.repeat(301)), false);
  assert.equal(errorText(429).en, 'You are sending too fast');
  assert.equal(errorText(403).en, 'You are blocked from this chat');
  assert.match(errorText(0).en, /needs internet/);
  assert.equal(isOffline(new TypeError('Network request failed')), true);
  assert.equal(isOffline({ status: 0 }), true);
  assert.equal(isOffline({ status: 500 }), false);
});
