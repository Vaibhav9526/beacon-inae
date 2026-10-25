import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { BeaconLink } from './beaconLink.ts';
import { HubApp } from './app.ts';
import { decodeWire, encodeWire } from './wire.ts';
import type { WireMessage } from './types.ts';

// ---- helpers ---------------------------------------------------------------

interface Sent {
  deviceId: string;
  msg: WireMessage;
}
type Of<T extends WireMessage['t']> = Extract<WireMessage, { t: T }>;
const ofType = <T extends WireMessage['t']>(msgs: WireMessage[], t: T): Of<T>[] => msgs.filter((m): m is Of<T> => m.t === t);
const toDev = (sent: Sent[], deviceId: string): WireMessage[] => sent.filter((s) => s.deviceId === deviceId).map((s) => s.msg);
const settle = () => new Promise((r) => setTimeout(r, 5));

/**
 * A fake relay link. Phones' messages are queued in `queue` (the inbox), and every blob the hub sends a phone is
 * decrypted with the group key and recorded in `sent`.
 */
function fakeLink() {
  const sent: Sent[] = [];
  const queue: Array<{ id: string; from: string; kind: string; blob: string; at: number }> = [];
  const keyRef: { gk: () => Uint8Array } = { gk: () => new Uint8Array(32) };
  const link = {
    channel: 'beacon',
    register() {},
    phones: () => [],
    send() {},
    inbox: async (since: number) => queue.filter((i) => i.at > since),
    sendToPhone: async (deviceId: string, blob: string) => {
      const msg = decodeWire(blob, keyRef.gk());
      assert.ok(msg, 'the hub sent a blob that does not decrypt with the group key');
      sent.push({ deviceId, msg });
    },
    pairingQr: async () => ({ qr: 'data:image/png;base64,AA', payload: '{}' }),
  } as unknown as BeaconLink;
  return { link, sent, queue, keyRef };
}

function setup(offline = true) {
  const fake = fakeLink();
  const app = new HubApp({ dir: mkdtempSync(join(tmpdir(), 'hubv2-')), offline, link: fake.link });
  fake.keyRef.gk = () => app.groupKey();
  return { app, ...fake };
}

/** Pair a phone to a member the way the phone does it: scan the invite, then say hello with the code. */
async function pairMember(app: HubApp, memberId: string, deviceId: string) {
  const { code } = await app.invite(memberId);
  await app.onWire(deviceId, { t: 'hello', name: deviceId, invite: code });
  await settle();
}

// ---- 1. members and pairing -----------------------------------------------

test('pairing: an invite makes the member a phone; the phone gets the group and recent chat', async () => {
  const { app, sent } = setup();
  const vaibhav = app.addMember({ name: 'Vaibhav', role: 'adult' });
  const nani = app.addMember({ name: 'Nani', role: 'elder' });
  app.sendChat('Welcome to the family');

  const inv = await app.invite(vaibhav.id);
  assert.match(inv.code, /^[A-Z2-9]{8}$/);
  assert.equal(inv.qr, 'data:image/png;base64,AA');

  await app.onWire('dev-vaibhav', { t: 'hello', name: 'Vaibhav phone', invite: inv.code });
  await settle();
  assert.equal(app.members.get(vaibhav.id)?.deviceId, 'dev-vaibhav');

  const got = toDev(sent, 'dev-vaibhav');
  const members = ofType(got, 'members');
  assert.equal(members.length, 1);
  assert.equal(members[0]!.you, vaibhav.id);
  assert.deepEqual(members[0]!.members.map((m) => m.name).sort(), ['Nani', 'Vaibhav']);
  assert.ok(ofType(got, 'chat').some((m) => m.msg.text === 'Welcome to the family'), 'recent chat is sent after pairing');

  // the elder pairs too, and the elder's invite cannot be used by anyone else
  await pairMember(app, nani.id, 'dev-nani');
  assert.equal(app.members.get(nani.id)?.deviceId, 'dev-nani');
  await app.onWire('dev-intruder', { t: 'hello', name: 'Intruder', invite: inv.code });
  assert.equal(app.members.byDevice('dev-intruder'), undefined, 'a used invite does not pair a second phone');
});

test('an unknown phone without an invite waits in pendingJoins and an adult can approve it', async () => {
  const { app, sent } = setup();
  const vaibhav = app.addMember({ name: 'Vaibhav', role: 'adult' });
  await pairMember(app, vaibhav.id, 'dev-vaibhav');
  sent.length = 0;

  await app.onWire('dev-rohan', { t: 'hello', name: 'Rohan' });
  await app.onWire('dev-rohan', { t: 'hello', name: 'Rohan again' });
  const joins = app.state().group.pendingJoins;
  assert.equal(joins.length, 1, 'a second hello from the same device does not add a second request');
  assert.equal(joins[0]!.deviceId, 'dev-rohan');
  assert.equal(joins[0]!.name, 'Rohan');

  const child = app.approveJoin('dev-rohan', 'child');
  assert.equal(child.role, 'child');
  assert.equal(child.name, 'Rohan');
  assert.equal(app.members.byDevice('dev-rohan')?.id, child.id);
  assert.equal(app.state().group.pendingJoins.length, 0);
  assert.ok(ofType(toDev(sent, 'dev-rohan'), 'members').length === 1, 'the new member gets the group');
  assert.throws(() => app.approveJoin('dev-nobody', 'child'), /No such join request/);
});

