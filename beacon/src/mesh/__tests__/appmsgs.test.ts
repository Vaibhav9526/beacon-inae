import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from '@noble/hashes/utils.js';
import type { OpaqueNote, RoadEvent, RoadReport, ShakeEvent } from '../appTypes';
import { fromHex, jsonBytes, toBase64 } from '../bytes';
import { createIdentity } from '../identity';
import { MeshNode } from '../node';
import { PacketType, VERSION, encode, sign } from '../packet';
import { type World, world } from './harness';

const LAT = 28.6139;
const LON = 77.209;

async function line(names: string[]) {
  const w = world();
  names.forEach((n) => w.add(n));
  for (let i = 0; i < names.length - 1; i++) w.net.connect(names[i], names[i + 1]);
  for (const n of names) await w.nodes[n].start();
  await w.clock.advance(3000);
  return w;
}

const report = (w: World, over: Partial<RoadReport> = {}): RoadReport => ({
  id: 'ab12cd34',
  status: 'blocked',
  lat: LAT,
  lon: LON,
  note: 'tree down',
  seenAt: w.clock.t,
  ...over,
});

/** A raw radio attached to `to` that can inject hand-made packets. */
function injector(w: World, to: string) {
  const t = w.net.create('X' + Math.random());
  w.net.connect(t.name, to);
  return (p: Parameters<typeof encode>[0]) => t.broadcast(encode(p));
}

test('road report reaches a node 3 hops away and is relayed', async () => {
  const w = await line(['A', 'B', 'C', 'D']);
  const got: RoadEvent[] = [];
  w.nodes.D.on('road', (e) => got.push(e));
  assert.ok(w.nodes.A.sendRoad(report(w)));
  await w.clock.advance(3000);
  assert.equal(got.length, 1);
  assert.equal(got[0].report.status, 'blocked');
  assert.equal(got[0].report.note, 'tree down');
  assert.equal(got[0].attesters, 0);
  assert.equal(got[0].verified, false);
  assert.equal(got[0].hops, 2);
  assert.equal(got[0].from, w.nodes.A.id);
});

test('a nearby direct neighbour attests once; far neighbours do not; no self or double attestation', async () => {
  const w = await line(['A', 'B', 'C']);
  const onC: RoadEvent[] = [];
  const onA: RoadEvent[] = [];
  w.nodes.C.on('road', (e) => onC.push(e));
  w.nodes.A.on('road', (e) => onA.push(e));
  w.nodes.A.setPosition(LAT, LON); // the reporter never attests its own report
  w.nodes.B.setPosition(LAT + 0.002, LON); // about 220 m away
  w.nodes.C.setPosition(LAT, LON); // right there, but not in range of A: no attestation
  w.nodes.A.sendRoad(report(w));
  await w.clock.advance(3000);
  assert.equal(onC.at(-1)!.attesters, 1);
  assert.equal(onA.at(-1)!.attesters, 1);
  // the same report again (an update) must not be attested twice
  await w.clock.advance(1000);
  w.nodes.A.sendRoad(report(w, { note: 'still down' }));
  await w.clock.advance(3000);
  assert.equal(onC.at(-1)!.attesters, 1);
  assert.equal(onC.at(-1)!.report.note, 'still down');
  assert.equal(onC.at(-1)!.verified, false);
});

test('two attesters make a report verified', async () => {
  const w = world();
  ['A', 'B', 'C', 'D'].forEach((n) => w.add(n));
  w.net.connect('A', 'B');
  w.net.connect('A', 'D');
  w.net.connect('B', 'C');
  for (const n of Object.values(w.nodes)) await n.start();
  await w.clock.advance(3000);
  const onC: RoadEvent[] = [];
  w.nodes.C.on('road', (e) => onC.push(e));
  w.nodes.B.setPosition(LAT, LON);
  w.nodes.D.setPosition(LAT, LON + 0.001);
  w.nodes.A.sendRoad(report(w));
  await w.clock.advance(3000);
  assert.equal(onC.at(-1)!.attesters, 2);
  assert.equal(onC.at(-1)!.verified, true);
});

