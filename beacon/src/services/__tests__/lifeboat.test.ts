import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DRAIN_PER_HOUR, LIFEBOAT_FACTOR, estimateHoursLeft, factorFor, pollMs, shouldAutoActivate } from '../lifeboat';

test('lifeboat multiplies polling by 4 only while active', () => {
  assert.equal(LIFEBOAT_FACTOR, 4);
  assert.equal(factorFor(false), 1);
  assert.equal(factorFor(true), 4);
});

test('hours left uses the conservative drain rates', () => {
  assert.equal(estimateHoursLeft(100, false), Math.floor(100 / DRAIN_PER_HOUR.normal));
  assert.equal(estimateHoursLeft(100, true), Math.floor(100 / DRAIN_PER_HOUR.lifeboat));
  assert.equal(estimateHoursLeft(50, false), 5);
  assert.equal(estimateHoursLeft(50, true), 16);
});

test('hours left is never negative and clamps the percentage', () => {
  assert.equal(estimateHoursLeft(-20, true), 0);
  assert.equal(estimateHoursLeft(250, false), 10);
});

test('lifeboat always lasts longer than normal use at the same charge', () => {
  for (const pct of [5, 15, 40, 80, 100]) {
    assert.ok(estimateHoursLeft(pct, true) >= estimateHoursLeft(pct, false));
  }
});

test('auto activation needs the opt-in, low battery, not charging and not already active', () => {
  const on = { auto: true, autoBelowPercent: 15, active: false };
  assert.equal(shouldAutoActivate(15, on, false), true);
  assert.equal(shouldAutoActivate(14, on, false), true);
  assert.equal(shouldAutoActivate(16, on, false), false);
  assert.equal(shouldAutoActivate(10, { ...on, auto: false }, false), false, 'never without opt-in');
  assert.equal(shouldAutoActivate(10, on, true), false, 'not while charging');
  assert.equal(shouldAutoActivate(10, { ...on, active: true }, false), false, 'already on');
});

test('pollMs with lifeboat off keeps the base interval', () => {
  // no store in tests, so the factor is 1 and the base interval comes back unchanged
  assert.equal(pollMs(60_000), 60_000);
});
