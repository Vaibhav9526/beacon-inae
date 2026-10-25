import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cleanRoutes, defaultRoutes, Gateway, type GatewayOptions } from './gateway.ts';
import { Members } from './members.ts';
import { decodeWire, newGroupKey } from './wire.ts';
import type { FeedItem, GatewayRoute, WireMessage } from './types.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'gateway-'));

const item = (id: string, over: Partial<FeedItem> = {}): FeedItem => ({
  id,
  agentId: 'a-news',
  agentName: 'News',
  kind: 'news',
  title: `Title ${id}`,
  body: 'Body text.',
  severity: 'info',
  at: 1,
  tags: [],
  ...over,
});

/** A family: an adult (Vaibhav) and an elder (Maa) and a child, all with paired phones. */
function family() {
  const members = new Members(join(dir(), 'members.json'));
  const adult = members.add(null, { name: 'Vaibhav', role: 'adult' });
  const elder = members.add(adult.id, { name: 'Maa', role: 'elder' });
  const kid = members.add(adult.id, { name: 'Kid', role: 'child' });
  members.redeemInvite(members.createInvite(adult.id).code, 'phone-adult');
  members.redeemInvite(members.createInvite(elder.id).code, 'phone-elder');
  members.redeemInvite(members.createInvite(kid.id).code, 'phone-kid');
  return { members, adult, elder, kid };
}

interface Sent {
  deviceId: string;
  blobs: string[];
}

function setup(over: Partial<GatewayOptions> & { file?: string } = {}) {
  const gk = newGroupKey();
  const sent: Sent[] = [];
  const telegram: string[] = [];
  const { members } = family();
  const opts: GatewayOptions = {
    members,
    groupKey: () => gk,
    sendToPhone: async (deviceId, blobs) => {
      sent.push({ deviceId, blobs });
    },
    sendTelegram: async (text) => {
      telegram.push(text);
    },
    ...over,
  };
  const file = over.file ?? join(dir(), 'gateway.json');
  const gw = new Gateway(file, opts);
  /** every item the phone of `deviceId` received, decoded */
  const received = (deviceId: string): FeedItem[] =>
    sent
      .filter((s) => s.deviceId === deviceId)
      .flatMap((s) => s.blobs.map((b) => decodeWire(b, gk) as Extract<WireMessage, { t: 'feed' }>).flatMap((m) => m.items));
  return { gw, gk, sent, telegram, received, members };
}

test('defaultRoutes: urgent to all phones, news quiet, health to adults only', () => {
  const routes = defaultRoutes();
  const byId = Object.fromEntries(routes.map((r) => [r.id, r]));
  assert.equal(byId.urgent!.match.minSeverity, 'warning');
  assert.deepEqual(byId.urgent!.to, { phones: 'all' });
  assert.deepEqual(byId['health-adults']!.match.kinds, ['health']);
  assert.deepEqual(byId['health-adults']!.to, { phones: 'all', roles: ['adult'] });
  assert.ok(routes.every((r) => r.enabled));
});

test('a fresh gateway starts with the default routes, and routes() / setRoutes() persist', () => {
  const file = join(dir(), 'gateway.json');
  const { gw } = setup({ file });
  assert.deepEqual(gw.routes().map((r) => r.id), defaultRoutes().map((r) => r.id));
  const custom: GatewayRoute[] = [{ id: 'only', name: 'Only', enabled: true, match: {}, to: { phones: 'all' } }];
  gw.setRoutes(custom);
  const again = new Gateway(file, { members: setup().members, groupKey: () => newGroupKey(), sendToPhone: async () => {} });
  assert.deepEqual(again.routes(), custom);
});

test('dedupe: the same item is not sent twice, even after a reload', async () => {
  const file = join(dir(), 'gateway.json');
  const a = setup({ file });
  const first = await a.gw.dispatch([item('n1'), item('n2')]);
  assert.equal(first.delivered, 2);
  assert.equal(first.skipped, 0);
  const second = await a.gw.dispatch([item('n1'), item('n3')]);
  assert.equal(second.skipped, 1, 'n1 was seen');
  assert.equal(second.delivered, 1);
  const b = setup({ file });
  const after = await b.gw.dispatch([item('n2')]);
  assert.equal(after.delivered, 0, 'the seen set survived a reload');
  assert.equal(after.skipped, 1);
});

