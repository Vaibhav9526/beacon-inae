import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_GUIDES, DISASTERS, GO_BAG, getGuide, searchDisasters, searchGuides } from '..';

test('every guide is complete, bilingual and cross-referenced correctly', () => {
  const ids = new Set<string>();
  for (const g of ALL_GUIDES) {
    assert.ok(!ids.has(g.id), `duplicate id ${g.id}`);
    ids.add(g.id);
    assert.ok(g.steps.length >= 3, `${g.id} needs at least 3 steps`);
    for (const t of [g.title, g.keywords, ...g.steps, ...(g.avoid ?? []), ...(g.household ?? [])]) {
      assert.equal(t.length, 2);
      assert.ok(t[0].trim() && t[1].trim(), `${g.id}: empty en/hi text`);
      assert.match(t[1], /[ऀ-ॿ]/, `${g.id}: Hindi text has no Devanagari: ${t[1].slice(0, 30)}`);
    }
    for (const r of g.related ?? []) assert.ok(getGuide(r) || r === undefined, `${g.id} -> unknown related ${r}`);
    if (g.level === 'emergency') {
      const all = g.steps.map((s) => s[0]).join(' ');
      assert.match(all, /112|101|AED/, `${g.id}: an emergency guide must mention calling for help`);
    }
  }
});

test('disaster guides and go-bag are complete', () => {
  for (const d of DISASTERS) {
    assert.ok(d.before.length && d.during.length && d.after.length, d.id);
    for (const t of [...d.before, ...d.during, ...d.after]) assert.match(t[1], /[ऀ-ॿ]/);
  }
  assert.ok(GO_BAG.length >= 12);
});

const top = (q: string) => searchGuides(q)[0]?.item.id;

test('keyword matching finds the right guide from plain words (English)', () => {
  assert.equal(top('he is bleeding badly from his arm'), 'severe-bleeding');
  assert.equal(top('my child touched hot oil and the skin is blistered'), 'burns');
  assert.equal(top('she cannot breathe and food is stuck in her throat'), 'choking-adult');
  assert.equal(top('a snake bit my father'), 'snake-bite');
  assert.equal(top('ankle twisted and swollen, maybe broken'), 'fracture');
  assert.equal(top('loose motions since morning, very thirsty'), 'dehydration');
  assert.equal(top('how to make ors at home'), 'homemade-ors');
  assert.equal(top('boil water flood dirty drinking'), 'purify-water');
  assert.equal(top('grandfather has chest pain and sweating'), 'heart-attack');
  assert.equal(top('dog bite on leg'), 'animal-bite');
});

test('keyword matching works for Hindi', () => {
  assert.equal(top('खून बह रहा है'), 'severe-bleeding');
  assert.equal(top('साँप ने काट लिया'), 'snake-bite');
  assert.equal(top('बच्चा जल गया गर्म पानी'), 'burns');
  assert.equal(top('दस्त और उल्टी'), 'dehydration');
  assert.equal(searchDisasters('भूकंप आया')[0]?.item.id, 'earthquake');
});

test('disaster search', () => {
  assert.equal(searchDisasters('earthquake shaking building')[0]?.item.id, 'earthquake');
  assert.equal(searchDisasters('river overflow water rising')[0]?.item.id, 'flood');
  assert.equal(searchDisasters('')[0], undefined);
});
