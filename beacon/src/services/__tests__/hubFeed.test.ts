import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EMPTY_FEED,
  MAX_ASKS,
  MAX_CHAT,
  MAX_FEED_ITEMS,
  askList,
  freshNotifications,
  mergeChat,
  mergeItems,
  pendingAsks,
  reduceWire,
  setAnswer,
  setAsk,
  type AskEntry,
  type HubFeedData,
} from '../hubFeed';
import type { FeedItem, GroupMessage } from '../wire';

const item = (id: string, at: number, tags: string[] = []): FeedItem => ({
  id,
  agentId: 'a1',
  agentName: 'Wind',
  kind: 'wind',
  title: `t ${id}`,
  body: 'b',
  severity: 'info',
  at,
  tags,
});

const chat = (id: string, at: number): GroupMessage => ({ id, from: 'phone', fromName: 'Ravi', text: id, at, kind: 'text' });

test('mergeItems: newest first, unique by id, incoming copy wins', () => {
  const out = mergeItems([item('a', 1), item('b', 5)], [item('a', 3), item('c', 2)]);
  assert.deepEqual(out.map((i) => i.id), ['b', 'a', 'c']);
  assert.equal(out[1].at, 3);
});

test('mergeItems caps the list at 100', () => {
  const many = Array.from({ length: 150 }, (_, i) => item(`x${i}`, i));
  const out = mergeItems([], many);
  assert.equal(out.length, MAX_FEED_ITEMS);
  assert.equal(out[0].id, 'x149');
});

test('mergeChat: dedupes by id and keeps 200, oldest first', () => {
  let msgs: GroupMessage[] = [];
  for (let i = 0; i < 205; i++) msgs = mergeChat(msgs, chat(`m${i}`, i));
  msgs = mergeChat(msgs, chat('m204', 204));
  assert.equal(msgs.length, MAX_CHAT);
  assert.equal(msgs[0].id, 'm5');
  assert.equal(msgs[msgs.length - 1].id, 'm204');
});

test('freshNotifications: only new items tagged notify, once', () => {
  const incoming = [item('n1', 1, ['notify']), item('q1', 2), item('n2', 3, ['notify'])];
  assert.deepEqual(freshNotifications(new Set(), incoming, []).map((i) => i.id), ['n1', 'n2']);
  // already on screen, or already notified before: nothing
  assert.deepEqual(freshNotifications(new Set(['n1']), incoming, []).map((i) => i.id), ['n2']);
  assert.deepEqual(freshNotifications(new Set(), incoming, ['n1', 'n2']), []);
});

test('reduceWire feed: stores items and reports notifications once', () => {
  const msg = { t: 'feed' as const, items: [item('f1', 10, ['notify']), item('f2', 9)] };
  const first = reduceWire(EMPTY_FEED, msg, 100);
  assert.deepEqual(first.notify.map((i) => i.id), ['f1']);
  assert.equal(first.data.items.length, 2);
  assert.deepEqual(first.data.notified, ['f1']);
  const again = reduceWire(first.data, msg, 101);
  assert.deepEqual(again.notify, []);
  assert.equal(again.data.items.length, 2);
});

test('reduceWire members: sets members and resolves you', () => {
  const members = [
    { id: 'm1', name: 'Asha', role: 'adult' as const },
    { id: 'm2', name: 'Dadi', role: 'elder' as const },
  ];
  const { data } = reduceWire(EMPTY_FEED, { t: 'members', members, you: 'm2' }, 0);
  assert.equal(data.members.length, 2);
  assert.equal(data.you?.role, 'elder');
  const none = reduceWire(data, { t: 'members', members }, 0).data;
  assert.equal(none.you, null);
});

test('reduceWire chat: appends and ignores malformed messages', () => {
  const d = reduceWire(EMPTY_FEED, { t: 'chat', msg: chat('c1', 1) }, 0).data;
  assert.equal(d.messages.length, 1);
  const dup = reduceWire(d, { t: 'chat', msg: chat('c1', 1) }, 0).data;
  assert.equal(dup.messages.length, 1);
  const bad = reduceWire(d, { t: 'chat', msg: undefined as unknown as GroupMessage }, 0).data;
  assert.equal(bad.messages.length, 1);
});

test('asks: pending until the answer arrives, then resolved', () => {
  let asks = setAsk({}, 'q1', 'Any alerts near me?', 10);
  assert.equal(pendingAsks(asks).length, 1);
  asks = setAnswer(asks, 'q1', 'No alerts right now.', true, 20);
  assert.equal(pendingAsks(asks).length, 0);
  assert.equal(asks.q1.text, 'Any alerts near me?');
  assert.equal(asks.q1.answer, 'No alerts right now.');
  assert.equal(asks.q1.ok, true);
});

test('answer for an unknown ask id is kept with empty text', () => {
  const asks = setAnswer({}, 'zz', 'Hello', false, 5);
  assert.equal(asks.zz.text, '');
  assert.equal(asks.zz.ok, false);
});

test('asks are capped and listed newest first', () => {
  let asks: Record<string, AskEntry> = {};
  for (let i = 0; i < MAX_ASKS + 10; i++) asks = setAsk(asks, `q${i}`, 'x', i);
  assert.equal(Object.keys(asks).length, MAX_ASKS);
  assert.equal(askList(asks)[0][0], `q${MAX_ASKS + 9}`);
  assert.equal(asks['q0'], undefined);
});

test('reduceWire answer updates the matching ask via the full reducer', () => {
  const start: HubFeedData = { ...EMPTY_FEED, asks: setAsk({}, 'a1', 'Wind?', 1) };
  const { data } = reduceWire(start, { t: 'answer', id: 'a1', text: 'Wind is 20 km/h.', ok: true }, 9);
  assert.equal(data.asks.a1.answer, 'Wind is 20 km/h.');
  assert.equal(data.asks.a1.at, 9);
});
