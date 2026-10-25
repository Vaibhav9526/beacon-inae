import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from '@noble/hashes/utils.js';
import type { Breadcrumb, OpaqueNote } from '../../mesh/appTypes';
import { fromBase64, toBase64 } from '../../mesh/bytes';
import { acceptedTags, dayNumber, dayTag, decodeKey, describe, encodeKey, latestPerPerson, openCrumb, sealCrumb } from '../breadcrumbs';

const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
const key = randomBytes(32);
const crumb: Breadcrumb = { who: 'Aarav', lat: 28.61391, lon: 77.2090, acc: 12, batt: 41, at: NOW - 60_000, note: 'school gate' };

const asNote = (s: { tag: string; blobB64: string }): OpaqueNote => ({ tag: s.tag, blob: s.blobB64, from: 'ab', timestamp: NOW, hops: 1 });

test('round trip', () => {
  const s = sealCrumb(crumb, key, NOW);
  assert.match(s.tag, /^[0-9a-f]{16}$/);
  assert.deepEqual(openCrumb(asNote(s), key, NOW), crumb);
});

test('wrong key and tamper give null', () => {
  const s = sealCrumb(crumb, key, NOW);
  assert.equal(openCrumb(asNote(s), randomBytes(32), NOW), null);
  const raw = fromBase64(s.blobB64);
  raw[40] ^= 1;
  assert.equal(openCrumb({ ...asNote(s), blob: toBase64(raw) }, key, NOW), null);
  assert.equal(openCrumb({ ...asNote(s), blob: 'AAAA' }, key, NOW), null);
});

test('padding hides length', () => {
  const a = sealCrumb({ who: 'A', lat: 1, lon: 2, at: NOW }, key, NOW);
  const b = sealCrumb({ ...crumb, who: 'A very long name here', note: 'x'.repeat(200) }, key, NOW);
  assert.equal(a.blobB64.length, b.blobB64.length);
  assert.ok(fromBase64(a.blobB64).length <= 600);
  assert.equal(openCrumb(asNote(b), key, NOW)?.note?.length, 80);
});

test('tag changes daily and yesterday is accepted', () => {
  const d = dayNumber(NOW);
  assert.notEqual(dayTag(key, d), dayTag(key, d + 1));
  const yesterday = sealCrumb(crumb, key, NOW - 86_400_000);
  assert.ok(acceptedTags(key, NOW).has(yesterday.tag));
  assert.ok(!acceptedTags(key, NOW + 2 * 86_400_000).has(yesterday.tag));
  assert.ok(acceptedTags(key, NOW + 2 * 86_400_000, 3).has(yesterday.tag));
});

test('future and impossible values are rejected', () => {
  const open = (c: Breadcrumb) => openCrumb(asNote(sealCrumb(c, key, NOW)), key, NOW);
  assert.equal(open({ ...crumb, at: NOW + 10 * 60_000 }), null);
  assert.notEqual(open({ ...crumb, at: NOW + 60_000 }), null);
  assert.equal(open({ ...crumb, lat: 91 }), null);
  assert.equal(open({ ...crumb, lon: -181 }), null);
  assert.equal(open({ ...crumb, batt: 150 })?.batt, 100);
});

test('latestPerPerson keeps the newest per who', () => {
  const out = latestPerPerson([
    { who: 'A', lat: 1, lon: 1, at: 10 },
    { who: 'A', lat: 2, lon: 2, at: 30 },
    { who: 'B', lat: 3, lon: 3, at: 20 },
    { who: 'A', lat: 4, lon: 4, at: 20 },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out.find((c) => c.who === 'A')?.lat, 2);
});

test('describe and key encoding', () => {
  assert.equal(describe({ ...crumb, at: NOW - 20 * 60_000 }, NOW).when, 'about 20 min ago');
  assert.equal(describe(crumb, NOW).where, '28.61391, 77.20900');
  assert.deepEqual(decodeKey(encodeKey(key)), key);
  assert.deepEqual(decodeKey(toBase64(key)), key);
  assert.equal(decodeKey('BCNKEY1:nope'), null);
});
