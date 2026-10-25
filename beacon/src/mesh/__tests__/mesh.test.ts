import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import { buildGcs, decodeGcs, gcsHas } from '../gcs';
import { encodeGeohash, decodeGeohash, channelsAt } from '../geohash';
import { createIdentity, newEphemeral } from '../identity';
import { NoiseSession, pad, unpad } from '../noise';
import { PacketType, VERSION, decode, encode, sign, verify } from '../packet';
import { utf8 } from '../bytes';
import type { MeshAlert, PrivateMessage, PublicMessage, SosMessage } from '../node';
import { world } from './harness';

test('packet round-trips and signature survives TTL decrement', () => {
  const id = createIdentity();
  const p = sign(
    { version: VERSION, type: PacketType.Public, ttl: 7, timestamp: 1_700_000_123_456, sender: id.peerId, payload: utf8('hello') },
    id.signing.secretKey,
  );
  const back = decode(encode(p))!;
  assert.equal(back.type, PacketType.Public);
  assert.equal(back.timestamp, 1_700_000_123_456);
  assert.ok(verify(back, id.signing.publicKey));
  assert.ok(verify({ ...back, ttl: 3 }, id.signing.publicKey), 'relays may lower TTL');
  assert.ok(!verify({ ...back, payload: utf8('hellO') }, id.signing.publicKey), 'tampering is caught');
});

test('geohash known value and channel ladder', () => {
  assert.equal(encodeGeohash(57.64911, 10.40744, 11), 'u4pruydqqvj');
  const { lat, lon } = decodeGeohash('u4pruydqqvj');
  assert.ok(Math.abs(lat - 57.64911) < 1e-4 && Math.abs(lon - 10.40744) < 1e-4);
  const ch = channelsAt(28.6139, 77.209);
  assert.equal(ch.length, 5);
  assert.ok(ch[0].startsWith(ch[1]) || ch[1].length < ch[0].length);
});

test('GCS filter finds what it holds and mostly nothing else', () => {
  const have = Array.from({ length: 150 }, (_, i) => `pkt-${i}`);
  const g = buildGcs(have);
  const set = decodeGcs(g.n, g.data);
  for (const k of have) assert.ok(gcsHas(set, g.n, k));
  let fp = 0;
  for (let i = 0; i < 2000; i++) if (gcsHas(set, g.n, `other-${i}`)) fp++;
  assert.ok(fp < 5, `false positives ${fp}`);
});

test('Noise XX handshake, transport, replay rejection, padding', () => {
  const a = createIdentity();
  const b = createIdentity();
  const ini = new NoiseSession(true, a.noise, newEphemeral);
  const res = new NoiseSession(false, b.noise, newEphemeral);
  const m1 = ini.start();
  const m2 = res.read(m1)!;
  const m3 = ini.read(m2)!;
  assert.equal(res.read(m3), null);
  assert.ok(ini.established && res.established);
  assert.deepEqual(ini.remoteStatic, b.noise.publicKey);
  assert.deepEqual(res.remoteStatic, a.noise.publicKey);
  const ct = ini.seal(pad(utf8('water is rising')));
  assert.equal(new TextDecoder().decode(unpad(res.open(ct)!)), 'water is rising');
  assert.equal(res.open(ct), null, 'replay rejected');
  const ct2 = res.seal(utf8('ok'));
  assert.ok(ini.open(ct2));
  const bad = ini.seal(utf8('x'));
  bad[bad.length - 1] ^= 1;
  assert.equal(res.open(bad), null, 'forgery rejected');
  assert.equal(pad(utf8('hi')).length, 256);
  assert.equal(pad(new Uint8Array(300)).length, 512);
});

