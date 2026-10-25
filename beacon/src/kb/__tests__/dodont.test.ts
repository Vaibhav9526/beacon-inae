import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DISASTERS } from '../disasters';
import { DODONT_IDS, dodontFor } from '../dodont';

test('every disaster id has do and dont lists in English and Hindi', () => {
  for (const d of DISASTERS) {
    for (const lang of ['en', 'hi'] as const) {
      const dd = dodontFor(d.id, lang);
      assert.ok(dd, `${d.id}: no ${lang} do/dont`);
      assert.equal(dd.do.length, 4, `${d.id} ${lang}: do should have 4 items`);
      assert.equal(dd.dont.length, 4, `${d.id} ${lang}: dont should have 4 items`);
      for (const s of [...dd.do, ...dd.dont]) assert.ok(s.trim().length > 0, `${d.id} ${lang}: empty line`);
    }
  }
});

test('Hindi lists are in Devanagari and English lists are not', () => {
  for (const id of DODONT_IDS) {
    for (const s of [...(dodontFor(id, 'hi')?.do ?? []), ...(dodontFor(id, 'hi')?.dont ?? [])]) {
      assert.match(s, /[ऀ-ॿ]/, `${id}: Hindi line has no Devanagari`);
    }
    for (const s of [...(dodontFor(id, 'en')?.do ?? []), ...(dodontFor(id, 'en')?.dont ?? [])]) {
      assert.doesNotMatch(s, /[ऀ-ॿ]/, `${id}: English line contains Devanagari`);
    }
  }
});

test('unknown ids return undefined', () => {
  assert.equal(dodontFor('meteor', 'en'), undefined);
});
