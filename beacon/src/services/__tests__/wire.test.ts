import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { decodeWire, encodeWire, encodeWireWithNonce, parseGroupKey, WIRE_MAX_BLOB, type WireMessage } from '../wire';

// Shared test vector (docs/hub-v2-plan.md): key = 32 x 0x07, nonce = 12 x 0x01,
// plaintext {"t":"safe","name":"Maa"}, AAD 'beacon-hub-v1'.
// Blob (base64 of nonce || ciphertext || tag), to cross-check against the hub's engine/wire.ts output:
//   AQEBAQEBAQEBAQEBB2j1NarHUqxF7J7BUCdAiCtl332PmhvDWI/7HY/mhfAiG3XuoIbZ+aU=
const VECTOR_KEY = new Uint8Array(32).fill(0x07);
const VECTOR_NONCE = new Uint8Array(12).fill(0x01);
const VECTOR_MSG: WireMessage = { t: 'safe', name: 'Maa' };
const VECTOR_BLOB = 'AQEBAQEBAQEBAQEBB2j1NarHUqxF7J7BUCdAiCtl332PmhvDWI/7HY/mhfAiG3XuoIbZ+aU=';

test('shared test vector encodes to the agreed blob', () => {
  assert.equal(encodeWireWithNonce(VECTOR_MSG, VECTOR_KEY, VECTOR_NONCE), VECTOR_BLOB);
});

test('shared test vector decodes back to the plaintext', () => {
  assert.deepEqual(decodeWire(VECTOR_BLOB, VECTOR_KEY), VECTOR_MSG);
});

test('round trip with a random nonce', () => {
  const gk = new Uint8Array(32).map((_, i) => i * 3);
  const msg: WireMessage = { t: 'chat', msg: { id: 'c1', from: 'phone', fromName: 'Ravi', text: 'नमस्ते / hello', at: 5, kind: 'text' } };
  const blob = encodeWire(msg, gk);
  assert.deepEqual(decodeWire(blob, gk), msg);
  // a fresh random nonce each time: same message, different blob
  assert.notEqual(encodeWire(msg, gk), blob);
});

test('tampered blob is rejected', () => {
  const raw = Buffer.from(VECTOR_BLOB, 'base64');
  raw[raw.length - 1] ^= 0x01; // flip one bit of the tag
  assert.equal(decodeWire(raw.toString('base64'), VECTOR_KEY), null);
  const body = Buffer.from(VECTOR_BLOB, 'base64');
  body[14] ^= 0x80; // flip a bit of the ciphertext
  assert.equal(decodeWire(body.toString('base64'), VECTOR_KEY), null);
});

test('wrong key is rejected', () => {
  const other = new Uint8Array(32).fill(0x08);
  assert.equal(decodeWire(VECTOR_BLOB, other), null);
});

test('AAD is bound: a blob made with another AAD does not decode', () => {
  // Same key and nonce, different AAD: must not decode here.
  const ct = chacha20poly1305(VECTOR_KEY, VECTOR_NONCE, new TextEncoder().encode('other-aad')).encrypt(new TextEncoder().encode(JSON.stringify(VECTOR_MSG)));
  const blob = Buffer.concat([Buffer.from(VECTOR_NONCE), Buffer.from(ct)]).toString('base64');
  assert.equal(decodeWire(blob, VECTOR_KEY), null);
});

test('garbage and short input return null, never throw', () => {
  assert.equal(decodeWire('', VECTOR_KEY), null);
  assert.equal(decodeWire('AAAA', VECTOR_KEY), null);
  assert.equal(decodeWire('!!!not base64!!!', VECTOR_KEY), null);
});

test('parseGroupKey accepts exactly 32 bytes', () => {
  assert.equal(parseGroupKey(Buffer.from(VECTOR_KEY).toString('base64'))?.length, 32);
  assert.equal(parseGroupKey(Buffer.from('short').toString('base64')), null);
  assert.equal(parseGroupKey(''), null);
});

test('oversized messages are refused', () => {
  const big: WireMessage = { t: 'safe', name: 'x'.repeat(WIRE_MAX_BLOB) };
  assert.throws(() => encodeWire(big, VECTOR_KEY), RangeError);
});
