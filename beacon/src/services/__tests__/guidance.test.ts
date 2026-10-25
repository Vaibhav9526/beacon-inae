import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_HOME, type GuidanceHazard, type Household, type Person, personalGuidance } from '../guidance';

const person = (o: Partial<Person>): Person => ({
  id: 'p1',
  name: '',
  age: 'adult',
  conditions: [],
  otherCondition: '',
  medicines: [],
  languages: [],
  ...o,
});
const hh = (people: Person[], home = {}): Household => ({ people, home: { ...EMPTY_HOME, ...home } });
const empty = hh([]);

test('ground floor + flood warning gives a now move-up step that names the floor', () => {
  const g = personalGuidance({ phase: 'alert', hazard: 'flood', severity: 'warning', household: hh([], { floor: 'ground' }) });
  const s = g.steps.find((x) => x.id === 'home-low-floor');
  assert.ok(s);
  assert.equal(s.urgency, 'now');
  assert.match(s.why!.en, /ground floor/);
  assert.match(s.text.en, /Move up/);
});

test('elder with limited mobility + cyclone: early move with a named helper', () => {
  const g = personalGuidance({
    phase: 'alert',
    hazard: 'cyclone',
    severity: 'warning',
    household: hh([person({ id: 'a', name: 'Dadi', age: 'elder', conditions: ['mobility'] }), person({ id: 'b', name: 'Ravi' })]),
  });
  const s = g.steps.find((x) => x.id === 'mobility-a');
  assert.ok(s);
  assert.equal(s.urgency, 'now');
  assert.match(s.text.en, /early/);
  assert.match(s.text.en, /Ravi/);
});

test('asthma + heatwave includes an inhaler pack step', () => {
  const g = personalGuidance({ phase: 'prepare', hazard: 'heatwave', severity: null, household: hh([person({ conditions: ['asthma'] })]) });
  assert.ok(g.steps.some((s) => /inhaler/i.test(s.text.en)));
  assert.ok(g.packList.some((x) => /inhaler/i.test(x)));
});

test('no household data falls back to generic guidance', () => {
  const hazards: Array<GuidanceHazard | null> = [null, 'earthquake', 'flood', 'cyclone', 'landslide', 'heatwave', 'lightning', 'tsunami', 'fire'];
  for (const phase of ['prepare', 'alert', 'recover'] as const) {
    for (const hazard of hazards) {
      const g = personalGuidance({ phase, hazard, severity: null, household: empty });
      assert.ok(g.headline.length > 0);
      assert.ok(g.steps.length > 0, `${phase}/${hazard}`);
    }
  }
});

test('every step, headline and list is bilingual', () => {
  const rich = hh(
    [
      person({ id: 'a', name: 'Dadi', age: 'elder', conditions: ['mobility', 'oxygen', 'heart', 'sensory'] }),
      person({ id: 'b', name: 'Ravi', conditions: ['asthma', 'diabetes', 'insulin', 'pregnant', 'epilepsy', 'dialysis'], medicines: [{ id: 'm', name: 'Insulin', critical: true, daysLeft: 1 }] }),
      person({ id: 'c', age: 'child' }),
    ],
    { floor: 'basement', building: 'kutcha', nearWater: true, hasVehicle: true, pets: 2, shelterName: 'School', meetingPoint: 'Temple' },
  );
  for (const phase of ['prepare', 'alert', 'recover'] as const) {
    for (const hazard of ['earthquake', 'flood', 'cyclone', 'landslide', 'heatwave', 'lightning', 'tsunami', 'fire', null] as const) {
      const g = personalGuidance({ phase, hazard, severity: 'warning', household: rich });
      assert.ok(g.headline && g.headlineHi);
      assert.equal(g.packList.length, g.packListHi.length);
      assert.equal(g.avoid.length, g.avoidHi.length);
      for (const s of g.steps) {
        assert.ok(s.text.en.trim() && s.text.hi.trim(), s.id);
        if (s.why) assert.ok(s.why.en.trim() && s.why.hi.trim(), s.id);
        assert.ok(['now', 'soon', 'prepare'].includes(s.urgency));
      }
    }
  }
});

test('no step gives dose numbers', () => {
  const h = hh([person({ conditions: ['diabetes', 'insulin', 'heart', 'asthma'], medicines: [{ id: 'm', name: 'Metformin', critical: true, daysLeft: 1 }] })], { floor: 'ground' });
  for (const phase of ['prepare', 'alert', 'recover'] as const) {
    for (const hazard of ['flood', 'heatwave', 'fire'] as const) {
      const g = personalGuidance({ phase, hazard, severity: 'severe', household: h });
      for (const s of g.steps) {
        const all = `${s.text.en} ${s.why?.en ?? ''}`;
        assert.doesNotMatch(all, /\b\d+\s*(mg|ml)\b|tablets? of/i, s.id);
      }
    }
  }
});

test('alert phase always ends with 112 advice, others do not', () => {
  for (const hazard of ['flood', 'fire', null] as const) {
    const g = personalGuidance({ phase: 'alert', hazard, severity: 'warning', household: hh([person({ conditions: ['oxygen'] })], { floor: 'ground' }) });
    const last = g.steps[g.steps.length - 1];
    assert.match(last.text.en, /112/);
  }
  const p = personalGuidance({ phase: 'prepare', hazard: 'flood', severity: null, household: empty });
  assert.ok(!p.steps.some((s) => s.id === 'call-112'));
});

test('low medicine stock: restock now in prepare and recover', () => {
  const h = hh([person({ name: 'Asha', medicines: [{ id: 'm', name: 'BP tablet', critical: true, daysLeft: 2 }] })]);
  for (const phase of ['prepare', 'recover'] as const) {
    const g = personalGuidance({ phase, hazard: 'flood', severity: null, household: h });
    const s = g.steps.find((x) => x.id === 'restock-p1');
    assert.ok(s, phase);
    assert.equal(s.urgency, 'now');
  }
});

test('steps are ordered now, soon, prepare and output is deterministic', () => {
  const h = hh([person({ id: 'a', name: 'Dadi', age: 'elder', conditions: ['mobility'] }), person({ id: 'c', age: 'child' })], { floor: 'ground', pets: 1 });
  const input = { phase: 'alert' as const, hazard: 'flood' as const, severity: 'severe' as const, household: h };
  const a = personalGuidance(input);
  const b = personalGuidance(input);
  assert.deepEqual(a, b);
  const rank = { now: 0, soon: 1, prepare: 2 };
  const body = a.steps.slice(0, -1);
  for (let i = 1; i < body.length; i++) assert.ok(rank[body[i - 1].urgency] <= rank[body[i].urgency]);
});