test('public message crosses 7 hops but not 8', async () => {
  const w = world();
  const names = 'ABCDEFGHI'.split('');
  names.forEach((n) => w.add(n));
  for (let i = 0; i < names.length - 1; i++) w.net.connect(names[i], names[i + 1]);
  const got: Record<string, PublicMessage[]> = {};
  for (const n of names) {
    got[n] = [];
    w.nodes[n].setLocation(28.6139, 77.209);
    w.nodes[n].on('public', (m) => got[n].push(m));
    await w.nodes[n].start();
  }
  await w.clock.advance(1000);
  w.nodes.A.sendPublic(w.nodes.A.joinedChannels[0], 'anyone at the school shelter?', 'help');
  await w.clock.advance(5000);
  assert.equal(got.H.length, 1, 'H is 7 hops away');
  assert.equal(got.H[0].text, 'anyone at the school shelter?');
  assert.equal(got.H[0].hops, 6, 'received with TTL 1 left');
  assert.equal(got.I.length, 0, 'I is 8 hops away, TTL exhausted');
  for (const n of 'BCDEFG') assert.equal(got[n].length, 1, `${n} got exactly one copy`);
});

test('SOS reaches the far end and is verified once announces propagate', async () => {
  const w = world();
  ['A', 'B', 'C', 'D'].forEach((n) => w.add(n));
  w.net.connect('A', 'B');
  w.net.connect('B', 'C');
  w.net.connect('C', 'D');
  const sos: SosMessage[] = [];
  w.nodes.D.on('sos', (m) => sos.push(m));
  for (const n of Object.values(w.nodes)) await n.start();
  await w.clock.advance(3000);
  w.nodes.A.sendSos({ lat: 28.6, lon: 77.2, note: 'trapped, ground floor', medical: 'diabetic' });
  await w.clock.advance(2000);
  assert.equal(sos.length, 1);
  assert.equal(sos[0].note, 'trapped, ground floor');
  assert.equal(sos[0].medical, 'diabetic');
  assert.ok(sos[0].verified, 'D learned A via multi-hop announce');
});

test('private message over multi-hop Noise session, with ack', async () => {
  const w = world();
  ['A', 'B', 'C', 'D'].forEach((n) => w.add(n));
  w.net.connect('A', 'B');
  w.net.connect('B', 'C');
  w.net.connect('C', 'D');
  for (const n of Object.values(w.nodes)) await n.start();
  await w.clock.advance(3000);
  const inbox: PrivateMessage[] = [];
  const delivered: string[] = [];
  w.nodes.D.on('private', (m) => inbox.push(m));
  w.nodes.A.on('delivered', (id) => delivered.push(id));
  const id = w.nodes.A.sendPrivate(w.nodes.D.id, 'I am at the stadium, bring water');
  await w.clock.advance(5000);
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].text, 'I am at the stadium, bring water');
  assert.equal(inbox[0].from, w.nodes.A.id);
  assert.deepEqual(delivered, [id]);
});

test('large message is fragmented and reassembled', async () => {
  const w = world();
  ['A', 'B', 'C'].forEach((n) => w.add(n));
  w.net.connect('A', 'B');
  w.net.connect('B', 'C');
  const got: PublicMessage[] = [];
  w.nodes.C.on('public', (m) => got.push(m));
  for (const n of Object.values(w.nodes)) {
    n.setLocation(19.07, 72.87);
    await n.start();
  }
  await w.clock.advance(1000);
  const text = 'long report. '.repeat(70);
  w.nodes.A.sendPublic(w.nodes.A.joinedChannels[0], text);
  await w.clock.advance(5000);
  assert.equal(got.length, 1);
  assert.equal(got[0].text, text);
});

test('late joiner catches up through gossip sync', async () => {
  const w = world();
  ['A', 'B', 'C'].forEach((n) => w.add(n));
  w.net.connect('A', 'B');
  const got: PublicMessage[] = [];
  w.nodes.C.on('public', (m) => got.push(m));
  for (const n of Object.values(w.nodes)) {
    n.setLocation(12.97, 77.59);
    await n.start();
  }
  await w.clock.advance(1000);
  const ch = w.nodes.A.joinedChannels[0];
  w.nodes.A.sendPublic(ch, 'water distribution at 5pm', 'offer');
  w.nodes.A.sendPublic(ch, 'need insulin near ward 4', 'need');
  await w.clock.advance(2000);
  assert.equal(got.length, 0);
  w.net.connect('B', 'C'); // C walks into range
  await w.clock.advance(3000);
  assert.deepEqual(got.map((m) => m.text).sort(), ['need insulin near ward 4', 'water distribution at 5pm']);
});

