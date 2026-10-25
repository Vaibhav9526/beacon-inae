import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RoadEvent, RoadStatus } from '../../mesh/appTypes';
import { type Obstacle, HOUR_MS, activeObstacles, routePenalty, trustOf } from '../roadStatus';

const NOW = 1_800_000_000_000;
const LAT = 28.6;
const LON = 77.2;

let n = 0;
const ev = (o: { status?: RoadStatus; attesters?: number; verified?: boolean; ageH?: number; from?: string; lat?: number; lon?: number }): RoadEvent => ({
  report: { id: `r${n++}`.padEnd(8, '0'), status: o.status ?? 'blocked', lat: o.lat ?? LAT, lon: o.lon ?? LON, seenAt: NOW - (o.ageH ?? 0) * HOUR_MS },
  from: o.from ?? 'aa',
  attesters: o.attesters ?? 0,
  verified: o.verified ?? false,
  hops: 1,
  receivedAt: NOW,
});
const ob = (status: Obstacle['status'], level: 'low' | 'medium' | 'high', weight = level === 'high' ? 1 : level === 'medium' ? 0.7 : 0.4): Obstacle => ({
  lat: LAT,
  lon: LON,
  status,
  weight,
  id: 'x',
  attesters: level === 'high' ? 2 : level === 'medium' ? 1 : 0,
  level,
});

test('trust level follows attesters and verified', () => {
  assert.equal(trustOf(ev({ attesters: 0 }), NOW).level, 'low');
  assert.equal(trustOf(ev({ attesters: 1 }), NOW).level, 'medium');
  assert.equal(trustOf(ev({ attesters: 2 }), NOW).level, 'high');
  assert.equal(trustOf(ev({ attesters: 0, verified: true }), NOW).level, 'high');
  assert.ok(trustOf(ev({ attesters: 2 }), NOW).weight > trustOf(ev({ attesters: 1 }), NOW).weight);
});

test('weights halve at each half-life: flooded 3 h, blocked 6 h, crowded 1 h', () => {
  const w = (status: RoadStatus, ageH: number) => trustOf(ev({ status, attesters: 2, ageH }), NOW).weight;
  assert.ok(Math.abs(w('flooded', 3) - 0.5) < 1e-9);
  assert.ok(Math.abs(w('blocked', 6) - 0.5) < 1e-9);
  assert.ok(Math.abs(w('damaged', 12) - 0.25) < 1e-9);
  assert.ok(Math.abs(w('crowded', 1) - 0.5) < 1e-9);
  assert.ok(w('flooded', 3) < w('blocked', 3));
});

test('reports older than 24 hours are ignored', () => {
  assert.equal(trustOf(ev({ attesters: 2, ageH: 24.5 }), NOW).weight, 0);
  assert.equal(activeObstacles([ev({ attesters: 2, ageH: 25 })], NOW).length, 0);
  assert.equal(activeObstacles([ev({ attesters: 2, ageH: 23 })], NOW, { minWeight: 0.01 }).length, 1);
  assert.equal(activeObstacles([ev({ attesters: 2, ageH: 23 })], NOW).length, 0, 'faded below the default minimum weight');
});

test('faded reports drop below the minimum weight', () => {
  assert.equal(activeObstacles([ev({ status: 'crowded', attesters: 2, ageH: 4 })], NOW).length, 0); // 1/16
  assert.equal(activeObstacles([ev({ status: 'crowded', attesters: 2, ageH: 4 })], NOW, { minWeight: 0.01 }).length, 1);
});

test('a newer clear report from a trusted source cancels an older problem within 300 m', () => {
  const problem = ev({ status: 'flooded', attesters: 2, ageH: 2, from: 'aa' });
  const clear = ev({ status: 'clear', attesters: 1, ageH: 1, from: 'bb', lat: LAT + 0.002 }); // about 220 m
  assert.equal(activeObstacles([problem, clear], NOW).length, 0);
  const far = ev({ status: 'clear', attesters: 1, ageH: 1, from: 'bb', lat: LAT + 0.004 }); // about 450 m
  assert.equal(activeObstacles([problem, far], NOW).length, 1);
});

test('an unconfirmed clear from a stranger does not cancel, but one from the same sender does', () => {
  const problem = ev({ status: 'blocked', attesters: 2, ageH: 2, from: 'aa' });
  assert.equal(activeObstacles([problem, ev({ status: 'clear', attesters: 0, ageH: 1, from: 'bb' })], NOW).length, 1);
  assert.equal(activeObstacles([problem, ev({ status: 'clear', attesters: 0, ageH: 1, from: 'aa' })], NOW).length, 0);
});

test('a clear report older than the problem does not cancel it', () => {
  const clear = ev({ status: 'clear', attesters: 2, ageH: 3, from: 'bb' });
  const problem = ev({ status: 'blocked', attesters: 2, ageH: 1, from: 'aa' });
  assert.equal(activeObstacles([clear, problem], NOW).length, 1);
});

test('low-trust reports stay in the list with their level and lower weight', () => {
  const list = activeObstacles([ev({ attesters: 0 }), ev({ attesters: 2 })], NOW);
  assert.equal(list.length, 2);
  assert.ok(list.some((o) => o.level === 'low') && list.some((o) => o.level === 'high'));
});

test('penalties: blocked high is impassable, blocked medium is 10 minutes', () => {
  const [hi, med] = routePenalty([ob('blocked', 'high'), ob('blocked', 'medium', 1 * 0.7)], 'walk');
  assert.equal(hi.impassable, true);
  assert.equal(med.impassable, false);
  assert.ok(Math.abs(med.minutes - 10) < 1e-9);
});

test('penalties: flooded high is impassable driving, 8 minutes walking', () => {
  assert.equal(routePenalty([ob('flooded', 'high')], 'drive')[0].impassable, true);
  const walk = routePenalty([ob('flooded', 'high')], 'walk')[0];
  assert.equal(walk.impassable, false);
  assert.ok(Math.abs(walk.minutes - 8) < 1e-9);
});

test('penalties: damaged 3 minutes, crowded 2 minutes', () => {
  assert.ok(Math.abs(routePenalty([ob('damaged', 'high')])[0].minutes - 3) < 1e-9);
  assert.ok(Math.abs(routePenalty([ob('crowded', 'high')])[0].minutes - 2) < 1e-9);
});

test('a low-trust report is never impassable and costs a fraction', () => {
  const [b, f] = routePenalty([ob('blocked', 'low'), ob('flooded', 'low')], 'drive');
  assert.equal(b.impassable, false);
  assert.equal(f.impassable, false);
  assert.ok(b.minutes > 0 && b.minutes <= 5);
  assert.ok(f.minutes > 0 && f.minutes <= 5);
});

test('an old high-trust block fades from impassable to a penalty', () => {
  const [p] = routePenalty([ob('blocked', 'high', 0.3)], 'walk');
  assert.equal(p.impassable, false);
  assert.ok(p.minutes > 0 && p.minutes < 20);
});
