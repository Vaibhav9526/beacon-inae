import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DISASTERS, FIRST_AID, REMEDIES } from '..';
import { DODONT_IDS, dodontFor } from '../dodont';
import type { Guide, T } from '../types';

const GUIDES: Guide[] = [...FIRST_AID, ...REMEDIES];
const DEVANAGARI = /[ऀ-ॿ]/;
const NEGATION = /\b(do not|don't|never|no|not|avoid)\b/i;
const CALL_HELP = /\b112\b|doctor|hospital/i;

// Phrases that must never appear as an instruction (steps, household tips, do/don't "do" lines).
// In avoid / don't lists they are allowed only when negated, e.g. "No ice, butter, ..."
const FORBIDDEN = [
  'apply ice',
  'suck out',
  'cut the wound',
  'butter',
  'toothpaste',
  'induce vomiting',
  'turmeric',
  'honey',
  'ghee',
];

const lines = (g: Guide, key: 'steps' | 'avoid' | 'household'): T[] => g[key] ?? [];
const hasWord = (text: string, word: string) => new RegExp(`\\b${word}\\b`, 'i').test(text);

test('every guide has a non-empty English and Hindi version of every line, with equal counts', () => {
  for (const g of GUIDES) {
    const groups: [string, T[]][] = [
      ['steps', g.steps],
      ['avoid', g.avoid ?? []],
      ['household', g.household ?? []],
    ];
    for (const [name, arr] of groups) {
      for (const t of arr) {
        assert.equal(t.length, 2, `${g.id} ${name}: pair must have en and hi`);
        assert.ok(t[0].trim(), `${g.id} ${name}: empty English`);
        assert.ok(t[1].trim(), `${g.id} ${name}: empty Hindi`);
        assert.match(t[1], DEVANAGARI, `${g.id} ${name}: Hindi has no Devanagari`);
        assert.doesNotMatch(t[0], DEVANAGARI, `${g.id} ${name}: English contains Devanagari`);
      }
    }
    assert.equal(g.steps.length, g.steps.map((s) => s[0]).length, `${g.id}: en/hi step counts differ`);
    assert.ok(g.steps.length >= 3, `${g.id}: needs at least 3 steps`);
    assert.equal(g.title.length, 2, `${g.id}: title pair`);
    assert.ok(g.title[0].trim() && g.title[1].trim(), `${g.id}: empty title`);
    assert.ok(g.keywords[0].trim() && g.keywords[1].trim(), `${g.id}: empty keywords`);
  }
  for (const d of DISASTERS) {
    for (const t of [...d.before, ...d.during, ...d.after]) {
      assert.equal(t.length, 2, `${d.id}: pair must have en and hi`);
      assert.match(t[1], DEVANAGARI, `${d.id}: Hindi has no Devanagari`);
    }
  }
});

test('no forbidden unsafe phrase is given as an instruction in English', () => {
  for (const g of GUIDES) {
    for (const t of lines(g, 'steps').concat(lines(g, 'household'))) {
      for (const bad of FORBIDDEN) {
        assert.ok(!hasWord(t[0], bad), `${g.id}: forbidden "${bad}" in step: ${t[0]}`);
      }
    }
  }
  for (const d of DISASTERS) {
    for (const t of [...d.before, ...d.during, ...d.after]) {
      for (const bad of FORBIDDEN) {
        assert.ok(!hasWord(t[0], bad), `${d.id}: forbidden "${bad}": ${t[0]}`);
      }
    }
  }
  for (const id of DODONT_IDS) {
    for (const lang of ['en'] as const) {
      const dd = dodontFor(id, lang);
      for (const s of dd?.do ?? []) {
        for (const bad of FORBIDDEN) assert.ok(!hasWord(s, bad), `${id} do: forbidden "${bad}"`);
      }
    }
  }
});

test('avoid and don\'t lines that mention an unsafe item are negated', () => {
  const unsafe = /butter|toothpaste|ice|oil|suck|cut|vomit|turmeric|honey|ghee|chilli|ash|soil|stitch|drop|tourniquet/i;
  for (const g of GUIDES) {
    for (const t of lines(g, 'avoid')) {
      if (unsafe.test(t[0])) assert.match(t[0], NEGATION, `${g.id} avoid mentions an item without a negation: ${t[0]}`);
    }
  }
  for (const id of DODONT_IDS) {
    for (const s of dodontFor(id, 'en')?.dont ?? []) {
      if (unsafe.test(s)) assert.match(s, NEGATION, `${id} dont without negation: ${s}`);
    }
  }
});

test('Hindi keeps the negation of English "do not / never / no" lines', () => {
  for (const g of GUIDES) {
    for (const t of lines(g, 'avoid')) {
      if (NEGATION.test(t[0])) assert.match(t[1], /न|मत/, `${g.id} avoid: Hindi lost the negation: ${t[1]}`);
    }
  }
  for (const d of DISASTERS) {
    for (const t of [...d.before, ...d.during, ...d.after]) {
      if (NEGATION.test(t[0])) assert.match(t[1], /न|मत/, `${d.id}: Hindi lost the negation: ${t[1]}`);
    }
  }
  for (const id of DODONT_IDS) {
    const en = dodontFor(id, 'en');
    const hi = dodontFor(id, 'hi');
    assert.ok(en && hi, `${id}: missing language`);
    assert.equal(hi.do.length, en.do.length, `${id}: do counts differ`);
    assert.equal(hi.dont.length, en.dont.length, `${id}: dont counts differ`);
    for (let i = 0; i < en.dont.length; i++) {
      if (NEGATION.test(en.dont[i])) assert.match(hi.dont[i], /न|मत/, `${id} dont[${i}]: Hindi lost the negation`);
    }
  }
});

test('every guide mentions 112 or a doctor or hospital', () => {
  for (const g of GUIDES) {
    const all = [...g.steps, ...(g.avoid ?? []), ...(g.household ?? [])].map((t) => t[0]).join(' ');
    assert.match(all, CALL_HELP, `${g.id}: no mention of 112, doctor or hospital`);
  }
  for (const d of DISASTERS) {
    const all = [...d.before, ...d.during, ...d.after].map((t) => t[0]).join(' ');
    assert.match(all, CALL_HELP, `${d.id}: no mention of 112, doctor or hospital`);
  }
});

test('every first-aid and remedy guide ends with a call-112 instruction', () => {
  for (const g of GUIDES) {
    const last = g.steps[g.steps.length - 1][0];
    assert.match(last, /\b112\b/, `${g.id}: last step should say when to call 112: ${last}`);
  }
});

test('no drug doses in milligrams in English guidance', () => {
  for (const g of GUIDES) {
    for (const t of [...g.steps, ...(g.avoid ?? [])]) {
      assert.doesNotMatch(t[0], /\d\s?mg\b/, `${g.id}: dose in English: ${t[0]}`);
    }
  }
});

test('key facts stay on standard guidance', () => {
  const byId = (id: string) => GUIDES.find((g) => g.id === id);
  const text = (id: string) => (byId(id)?.steps ?? []).map((s) => s[0]).join(' ');
  assert.match(text('cpr-adult'), /5-6 cm/);
  assert.match(text('cpr-adult'), /100 to 120/);
  assert.match(text('homemade-ors'), /6 level teaspoons of sugar/);
  assert.match(text('homemade-ors'), /½ level teaspoon of salt/);
  assert.match(text('purify-water'), /1 minute/);
  assert.match(text('burns'), /20 minutes/);
  assert.match(text('animal-bite'), /15 minutes/);
  assert.match(text('improvised-tourniquet'), /write the time|time/i);
  assert.match(text('dehydration'), /50-100 ml/);
  assert.ok(!text('cloth-bandage').match(/Pads are sterile/));
  const burnsAvoid = (byId('burns')?.avoid ?? []).map((s) => s[0]).join(' ');
  assert.match(burnsAvoid, /oil/);
});
