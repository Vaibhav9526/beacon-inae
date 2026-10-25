import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_GUIDES } from '../../kb';
import { TRIAGE_CHOICES } from '../../kb/triage';
import { choiceFromDescription, triageQuestions, triageResult } from '../triage';

const ids = new Set(ALL_GUIDES.map((g) => g.id));

test('every choice has questions (except not sure), and every guide id exists', () => {
  for (const c of TRIAGE_CHOICES) {
    if (c.id !== 'unsure') assert.ok(c.questions.length >= 1 && c.questions.length <= 3, `${c.id} question count`);
    for (const g of [...c.base.guideIds, ...c.questions.flatMap((q) => q.yes?.guideIds ?? [])]) {
      assert.ok(ids.has(g), `${c.id} points to unknown guide ${g}`);
    }
    assert.equal(triageQuestions(c.id).length, c.questions.length);
  }
});

test('questions and reasons exist in both languages', () => {
  for (const c of TRIAGE_CHOICES) {
    for (const q of c.questions) {
      assert.ok(q.ask[0].trim() && q.ask[1].trim());
      assert.match(q.ask[1], /[ऀ-ॿ]/);
    }
    assert.match(c.base.reason[1], /[ऀ-ॿ]/);
  }
  const hi = triageQuestions('bleeding', 'hi');
  assert.match(hi[0].text, /[ऀ-ॿ]/);
});

test('no answers gives the base outcome', () => {
  const r = triageResult('bleeding', {});
  assert.equal(r.severity, 'home');
  assert.deepEqual(r.guideIds, ['minor-wound']);
  assert.equal(r.reasons.length, 1);
});

test('spurting bleeding is an emergency with the severe bleeding guide first', () => {
  const r = triageResult('bleeding', { 'bleed-spurt': true });
  assert.equal(r.severity, 'emergency');
  assert.equal(r.guideIds[0], 'severe-bleeding');
  assert.ok(r.reasons.some((x) => /112/.test(x)));
});

test('a "no" answer never lowers severity or drops a guide', () => {
  const base = triageResult('breathing', {});
  const withNo = triageResult('breathing', { 'breath-baby': false, 'breath-smoke': false });
  assert.equal(withNo.severity, 'emergency');
  assert.deepEqual(withNo.guideIds, base.guideIds);
});

test('answers only escalate: deep wound is urgent, spurting on top stays emergency', () => {
  assert.equal(triageResult('bleeding', { 'bleed-deep': true }).severity, 'urgent');
  assert.equal(triageResult('bleeding', { 'bleed-deep': true, 'bleed-spurt': true }).severity, 'emergency');
  assert.equal(triageResult('burn', { 'burn-large': true, 'burn-deep': true }).severity, 'emergency');
});

test('guide ids are unique and reasons are de-duplicated', () => {
  for (const c of TRIAGE_CHOICES) {
    const answers = Object.fromEntries(c.questions.map((q) => [q.id, true]));
    const r = triageResult(c.id, answers);
    assert.equal(new Set(r.guideIds).size, r.guideIds.length, `${c.id} duplicate guides`);
    assert.equal(new Set(r.reasons).size, r.reasons.length, `${c.id} duplicate reasons`);
  }
});

test('unknown answer keys are ignored and the hindi result is localised', () => {
  const r = triageResult('fracture', { nonsense: true }, 'hi');
  assert.equal(r.severity, 'urgent');
  assert.match(r.reasons[0], /[ऀ-ॿ]/);
});

test('unsure is urgent with no guides until answered', () => {
  const r = triageResult('unsure', {});
  assert.equal(r.severity, 'urgent');
  assert.deepEqual(r.guideIds, []);
  assert.equal(triageResult('unsure', { 'unsure-conscious': true }).severity, 'emergency');
});

test('vision sentences pre-select the best choice, and nothing when unrelated', () => {
  assert.equal(choiceFromDescription('A bleeding cut on a hand.'), 'bleeding');
  assert.equal(choiceFromDescription('A burn with a blister on the arm'), 'burn');
  assert.equal(choiceFromDescription('a snake bite on the ankle'), 'bite');
  assert.equal(choiceFromDescription('a bright blue sky over the hills'), null);
  assert.equal(choiceFromDescription(''), null);
});