// ---- 2. group chat -----------------------------------------------------------

async function familyOfThree() {
  const env = setup();
  const { app } = env;
  const vaibhav = app.addMember({ name: 'Vaibhav', role: 'adult' });
  const nani = app.addMember({ name: 'Nani', role: 'elder' });
  const papa = app.addMember({ name: 'Papa', role: 'adult' });
  await pairMember(app, vaibhav.id, 'dev-a');
  await pairMember(app, nani.id, 'dev-e');
  await pairMember(app, papa.id, 'dev-p');
  env.sent.length = 0;
  return { ...env, vaibhav, nani, papa };
}

test('a chat from a paired phone is stored with the sender from the device, and fanned out to the others only', async () => {
  const { app, sent, vaibhav } = await familyOfThree();

  await app.onWire('dev-a', {
    t: 'chat',
    msg: { id: 'x', from: 'someone-else', fromName: 'Mallory', text: '  Dinner at 8  ', at: 1, kind: 'text' },
  } as unknown as WireMessage);
  await settle();

  const last = app.messages().at(-1)!;
  assert.equal(last.text, 'Dinner at 8', 'text is trimmed');
  assert.equal(last.from, vaibhav.id, 'the sender is the paired member');
  assert.equal(last.fromName, 'Vaibhav', 'a spoofed fromName is ignored');

  const recipients = sent.filter((s) => ofType([s.msg], 'chat').some((m) => m.msg.text === 'Dinner at 8')).map((s) => s.deviceId).sort();
  assert.deepEqual(recipients, ['dev-e', 'dev-p'], 'the other members get it, the sender does not');
});

test('a chat from an unknown device is ignored', async () => {
  const { app, sent } = await familyOfThree();
  const before = app.messages().length;
  await app.onWire('dev-stranger', { t: 'chat', msg: { id: 'x', from: 'a', fromName: 'a', text: 'hi', at: 1, kind: 'text' } } as unknown as WireMessage);
  await settle();
  assert.equal(app.messages().length, before);
  assert.equal(sent.length, 0);
});

test('a desktop message reaches every paired phone', async () => {
  const { app, sent } = await familyOfThree();
  const msg = app.sendChat('  Hello all  ');
  await settle();
  assert.equal(msg.text, 'Hello all');
  assert.equal(msg.fromName, 'Vaibhav');
  assert.deepEqual(sent.map((s) => s.deviceId).sort(), ['dev-a', 'dev-e', 'dev-p']);
  assert.throws(() => app.sendChat('   '), /Message is empty/);
});

// ---- 3. safe and sos -----------------------------------------------------

test('a safe message becomes a safe group message for the others', async () => {
  const { app, sent } = await familyOfThree();
  await app.onWire('dev-e', { t: 'safe', name: 'Nani', note: 'at the temple' });
  await settle();
  const last = app.messages().at(-1)!;
  assert.equal(last.kind, 'safe');
  assert.equal(last.text, 'Nani is safe: at the temple');
  assert.deepEqual(sent.map((s) => s.deviceId).sort(), ['dev-a', 'dev-p'], 'the sender is not sent its own message back');
});

test('an sos from the elder: a severe feed item notifies the adult phone and the sender is named', async () => {
  const { app, sent } = await familyOfThree();
  await app.onWire('dev-e', { t: 'sos', name: 'Nani', note: 'fell in the bathroom' });
  await settle();

  const last = app.messages().at(-1)!;
  assert.equal(last.kind, 'sos');
  assert.equal(last.text, 'SOS from Nani: fell in the bathroom');

  const item = app.feed().find((i) => i.id === `sos-${last.id}`);
  assert.ok(item, 'a feed item is stored');
  assert.equal(item!.severity, 'severe');
  assert.ok(item!.tags.includes('sos') && item!.tags.includes('notify'));

  const adultFeed = ofType(toDev(sent, 'dev-a'), 'feed').flatMap((f) => f.items);
  const pushed = adultFeed.find((i) => i.id === `sos-${last.id}`);
  assert.ok(pushed, 'the adult phone gets the sos item through the gateway');
  assert.ok(pushed!.tags.includes('notify'), 'the adult phone is told to notify');
});