test('dedupe: the seen set keeps only the last 2000 ids', async () => {
  const file = join(dir(), 'gateway.json');
  const s = setup({ file });
  const many = Array.from({ length: 2005 }, (_, i) => item(`x${i}`));
  await s.gw.dispatch(many);
  const saved = JSON.parse(readFileSync(file, 'utf8')) as { seen: string[] };
  assert.equal(saved.seen.length, 2000);
  assert.equal(saved.seen[0], 'x5');
});

test('route precedence: the first matching route wins unless continue is set', async () => {
  const s = setup();
  s.gw.setRoutes([
    { id: 'first', name: 'First', enabled: true, match: { kinds: ['news'] }, to: { phones: 'all', roles: ['elder'] } },
    { id: 'second', name: 'Second', enabled: true, match: { kinds: ['news'] }, to: { phones: 'all', roles: ['child'] } },
  ]);
  const r = await s.gw.dispatch([item('p1')]);
  assert.deepEqual(r.byRoute, { first: 1 });
  assert.equal(s.received('phone-elder').length, 1);
  assert.equal(s.received('phone-kid').length, 0, 'second route did not run');

  s.gw.setRoutes([
    { id: 'first', name: 'First', enabled: true, match: { kinds: ['news'] }, to: { phones: 'all', roles: ['elder'] }, continue: true },
    { id: 'second', name: 'Second', enabled: true, match: { kinds: ['news'] }, to: { phones: 'all', roles: ['child'] } },
  ]);
  const r2 = await s.gw.dispatch([item('p2')]);
  assert.deepEqual(r2.byRoute, { first: 1, second: 1 });
  assert.equal(s.received('phone-kid').length, 1, 'continue let the second route run');
});

test('disabled routes are ignored, and an unmatched item is skipped', async () => {
  const s = setup();
  s.gw.setRoutes([{ id: 'off', name: 'Off', enabled: false, match: {}, to: { phones: 'all' } }]);
  const r = await s.gw.dispatch([item('u1')]);
  assert.equal(r.delivered, 0);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.byRoute, {});
  assert.equal(s.sent.length, 0);
});

test('roles: health items go to adults only; the elder and child phones get nothing', async () => {
  const s = setup();
  const r = await s.gw.dispatch([item('h1', { kind: 'health', severity: 'warning', title: 'Heart rate high' })]);
  assert.deepEqual(r.byRoute, { 'health-adults': 1 }, 'health matches its own route first, so the urgent route does not run');
  assert.equal(s.received('phone-adult').length, 1);
  assert.equal(s.received('phone-elder').length, 0);
  assert.equal(s.received('phone-kid').length, 0);
});

test('roles: a route with roles and members narrows the recipients', async () => {
  const s = setup();
  const kid = s.members.list().find((m) => m.name === 'Kid')!;
  s.gw.setRoutes([{ id: 'picked', name: 'Picked', enabled: true, match: {}, to: { phones: 'all', members: [kid.id] } }]);
  await s.gw.dispatch([item('m1')]);
  assert.equal(s.received('phone-kid').length, 1);
  assert.equal(s.received('phone-adult').length, 0);
  assert.equal(s.received('phone-elder').length, 0);
});

test('phones: none with telegram reaches Telegram only', async () => {
  const s = setup();
  s.gw.setRoutes([{ id: 'tg', name: 'Telegram only', enabled: true, match: { minSeverity: 'warning' }, to: { phones: 'none', telegram: true } }]);
  const r = await s.gw.dispatch([item('t1', { severity: 'severe', title: 'Flood' })]);
  assert.equal(s.sent.length, 0);
  assert.equal(r.delivered, 1, 'Telegram counts as delivered');
  assert.deepEqual(s.telegram, ['News: Flood']);
});