test('sealed courier delivers to a recipient who is out of range, later', async () => {
  const w = world();
  ['A', 'B', 'C'].forEach((n) => w.add(n));
  w.net.connect('A', 'B');
  w.net.connect('B', 'C');
  for (const n of Object.values(w.nodes)) await n.start();
  await w.clock.advance(3000); // everyone learns everyone
  w.net.disconnect('B', 'C'); // C leaves; A still knows C's key from before
  await w.clock.advance(90_000); // C's announce is stale: no route
  const inbox: PrivateMessage[] = [];
  w.nodes.C.on('private', (m) => inbox.push(m));
  w.nodes.A.sendPrivate(w.nodes.C.id, 'meet at the north gate at dawn');
  await w.clock.advance(3000);
  assert.equal(inbox.length, 0, 'C is not reachable yet');
  w.net.connect('B', 'C'); // B (carrying the sealed envelope) meets C
  await w.clock.advance(5000);
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].text, 'meet at the north gate at dawn');
  assert.ok(inbox[0].viaCourier);
  assert.equal(inbox[0].from, w.nodes.A.id);
});

test('a restart does not lose pending mail: snapshot, new process, delivery still happens', async () => {
  const w = world();
  ['A', 'B', 'C'].forEach((n) => w.add(n));
  w.net.connect('A', 'B');
  w.net.connect('B', 'C');
  for (const n of Object.values(w.nodes)) await n.start();
  await w.clock.advance(3000);
  w.net.disconnect('B', 'C');
  await w.clock.advance(90_000);
  const inbox: PrivateMessage[] = [];
  w.nodes.C.on('private', (m) => inbox.push(m));
  w.nodes.A.sendPrivate(w.nodes.C.id, 'bring the medicines to ward 4');
  await w.clock.advance(3000);

  // A's app is killed and restarted: a brand-new node with the same identity restores its snapshot
  const snap = w.nodes.A.snapshot();
  const idA = (w.nodes.A as unknown as { identity: import('../identity').Identity }).identity;
  await w.nodes.A.stop();
  const t = w.net.create('A2');
  const a2 = new (w.nodes.A.constructor as typeof import('../node').MeshNode)(idA, t, { nickname: 'A', scheduler: w.clock });
  a2.restore(snap);
  w.net.connect('A2', 'B');
  w.net.connect('B', 'C');
  await a2.start();
  await w.clock.advance(20_000);
  assert.equal(inbox.length, 1, 'the restored node (or the courier B carried) delivered it');
  assert.equal(inbox[0].text, 'bring the medicines to ward 4');
  assert.equal(JSON.parse(a2.snapshot()).v, 1);
  a2.restore('{not json'); // garbage is ignored
});

test('alerts are marked verified only for trusted gateway keys', async () => {
  const gw = ed25519.keygen();
  const w = world();
  ['G', 'A', 'B'].forEach((n) => w.add(n, { trusted: [gw.publicKey] }));
  w.net.connect('G', 'A');
  w.net.connect('A', 'B');
  const alerts: MeshAlert[] = [];
  w.nodes.B.on('alert', (a) => alerts.push(a));
  for (const n of Object.values(w.nodes)) await n.start();
  await w.clock.advance(1000);
  const body = { id: 'usgs-1', title: 'Earthquake M5.4', body: 'Drop, cover, hold on', severity: 'severe' as const, source: 'USGS' };
  w.nodes.G.broadcastAlert(body, ed25519.sign(utf8(JSON.stringify(body)), gw.secretKey));
  const fake = { ...body, id: 'fake-1', title: 'Dam burst, flee now' };
  w.nodes.G.broadcastAlert(fake, ed25519.sign(utf8(JSON.stringify(fake)), ed25519.keygen().secretKey));
  await w.clock.advance(2000);
  assert.equal(alerts.length, 2);
  assert.equal(alerts.find((a) => a.id === 'usgs-1')!.verified, true);
  assert.equal(alerts.find((a) => a.id === 'fake-1')!.verified, false);
});