// ---- 4. asks -------------------------------------------------------------

test('a question from the elder waits; deny and approve both answer the phone', async () => {
  const { app, sent } = await familyOfThree();

  await app.onWire('dev-e', { t: 'ask', id: 'q1', text: 'Is the bridge open?' });
  const q1 = app.state().group.asks.find((a) => a.id === 'q1');
  assert.equal(q1?.status, 'pending', 'an elder question waits for the desktop');
  assert.equal(sent.length, 0, 'nothing is answered yet');

  assert.equal(await app.decideAsk('q1', 'deny'), true);
  const denied = ofType(toDev(sent, 'dev-e'), 'answer');
  assert.equal(denied.length, 1);
  assert.equal(denied[0]!.id, 'q1');
  assert.equal(denied[0]!.ok, false);
  assert.equal(app.state().group.asks.find((a) => a.id === 'q1')?.status, 'denied');

  // approve with no assistant connected: the phone is told so, and ok is false
  await app.onWire('dev-e', { t: 'ask', id: 'q2', text: 'Should I take the car?' });
  assert.equal(await app.decideAsk('q2', 'approve'), true);
  const q2 = ofType(toDev(sent, 'dev-e'), 'answer').find((a) => a.id === 'q2');
  assert.ok(q2);
  assert.equal(q2!.ok, false);
  assert.match(q2!.text, /No assistant is connected/);
  assert.equal(app.state().group.asks.find((a) => a.id === 'q2')?.status, 'answered');

  // a repeated id is ignored, and a decided question cannot be decided again
  await app.onWire('dev-e', { t: 'ask', id: 'q2', text: 'again' });
  assert.equal(app.state().group.asks.filter((a) => a.id === 'q2').length, 1);
  assert.equal(await app.decideAsk('q2', 'deny'), false);
  assert.equal(await app.decideAsk('nope', 'approve'), false);
});

test('with allowAdultAsks on, an adult question runs at once while an elder question still waits', async () => {
  const { app, sent } = await familyOfThree();
  app.setAllowAdultAsks(true);
  assert.equal(app.state().group.allowAdultAsks, true);

  await app.onWire('dev-a', { t: 'ask', id: 'q3', text: 'Is the water safe?' });
  const q3 = app.state().group.asks.find((a) => a.id === 'q3');
  assert.equal(q3?.status, 'answered', 'the adult question ran without an OK');
  const answer = ofType(toDev(sent, 'dev-a'), 'answer').find((a) => a.id === 'q3');
  assert.equal(answer?.ok, false, 'no brain is connected, so the answer says so');

  await app.onWire('dev-e', { t: 'ask', id: 'q4', text: 'Can I go out?' });
  assert.equal(app.state().group.asks.find((a) => a.id === 'q4')?.status, 'pending');
});

