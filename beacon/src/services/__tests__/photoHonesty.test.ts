import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_GUIDES } from '../../kb';
import { TRIAGE_CHOICES } from '../../kb/triage';
import { DEFAULT_QUESTION } from '../../vision/smolvlm';
import { choiceFromDescription, mentions, triageResult } from '../triage';

const ids = new Set(ALL_GUIDES.map((g) => g.id));
const SEVERITIES = ['emergency', 'urgent', 'home'];

test('every choice starts with a valid, sensible base outcome', () => {
  for (const c of TRIAGE_CHOICES) {
    assert.ok(SEVERITIES.includes(c.base.severity), `${c.id} severity`);
    assert.ok(c.base.reason[0].trim() && c.base.reason[1].trim(), `${c.id} base reason in both languages`);
    for (const g of c.base.guideIds) assert.ok(ids.has(g), `${c.id} base guide ${g}`);
    // with no answers, only breathing trouble is an emergency; everything else is at most urgent
    if (c.id !== 'breathing') assert.notEqual(triageResult(c.id, {}).severity, 'emergency', `${c.id} with no answers`);
  }
});

test('every yes answer resolves to a valid severity and only real guide ids, in both languages', () => {
  for (const c of TRIAGE_CHOICES) {
    for (const q of c.questions) {
      assert.ok(q.ask[0].trim() && q.ask[1].trim(), `${q.id} question in both languages`);
      if (q.yes) {
        assert.ok(SEVERITIES.includes(q.yes.severity), `${q.id} severity`);
        assert.ok(q.yes.reason[0].trim() && q.yes.reason[1].trim(), `${q.id} reason in both languages`);
        for (const g of q.yes.guideIds) assert.ok(ids.has(g), `${q.id} points to unknown guide ${g}`);
      }
    }
  }
});

test('not sure is conservative: urgent, no random guide, 112 when it gets worse', () => {
  const r = triageResult('unsure', {});
  assert.equal(r.severity, 'urgent');
  assert.deepEqual(r.guideIds, []);
  assert.match(r.reasons[0], /112/);
  // a severe answer gives the emergency number and no bleeding steps
  const severe = triageResult('unsure', { 'unsure-severe': true });
  assert.equal(severe.severity, 'emergency');
  assert.deepEqual(severe.guideIds, []);
  assert.match(severe.reasons[0], /112/);
  // a confused person gets the recovery position, not bleeding steps
  assert.deepEqual(triageResult('unsure', { 'unsure-conscious': true }).guideIds, ['recovery-position', 'cpr-adult']);
});

test('trouble breathing shows choking steps only when the person says something is stuck', () => {
  assert.deepEqual(triageResult('breathing', {}).guideIds, []);
  assert.equal(triageResult('breathing', {}).severity, 'emergency');
  const stuck = triageResult('breathing', { 'breath-choking': true });
  assert.deepEqual(stuck.guideIds, ['choking-adult']);
  assert.ok(!stuck.guideIds.includes('choking-infant'));
});

test('a rusty or dirty cut also points to the wound guide, not only the animal bite guide', () => {
  const r = triageResult('cut', { 'cut-dirty': true });
  assert.ok(r.guideIds.includes('minor-wound'));
  assert.ok(r.guideIds.includes('animal-bite'));
  assert.ok(r.reasons.some((x) => /tetanus/i.test(x)));
});

test('eye: rinsing is for chemicals only; sudden loss of sight says call 112 without rinse steps', () => {
  const vision = triageResult('eye', { 'eye-vision': true });
  assert.equal(vision.severity, 'emergency');
  assert.ok(vision.reasons.every((x) => !/Rinse/.test(x)), 'no rinse advice for sight loss');
  assert.ok(vision.reasons.some((x) => /112/.test(x)));
  assert.match(triageResult('eye', { 'eye-chem': true }).reasons.join(' '), /Rinse/);
});

test('a bee sting is not described as a rabies case', () => {
  const base = TRIAGE_CHOICES.find((c) => c.id === 'bite')!.base.reason[0];
  assert.match(base, /sting/);
});

test('mentions matches whole words only and skips negated mentions', () => {
  assert.equal(mentions('the surface is clean', 'face'), false, 'surface is not face');
  assert.equal(mentions('no blood is visible', 'blood'), false, 'negated');
  assert.equal(mentions('blood on the hand', 'blood'), true);
  assert.equal(mentions('the cuts look clean', 'cut'), true, 'plural');
  assert.equal(mentions('no sign of a bruise', 'bruise'), false);
  assert.equal(mentions('बहुत खून बह रहा है', 'खून'), true, 'hindi is a plain substring match');
});

test('vision text pre-selects only when a choice word is clearly present', () => {
  assert.equal(choiceFromDescription('no blood visible'), null);
  assert.equal(choiceFromDescription('the surface of a table'), null);
  assert.equal(choiceFromDescription('a cut on the finger, no blood'), 'cut');
  assert.equal(choiceFromDescription('unclear'), null);
});

test('model output can only produce a choice id, never a severity or guide', () => {
  for (const s of ['EMERGENCY, call 112 now', 'severe-bleeding', 'use the burns guide', 'urgent']) {
    const c = choiceFromDescription(s);
    assert.ok(c === null || TRIAGE_CHOICES.some((x) => x.id === c), `"${s}" gave ${c}`);
  }
});

test('the smart model is asked only what is plainly visible, and may answer unclear', () => {
  assert.match(DEFAULT_QUESTION, /unclear/);
  assert.match(DEFAULT_QUESTION, /only what you can clearly see/i);
  assert.doesNotMatch(DEFAULT_QUESTION, /Mention any injury/);
});