test('a far-away or stale position does not attest', async () => {
  const w = await line(['A', 'B', 'C']);
  const onC: RoadEvent[] = [];
  w.nodes.C.on('road', (e) => onC.push(e));
  w.nodes.B.setPosition(LAT + 0.05, LON); // about 5.5 km
  w.nodes.A.sendRoad(report(w));
  await w.clock.advance(3000);
  assert.equal(onC.at(-1)!.attesters, 0);
  w.nodes.B.setPosition(LAT, LON);
  await w.clock.advance(11 * 60_000); // position is now older than 10 minutes
  w.nodes.A.sendRoad(report(w, { id: 'ee11ee11' }));
  await w.clock.advance(3000);
  assert.equal(onC.filter((e) => e.report.id === 'ee11ee11').at(-1)!.attesters, 0);
});

test('forged attestations are ignored', async () => {
  const w = await line(['A', 'B', 'C']);
  const onC: RoadEvent[] = [];
  w.nodes.C.on('road', (e) => onC.push(e));
  w.nodes.A.sendRoad(report(w));
  await w.clock.advance(3000);
  const inject = injector(w, 'C');
  // claims to be B (a known peer) but is signed with someone else's key
  const evil = createIdentity();
  const forged = sign(
    { version: VERSION, type: PacketType.Attest, ttl: 7, timestamp: w.clock.t, sender: fromHex(w.nodes.B.id), payload: jsonBytes({ rid: 'ab12cd34', k: toBase64(evil.signing.publicKey) }) },
    evil.signing.secretKey,
  );
  inject(forged);
  // unsigned
  inject({ version: VERSION, type: PacketType.Attest, ttl: 7, timestamp: w.clock.t + 1, sender: randomBytes(8), payload: jsonBytes({ rid: 'ab12cd34' }) });
  await w.clock.advance(1000);
  assert.equal(onC.at(-1)!.attesters, 0);
});

test('opaque notes flood, de-duplicate and are capped', async () => {
  const w = await line(['A', 'B', 'C']);
  const got: OpaqueNote[] = [];
  w.nodes.C.on('opaque', (n) => got.push(n));
  const tag = '0123456789abcdef';
  const blob = toBase64(randomBytes(100));
  assert.ok(w.nodes.A.sendOpaque(tag, blob));
  await w.clock.advance(2000);
  assert.equal(got.length, 1);
  assert.equal(got[0].tag, tag);
  assert.equal(got[0].blob, blob);
  w.nodes.A.sendOpaque(tag, blob); // same note again
  await w.clock.advance(2000);
  assert.equal(got.length, 1, 'repeat emitted once');
  assert.equal(w.nodes.C.opaqueNotes().length, 1);
  // malformed
  assert.equal(w.nodes.A.sendOpaque('xyz', blob), null);
  assert.equal(w.nodes.A.sendOpaque(tag, toBase64(randomBytes(601))), null);
  assert.equal(w.nodes.A.sendOpaque(tag, 'not base64!'), null);
  assert.ok(w.nodes.A.sendOpaque(tag, toBase64(randomBytes(600))));
  // cap
  for (let i = 0; i < 510; i++) w.nodes.A.sendOpaque(tag, toBase64(randomBytes(20)));
  assert.equal(w.nodes.A.opaqueNotes().length, 500);
  const cached = (JSON.parse(w.nodes.A.snapshot()).cache as { type: number }[]).filter((c) => c.type === PacketType.Opaque);
  assert.ok(cached.length <= 500);
});