test('telegram: sent once per item, only at warning or above, and only when the route asks', async () => {
  const s = setup();
  s.gw.setRoutes([
    { id: 'a', name: 'A', enabled: true, match: {}, to: { phones: 'none', telegram: true }, continue: true },
    { id: 'b', name: 'B', enabled: true, match: {}, to: { phones: 'none', telegram: true } },
  ]);
  await s.gw.dispatch([item('i1', { severity: 'info' }), item('w1', { severity: 'warning', title: 'Wind' })]);
  assert.deepEqual(s.telegram, ['News: Wind'], 'info is not sent; the warning is sent once even though two routes match');

  const s2 = setup();
  s2.gw.setRoutes([{ id: 'quiet', name: 'Quiet', enabled: true, match: {}, to: { phones: 'all' } }]);
  await s2.gw.dispatch([item('w2', { severity: 'severe' })]);
  assert.deepEqual(s2.telegram, [], 'a route without telegram sends nothing to Telegram');
});

test('notify tag: items at or above notifyFrom get the tag, others do not', async () => {
  const s = setup();
  await s.gw.dispatch([
    item('quiet-news', { severity: 'info' }),
    item('urgent-flood', { kind: 'flood', severity: 'warning' }),
    item('severe-news', { kind: 'news', severity: 'severe' }),
  ]);
  const got = s.received('phone-adult');
  const tags = Object.fromEntries(got.map((i) => [i.id, i.tags]));
  assert.ok(!tags['quiet-news']!.includes('notify'), 'info news is not notified (default route notifies from severe)');
  assert.ok(tags['severe-news']!.includes('notify'));
  assert.ok(tags['urgent-flood']!.includes('notify'), 'warning urgent is notified');
});

test('notify tag: a route notifyFrom changes the threshold, and the tag is not doubled', async () => {
  const s = setup();
  s.gw.setRoutes([
    { id: 'strict', name: 'Strict', enabled: true, match: {}, to: { phones: 'all' }, notifyFrom: 'info', continue: true },
    { id: 'again', name: 'Again', enabled: true, match: {}, to: { phones: 'all', roles: ['adult'] }, notifyFrom: 'severe' },
  ]);
  await s.gw.dispatch([item('x1', { severity: 'info' })]);
  const adultCopy = s.received('phone-adult')[0]!;
  assert.equal(adultCopy.tags.filter((t) => t === 'notify').length, 1);
  const elderCopy = s.received('phone-elder')[0]!;
  assert.deepEqual(elderCopy.tags, ['notify'], 'info is notified by the strict route only');
});

test('the blob for a phone decodes to a feed message and fits the size limit', async () => {
  const s = setup();
  const many = Array.from({ length: 40 }, (_, i) => item(`big${i}`, { body: 'lorem ipsum '.repeat(30) }));
  await s.gw.dispatch(many);
  const blobs = s.sent.find((x) => x.deviceId === 'phone-elder')!.blobs;
  assert.ok(blobs.length > 1, 'split into several blobs');
  for (const b of blobs) assert.ok(b.length <= 8000);
  assert.equal(s.received('phone-elder').length, 40);
});

test('failures do not stop other phones or other items', async () => {
  const s = setup({
    sendToPhone: async (deviceId, blobs) => {
      if (deviceId === 'phone-elder') throw new Error('relay down');
      s.sent.push({ deviceId, blobs });
    },
    sendTelegram: async () => {
      throw new Error('telegram down');
    },
  });
  s.gw.setRoutes([
    { id: 'all', name: 'All', enabled: true, match: {}, to: { phones: 'all' } },
    { id: 'tg', name: 'TG', enabled: true, match: {}, to: { phones: 'none', telegram: true }, continue: true },
  ]);
  const r = await s.gw.dispatch([item('f1', { severity: 'severe' }), item('f2', { severity: 'info' })]);
  assert.equal(s.received('phone-adult').length, 2, 'the adult still got both items');
  assert.equal(s.received('phone-kid').length, 2, 'the child still got both items');
  assert.equal(s.received('phone-elder').length, 0, 'the failing phone got nothing');
  assert.equal(r.delivered, 2, 'both items reached the adult and kid phones');
  assert.equal(r.skipped, 0);
});

test('an item whose every delivery fails is counted as skipped, and dispatch still resolves', async () => {
  const s = setup({
    sendToPhone: async () => {
      throw new Error('offline');
    },
  });
  s.gw.setRoutes([{ id: 'all', name: 'All', enabled: true, match: {}, to: { phones: 'all' } }]);
  const r = await s.gw.dispatch([item('z1')]);
  assert.equal(r.delivered, 0);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.byRoute, { all: 1 });
});