// ---- 5. agents, nodes and the gateway -------------------------------------

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Test feed</title>
<item><title>Flood alert for Kerala</title><link>https://example.test/news/1</link><description>Rivers are rising.</description><pubDate>Mon, 26 Oct 2026 06:00:00 GMT</pubDate></item>
<item><title>Markets close higher</title><link>https://example.test/news/2</link><description>Shares rose on Monday.</description><pubDate>Mon, 26 Oct 2026 05:00:00 GMT</pubDate></item>
</channel></rss>`;

/**
 * The agent test needs real node runs, and the hub's offline switch makes source nodes refuse to fetch, so this uses
 * a non-offline hub. The agent watches nothing (watch: []), so no weather or quake request goes out; the only fetch
 * is the fake RSS address, which the test swaps in and restores.
 */
async function withFakeFeed(run: () => Promise<void>) {
  const real = globalThis.fetch;
  const hits: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://example.test/')) return real(input as never);
    hits.push(url);
    return new Response(RSS, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }
  return hits;
}

test('an rss pipeline: items reach the feed and the phones once; a second run sends nothing new', async () => {
  await withFakeFeed(async () => {
    const { app, sent } = setup(false);
    const vaibhav = app.addMember({ name: 'Vaibhav', role: 'adult' });
    const nani = app.addMember({ name: 'Nani', role: 'elder' });
    await pairMember(app, vaibhav.id, 'dev-a');
    await pairMember(app, nani.id, 'dev-e');
    sent.length = 0;

    const enrolled = app.enrol({
      personaId: 'firefighter',
      name: 'Flint Watch',
      pipeline: [{ id: 'feed1', kind: 'rss', label: 'Headlines', config: { url: 'https://example.test/feed', limit: 5 } }],
    });
    assert.ok(enrolled);
    app.hub.upsert({ ...enrolled!, watch: [] });

    const first = await app.runOne(enrolled!.id);
    assert.ok(first);
    assert.equal(first.items, 2, 'two headlines from the feed');
    assert.equal(first.results[0]!.ok, true);
    assert.deepEqual(app.feed().map((i) => i.title).sort(), ['Flood alert for Kerala', 'Markets close higher']);
    assert.equal(app.feed().find((i) => i.title.startsWith('Flood'))!.severity, 'watch');

    for (const dev of ['dev-a', 'dev-e']) {
      const feeds = ofType(toDev(sent, dev), 'feed').flatMap((f) => f.items);
      assert.equal(feeds.length, 2, `${dev} gets both items`);
    }

    sent.length = 0;
    const again = await app.runOne(enrolled!.id);
    assert.ok(again);
    assert.equal(app.feed().length, 2, 'no duplicate feed items');
    assert.equal(sent.length, 0, 'no duplicate pushes to phones');
  });
});

test('setPipeline refuses an unknown kind with a readable error and gives every node a unique id', async () => {
  const { app } = setup();
  const a = app.enrol({ personaId: 'firefighter' });
  assert.ok(a);
  assert.throws(() => app.setPipeline(a!.id, [{ kind: 'dedupe' }, { kind: 'nope' }]), /Unknown node kind at position 2/);
  assert.equal(app.setPipeline('no-such-agent', []), null);

  const next = app.setPipeline(a!.id, [
    { id: 'dup', kind: 'dedupe', label: '', config: {} },
    { id: 'dup', kind: 'summarize', label: 'Short', config: null },
    { kind: 'dedupe' },
  ]);
  assert.ok(next);
  const ids = next!.pipeline!.map((n) => n.id);
  assert.equal(new Set(ids).size, 3, 'ids are unique');
  assert.equal(ids[0], 'dup');
  assert.equal(next!.pipeline![0]!.label, 'Remove repeats', 'an empty label gets the kind label');
  assert.deepEqual(next!.pipeline![1]!.config, {}, 'config is always an object');
  assert.throws(() => app.setPipeline(a!.id, 'not a list'), /nodes must be a list/);
});

test('testNode returns the items of one node and stores nothing', async () => {
  await withFakeFeed(async () => {
    const { app, sent } = setup(false);
    const vaibhav = app.addMember({ name: 'Vaibhav', role: 'adult' });
    await pairMember(app, vaibhav.id, 'dev-a');
    sent.length = 0;
    const a = app.enrol({ personaId: 'firefighter' });
    app.hub.upsert({ ...a!, watch: [] });
    const feedBefore = app.feed().length;

    const r = await app.testNode(a!.id, { id: 't1', kind: 'rss', label: 'Try', config: { url: 'https://example.test/feed' } });
    assert.ok(r);
    assert.equal(r.items.length, 2);
    assert.equal(r.result?.ok, true);
    assert.equal(app.feed().length, feedBefore, 'the feed is not changed');
    assert.equal(sent.length, 0, 'nothing is sent to phones');
    assert.equal(await app.testNode('no-such-agent', { id: 't', kind: 'dedupe', label: '', config: {} }), null);
  });
});

// ---- 6. pollInbox ----------------------------------------------------------

test('pollInbox handles one valid phone message, skips garbage, and never handles an item twice', async () => {
  const { app, queue, sent } = setup();
  const vaibhav = app.addMember({ name: 'Vaibhav', role: 'adult' });
  const papa = app.addMember({ name: 'Papa', role: 'adult' });
  await pairMember(app, vaibhav.id, 'dev-a');
  await pairMember(app, papa.id, 'dev-p');
  sent.length = 0;
  const before = app.messages().length;

  const chat = encodeWire({ t: 'chat', msg: { id: 'c1', from: 'x', fromName: 'Hacker', text: 'Ping from the kitchen', at: 1, kind: 'text' } }, app.groupKey());
  queue.push(
    { id: 'm1', from: 'phone:dev-a', kind: 'msg', blob: chat, at: 1000 },
    { id: 'm2', from: 'phone:dev-a', kind: 'msg', blob: 'not-a-real-blob!!', at: 1001 },
    { id: 'm3', from: 'relay', kind: 'msg', blob: chat, at: 1002 },
  );

  assert.equal(await app.pollInbox(), 1, 'one valid phone message handled; garbage and non-phone mail skipped');
  assert.equal(app.messages().length, before + 1);
  const stored = app.messages().at(-1)!;
  assert.equal(stored.text, 'Ping from the kitchen');
  assert.equal(stored.fromName, 'Vaibhav', 'the sender comes from the paired device');
  assert.equal(JSON.parse(readFileSync(join(app.dir, 'secrets.json'), 'utf8')).inboxSince, 1002, 'cursor moves to the newest item');

  assert.equal(await app.pollInbox(), 0, 'the same items are not handled again');
  assert.equal(app.messages().length, before + 1);
  assert.equal(sent.filter((s) => s.msg.t === 'chat').length, 1, 'the chat was fanned out once');
});
