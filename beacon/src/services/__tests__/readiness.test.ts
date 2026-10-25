import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type ReadinessInput, readinessScore } from '../readiness';

const empty: ReadinessInput = {
  medicalIdFilled: false,
  emergencyContactsCount: 0,
  goBagChecked: 0,
  goBagTotal: 17,
  drillsDone: 0,
  drillsTotal: 4,
  familyMembersLinked: false,
  shelterKnown: false,
  hubPaired: false,
  hazardLevelMax: 0,
};

const full: ReadinessInput = {
  medicalIdFilled: true,
  emergencyContactsCount: 2,
  goBagChecked: 17,
  goBagTotal: 17,
  drillsDone: 4,
  drillsTotal: 4,
  bestDrillMs: 45_000,
  familyMembersLinked: 2,
  shelterKnown: true,
  waterDaysAtHome: 3,
  hubPaired: true,
  hazardLevelMax: 0,
};

test('score is bounded and complete readiness is 100', () => {
  assert.equal(readinessScore(empty).score, 0);
  assert.equal(readinessScore(full).score, 100);
  for (const input of [empty, full, { ...empty, goBagChecked: -5, goBagTotal: 0, drillsTotal: -1 }]) {
    const score = readinessScore(input).score;
    assert.ok(score >= 0 && score <= 100, `score out of range: ${score}`);
  }
});

test('score rises monotonically as each preparation is completed', () => {
  let previous = readinessScore(empty).score;
  const steps: Partial<ReadinessInput>[] = [
    { medicalIdFilled: true },
    { emergencyContactsCount: 1 },
    { emergencyContactsCount: 2 },
    { goBagChecked: 5 },
    { goBagChecked: 12 },
    { goBagChecked: 17 },
    { drillsDone: 2 },
    { drillsDone: 4 },
    { familyMembersLinked: true },
    { shelterKnown: true },
    { waterDaysAtHome: 2 },
    { waterDaysAtHome: 3 },
    { hubPaired: true },
  ];
  for (const step of steps) {
    const next = readinessScore({ ...empty, ...Object.assign({}, ...steps.slice(0, steps.indexOf(step) + 1)) });
    assert.ok(next.score >= previous, `score fell at ${JSON.stringify(step)}`);
    previous = next.score;
  }
});

test('a faster drill time can only add readiness', () => {
  const slow = readinessScore({ ...empty, drillsDone: 3, bestDrillMs: 180_000 });
  const fast = readinessScore({ ...empty, drillsDone: 3, bestDrillMs: 45_000 });
  assert.ok(fast.score >= slow.score);
});

test('higher hazard raises the weight of matching preparation', () => {
  const calm = readinessScore({ ...empty, hazardLevelMax: 0 });
  const risky = readinessScore({ ...empty, hazardLevelMax: 3 });
  const shelter = (r: ReturnType<typeof readinessScore>) => r.parts.find((p) => p.id === 'shelter')?.weight ?? 0;
  const water = (r: ReturnType<typeof readinessScore>) => r.parts.find((p) => p.id === 'water')?.weight ?? 0;
  assert.ok(shelter(risky) > shelter(calm));
  assert.ok(water(risky) > water(calm));
});

test('next suggests the heaviest missing item first', () => {
  const onlyMedicalMissing = readinessScore({ ...full, medicalIdFilled: false });
  assert.equal(onlyMedicalMissing.next[0]?.id, 'medical');

  const noGoBag = readinessScore({ ...full, goBagChecked: 0 });
  assert.equal(noGoBag.next[0]?.id, 'gobag');
  assert.ok(noGoBag.next.length <= 3);
});