test('an item goes to a phone once even when two routes match it', async () => {
  const s = setup();
  s.gw.setRoutes([
    { id: 'a', name: 'A', enabled: true, match: {}, to: { phones: 'all', roles: ['adult'] }, continue: true },
    { id: 'b', name: 'B', enabled: true, match: {}, to: { phones: 'all', roles: ['adult'] } },
  ]);
  await s.gw.dispatch([item('dup')]);
  assert.equal(s.received('phone-adult').length, 1);
});

test('cleanRoutes: the routes must be an array, at most 30, each an object', () => {
  assert.throws(() => cleanRoutes('all'), /must be an array/);
  assert.throws(() => cleanRoutes(undefined), /must be an array/);
  assert.throws(() => cleanRoutes({ id: 'x' }), /must be an array/);
  assert.throws(() => cleanRoutes(Array.from({ length: 31 }, () => ({}))), /at most 30/);
  assert.equal(cleanRoutes(Array.from({ length: 30 }, () => ({}))).length, 30);
  assert.throws(() => cleanRoutes([{ id: 'ok' }, null]), /route 2 must be an object/);
  assert.throws(() => cleanRoutes(['nope']), /route 1 must be an object/);
  assert.deepEqual(cleanRoutes([]), []);
});

test('cleanRoutes: invalid kinds, severities and roles are dropped, unknown keys too', () => {
  const [r] = cleanRoutes([
    {
      id: 'k',
      name: 'K',
      extra: 1,
      match: { kinds: ['news', 'bogus', 'flood', 7], minSeverity: 'panic', agents: ['a', 3, '  '], zap: true },
      to: { phones: 'all', roles: ['adult', 'boss'], members: ['m1', null], secret: 'x' },
      notifyFrom: 'loud',
    },
  ]);
  assert.deepEqual(r!.match, { kinds: ['news', 'flood'], agents: ['a'] });
  assert.deepEqual(r!.to, { phones: 'all', roles: ['adult'], members: ['m1'] });
  assert.equal(r!.notifyFrom, undefined);
  assert.ok(!('extra' in r!));
});

test('cleanRoutes: defaults are filled and text is trimmed and capped', () => {
  const [a, b] = cleanRoutes([{ id: 'a' }, { name: '   ', to: 'everyone' }]);
  assert.deepEqual(a, { id: 'a', name: 'Route', enabled: true, match: {}, to: { phones: 'all' } });
  assert.equal(b!.name, 'Route');
  assert.equal(b!.to.phones, 'all');
  assert.match(b!.id, /^r-[0-9a-f]{8}$/, 'missing id is generated');
  const [long] = cleanRoutes([{ id: 'l', name: `  ${'n'.repeat(100)}  `, to: { phones: 'none', telegram: true }, notifyFrom: 'severe', continue: true, enabled: 'yes' }]);
  assert.equal(long!.name.length, 60);
  assert.deepEqual(long!.to, { phones: 'none', telegram: true });
  assert.equal(long!.notifyFrom, 'severe');
  assert.equal(long!.continue, true);
  assert.equal(long!.enabled, true, 'non-boolean enabled falls back to true');
});

test('cleanRoutes: ids are unique, duplicates get a fresh id', () => {
  const out = cleanRoutes([{ id: 'same' }, { id: 'same' }, {}, { id: '' }]);
  const ids = out.map((r) => r.id);
  assert.equal(new Set(ids).size, 4);
  assert.equal(ids[0], 'same');
  assert.notEqual(ids[1], 'same');
});

test('setRoutes cleans its input and rejects bad input without changing the routes', () => {
  const s = setup();
  s.gw.setRoutes([{ id: 'keep', name: 'Keep', enabled: true, match: {}, to: { phones: 'all' } }]);
  assert.throws(() => s.gw.setRoutes('all'), /must be an array/);
  assert.throws(() => s.gw.setRoutes([42]), /route 1 must be an object/);
  assert.deepEqual(s.gw.routes().map((r) => r.id), ['keep'], 'routes were not replaced by the bad input');
  s.gw.setRoutes([{ id: 'x', match: { kinds: ['nope'] } }]);
  assert.deepEqual(s.gw.routes()[0]!.match, { kinds: [] });
});
