import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECOVER_WINDOW, computePhase, hazardIdFor } from '../phaseLogic';

const NOW = 1_800_000_000_000;
const base = { now: NOW, alerts: [], sosHeard: [], mySosActive: false };

test('calm: no alerts means prepare', () => {
  const r = computePhase(base);
  assert.equal(r.phase, 'prepare');
  assert.equal(r.watching, 0);
});

test('a watch-level alert is followed but does not flip the app', () => {
  const r = computePhase({ ...base, alerts: [{ severity: 'watch', title: 'Unhealthy air', seenAt: NOW - 1000 }] });
  assert.equal(r.phase, 'prepare');
  assert.equal(r.watching, 1);
});

test('severe or warning alert in force means alert, strongest first', () => {
  const r = computePhase({
    ...base,
    alerts: [
      { severity: 'warning', title: 'Heavy rain', seenAt: NOW - 5000 },
      { severity: 'severe', title: 'Earthquake M6', seenAt: NOW - 9000 },
    ],
  });
  assert.equal(r.phase, 'alert');
  assert.equal(r.lead?.title, 'Earthquake M6');
});

test('an expired alert no longer counts; one with no expiry fades after 24 hours', () => {
  const expired = computePhase({ ...base, alerts: [{ severity: 'severe', title: 'x', seenAt: NOW - 1e6, expires: NOW - 1 }] });
  assert.equal(expired.phase, 'prepare');
  const old = computePhase({ ...base, alerts: [{ severity: 'warning', title: 'x', seenAt: NOW - 25 * 3600_000 }] });
  assert.equal(old.phase, 'prepare');
});

test('my own SOS or a fresh verified SOS nearby means alert; stale or unverified does not', () => {
  assert.equal(computePhase({ ...base, mySosActive: true }).phase, 'alert');
  assert.equal(computePhase({ ...base, sosHeard: [{ timestamp: NOW - 60_000, verified: true }] }).phase, 'alert');
  assert.equal(computePhase({ ...base, sosHeard: [{ timestamp: NOW - 60_000, verified: false }] }).phase, 'prepare');
  assert.equal(computePhase({ ...base, sosHeard: [{ timestamp: NOW - 31 * 60_000, verified: true }] }).phase, 'prepare');
});

test('after a hazard passes the app is in recover for 72 hours, then back to prepare', () => {
  const soon = computePhase({ ...base, lastHazardAt: NOW - 3600_000 });
  assert.equal(soon.phase, 'recover');
  const edge = computePhase({ ...base, lastHazardAt: NOW - RECOVER_WINDOW + 1 });
  assert.equal(edge.phase, 'recover');
  const done = computePhase({ ...base, lastHazardAt: NOW - RECOVER_WINDOW - 1 });
  assert.equal(done.phase, 'prepare');
});

test('a new hazard beats recover', () => {
  const r = computePhase({ ...base, lastHazardAt: NOW - 3600_000, alerts: [{ severity: 'severe', title: 'Flood', seenAt: NOW }] });
  assert.equal(r.phase, 'alert');
});

test('manual override wins over everything', () => {
  const r = computePhase({ ...base, override: 'recover', alerts: [{ severity: 'severe', title: 'Flood', seenAt: NOW }] });
  assert.equal(r.phase, 'recover');
  assert.equal(r.lead?.title, 'Flood');
});

test('marking safe changes the reason text while recovering', () => {
  const a = computePhase({ ...base, lastHazardAt: NOW - 7200_000, safeAt: NOW - 3600_000 });
  const b = computePhase({ ...base, lastHazardAt: NOW - 7200_000 });
  assert.notEqual(a.reasons[0], b.reasons[0]);
});

test('hazardIdFor maps alert wording to a guide id', () => {
  assert.equal(hazardIdFor('Earthquake M5.2 near Delhi'), 'earthquake');
  assert.equal(hazardIdFor('Heavy rainfall warning'), 'flood');
  assert.equal(hazardIdFor('Heat wave: extreme heat'), 'heatwave');
  assert.equal(hazardIdFor('Cyclone Remal landfall'), 'cyclone');
  assert.equal(hazardIdFor('Unhealthy air (AQI 155)'), null);
});