test('shake votes travel 3 hops, are rate limited, and malformed ones are ignored', async () => {
  const w = await line(['A', 'B', 'C', 'D', 'E']);
  const got: Record<string, ShakeEvent[]> = { B: [], D: [], E: [] };
  for (const n of ['B', 'D', 'E']) w.nodes[n].on('shake', (e) => got[n].push(e));
  const vote = { id: 'vote0001', lat: LAT, lon: LON, peakMg: 450, startedAt: w.clock.t };
  assert.ok(w.nodes.A.sendShake(vote));
  await w.clock.advance(3000);
  assert.equal(got.B.length, 1);
  assert.equal(got.D.length, 1, 'three hops away');
  assert.equal(got.D[0].hops, 2);
  assert.equal(got.E.length, 0, 'four hops away');
  assert.equal(w.nodes.A.sendShake({ ...vote, id: 'vote0002' }), null, 'own votes limited to 1 per 20 s');
  assert.equal(JSON.parse(w.nodes.B.snapshot()).cache.some((c: { type: number }) => c.type === PacketType.Shake), false, 'not cached');
  await w.clock.advance(21_000);
  assert.ok(w.nodes.A.sendShake({ ...vote, id: 'vote0003' }));
  // a forwarder limits per sender
  const inject = injector(w, 'B');
  const stranger = randomBytes(8);
  const mk = (id: string, ts: number, peakMg = 300) => ({ version: VERSION, type: PacketType.Shake, ttl: 3, timestamp: ts, sender: stranger, payload: jsonBytes({ id, la: LAT, lo: LON, g: peakMg, ts }) });
  const before = got.B.length;
  inject(mk('s0000001', w.clock.t));
  inject(mk('s0000002', w.clock.t + 1));
  await w.clock.advance(1000);
  assert.equal(got.B.length - before, 2); // A's vote 0003 plus only the first stranger vote
  // malformed payloads vanish silently
  const bad = [mk('bad00001', w.clock.t + 30_000, 999_999), { ...mk('bad00002', w.clock.t + 31_000), payload: new TextEncoder().encode('{nope') }, { ...mk('b', w.clock.t + 32_000), sender: randomBytes(8) }];
  const n = got.B.length;
  await w.clock.advance(25_000);
  for (const p of bad) inject({ ...p, sender: randomBytes(8) });
  await w.clock.advance(1000);
  assert.equal(got.B.length, n);
  assert.equal(w.nodes.A.sendShake({ ...vote, id: 'x', peakMg: -1 }), null);
});

test('malformed road reports are rejected on send and dropped on receipt', async () => {
  const w = await line(['A', 'B']);
  const onB: RoadEvent[] = [];
  w.nodes.B.on('road', (e) => onB.push(e));
  assert.equal(w.nodes.A.sendRoad(report(w, { lat: 99 })), null);
  assert.equal(w.nodes.A.sendRoad(report(w, { status: 'lava' as never })), null);
  const inject = injector(w, 'B');
  inject({ version: VERSION, type: PacketType.Road, ttl: 7, timestamp: w.clock.t, sender: randomBytes(8), payload: jsonBytes({ id: 'ab12cd34', s: 'blocked', la: Number.NaN, lo: 1, ts: 1 }) });
  inject({ version: VERSION, type: PacketType.Road, ttl: 7, timestamp: w.clock.t + 1, sender: randomBytes(8), payload: new Uint8Array([1, 2, 3]) });
  await w.clock.advance(1000);
  assert.equal(onB.length, 0);
  w.nodes.A.sendRoad(report(w, { note: 'x'.repeat(500) }));
  await w.clock.advance(1000);
  assert.equal(onB[0].report.note!.length, 120);
});

test('snapshot and restore keep roads and opaque notes', async () => {
  const w = await line(['A', 'B', 'C']);
  w.nodes.B.setPosition(LAT, LON);
  w.nodes.A.sendRoad(report(w));
  w.nodes.A.sendOpaque('0123456789abcdef', toBase64(randomBytes(50)));
  await w.clock.advance(3000);
  const snap = w.nodes.C.snapshot();
  const fresh = new MeshNode(createIdentity(), w.net.create('Z'), { nickname: 'Z', scheduler: w.clock });
  fresh.restore(snap);
  const roads = fresh.roadEvents();
  assert.equal(roads.length, 1);
  assert.equal(roads[0].report.id, 'ab12cd34');
  assert.equal(roads[0].attesters, 1);
  assert.equal(fresh.opaqueNotes().length, 1);
});
