import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { chunkFeed, decodeWire, encodeWire, encodeWireWithNonce, newGroupKey } from './wire.ts';
import type { FeedItem, WireMessage } from './types.ts';

/** Shared test vector (docs/hub-v2-plan.md): the phone's wire.ts must produce and read the same blob. */
const VECTOR_KEY = new Uint8Array(32).fill(0x07);
const VECTOR_NONCE = new Uint8Array(12).fill(0x01);
const VECTOR_MSG: WireMessage = { t: 'safe', name: 'Maa' };
const VECTOR_BLOB = 'AQEBAQEBAQEBAQEBB2j1NarHUqxF7J7BUCdAiCtl332PmhvDWI/7HY/mhfAiG3XuoIbZ+aU=';

const item = (i: number, body = 'Short body text.'): FeedItem => ({
  id: `item-${i}`,
  agentId: 'a1',
  agentName: 'Weather',
  kind: 'weather',
  title: `Headline ${i}`,
  body,
  severity: 'info',
  at: 1_700_000_000_000 + i,
  tags: ['heat'],
  place: 'Delhi',
});

test('shared test vector: encodes to the agreed blob', () => {
  assert.equal(encodeWireWithNonce(VECTOR_MSG, VECTOR_KEY, VECTOR_NONCE), VECTOR_BLOB);
});

test('shared test vector: decodes back to the message', () => {
  assert.deepEqual(decodeWire(VECTOR_BLOB, VECTOR_KEY), VECTOR_MSG);
});

test('blob is base64 of nonce || ciphertext || tag, plaintext is the JSON', () => {
  const raw = Buffer.from(VECTOR_BLOB, 'base64');
  assert.equal(raw.length, 12 + Buffer.byteLength(JSON.stringify(VECTOR_MSG)) + 16);
  assert.deepEqual(raw.subarray(0, 12), Buffer.from(VECTOR_NONCE));
});

test('encodeWire round-trips with a random nonce, and nonces differ', () => {
  const gk = newGroupKey();
  const a = encodeWire(VECTOR_MSG, gk);
  const b = encodeWire(VECTOR_MSG, gk);
  assert.notEqual(a, b, 'a fresh nonce each time');
  assert.deepEqual(decodeWire(a, gk), VECTOR_MSG);
  assert.deepEqual(decodeWire(b, gk), VECTOR_MSG);
});

test('newGroupKey is 32 random bytes', () => {
  const a = newGroupKey();
  const b = newGroupKey();
  assert.equal(a.length, 32);
  assert.notDeepEqual(a, b);
});

test('a wrong key returns null', () => {
  const wrong = new Uint8Array(32).fill(0x08);
  assert.equal(decodeWire(VECTOR_BLOB, wrong), null);
});

test('a tampered blob returns null (every byte position)', () => {
  const raw = Buffer.from(VECTOR_BLOB, 'base64');
  for (let i = 0; i < raw.length; i++) {
    const copy = Buffer.from(raw);
    copy[i] ^= 0x01;
    assert.equal(decodeWire(copy.toString('base64'), VECTOR_KEY), null, `flipped byte ${i}`);
  }
});

test('a blob encrypted under another AAD returns null', () => {
  const ct = chacha20poly1305(VECTOR_KEY, VECTOR_NONCE, new TextEncoder().encode('other-aad')).encrypt(new TextEncoder().encode(JSON.stringify(VECTOR_MSG)));
  const blob = Buffer.concat([Buffer.from(VECTOR_NONCE), Buffer.from(ct)]).toString('base64');
  assert.equal(decodeWire(blob, VECTOR_KEY), null);
});

test('garbage input returns null and never throws', () => {
  const gk = newGroupKey();
  for (const bad of ['', 'not base64!!', 'AAAA', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'abc', undefined as unknown as string]) {
    assert.equal(decodeWire(bad, gk), null, JSON.stringify(bad));
  }
});

test('valid ciphertext of non-JSON plaintext returns null', () => {
  const ct = chacha20poly1305(VECTOR_KEY, VECTOR_NONCE, new TextEncoder().encode('beacon-hub-v1')).encrypt(new TextEncoder().encode('not json'));
  const blob = Buffer.concat([Buffer.from(VECTOR_NONCE), Buffer.from(ct)]).toString('base64');
  assert.equal(decodeWire(blob, VECTOR_KEY), null);
});

test('encodeWireWithNonce rejects a nonce that is not 12 bytes', () => {
  assert.throws(() => encodeWireWithNonce(VECTOR_MSG, VECTOR_KEY, new Uint8Array(8)));
});

test('chunkFeed: a small feed is one blob that decodes to all the items', () => {
  const gk = newGroupKey();
  const items = [item(1), item(2), item(3)];
  const blobs = chunkFeed(items, gk);
  assert.equal(blobs.length, 1);
  assert.deepEqual(decodeWire(blobs[0]!, gk), { t: 'feed', items });
});

test('chunkFeed: a big feed splits into blobs that each fit and together hold every item in order', () => {
  const gk = newGroupKey();
  const items = Array.from({ length: 60 }, (_, i) => item(i, 'word '.repeat(40).trim()));
  const blobs = chunkFeed(items, gk);
  assert.ok(blobs.length > 1, 'needed more than one blob');
  const seen: string[] = [];
  for (const b of blobs) {
    assert.ok(b.length <= 8000, `blob is ${b.length} chars`);
    const msg = decodeWire(b, gk);
    assert.ok(msg && msg.t === 'feed');
    for (const it of msg.items) seen.push(it.id);
  }
  assert.deepEqual(seen, items.map((i) => i.id));
});

test('chunkFeed: an item too big for one blob is truncated body-first and still fits', () => {
  const gk = newGroupKey();
  const huge = item(1, 'x'.repeat(20000));
  const blobs = chunkFeed([huge], gk, 2000);
  assert.equal(blobs.length, 1);
  assert.ok(blobs[0]!.length <= 2000);
  const msg = decodeWire(blobs[0]!, gk);
  assert.ok(msg && msg.t === 'feed');
  const got = msg.items[0]!;
  assert.equal(got.id, huge.id);
  assert.equal(got.title, huge.title, 'title is kept when the body alone is enough');
  assert.ok(got.body.length < huge.body.length && got.body.length > 0, 'body is shortened, not removed');
});

test('chunkFeed: an empty feed gives no blobs', () => {
  assert.deepEqual(chunkFeed([], newGroupKey()), []);
});
