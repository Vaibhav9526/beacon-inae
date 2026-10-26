import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distanceKm } from '../../alerts/sources';
import { type OfflineArea } from '../osm';
import { buildGraph, firstBearingDeg, routeTo, routesTo, turnHints } from '../route';

const LAT0 = 28.6;
const LON0 = 77.2;
const m = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => distanceKm(a, b) * 1000;

/** Synthetic area from polylines (no simplification, so the test controls the exact geometry). */
const area = (roads: { c: 0 | 1 | 2 | 3; p: [number, number][]; f?: boolean }[]): OfflineArea => ({
  v: 2,
  center: { lat: LAT0, lon: LON0 },
  radiusKm: 3,
  savedAt: 0,
  roads: roads.map((r) => ({ c: r.c, p: r.p.flat(), ...(r.f ? { f: 1 as const } : {}) })),
  water: [],
  places: [],
});

/** n x n grid of streets, one way per row and per column, step in degrees. */
const grid = (n: number, step = 0.001) => {
  const roads: { c: 0 | 1 | 2 | 3; p: [number, number][] }[] = [];
  const idx = Array.from({ length: n }, (_, k) => k);
  for (const i of idx) {
    roads.push({ c: 3, p: idx.map((j): [number, number] => [LAT0 + i * step, LON0 + j * step]) });
    roads.push({ c: 3, p: idx.map((j): [number, number] => [LAT0 + j * step, LON0 + i * step]) });
  }
  return area(roads);
};

test('3x3 grid: shortest path follows the streets, never a straight line', () => {
  const a = grid(3);
  const from = { lat: LAT0, lon: LON0 };
  const to = { lat: LAT0 + 0.002, lon: LON0 + 0.002 };
  const r = routeTo(a, from, to, 'walk');
  assert.ok(r, 'route found');
  const step1 = m(from, { lat: LAT0 + 0.001, lon: LON0 });
  const step2 = m(from, { lat: LAT0, lon: LON0 + 0.001 });
  const expected = 2 * step1 + 2 * step2;
  assert.ok(Math.abs(r.distanceM - expected) < 1, `expected ${expected}, got ${r.distanceM}`);
  assert.ok(r.distanceM >= m(from, to), 'road distance is at least the straight line');
  assert.deepEqual(r.points[0], from);
  assert.deepEqual(r.points[r.points.length - 1], to);
  assert.equal(r.snappedStartM, 0);
});

test('snapping goes onto the middle of a long segment, not just to its vertices', () => {
  const road = area([{ c: 3, p: [[LAT0, LON0], [LAT0, LON0 + 0.02]] }]);
  const from = { lat: LAT0 + 0.0005, lon: LON0 + 0.01 }; // about 55 m north of the middle
  const to = { lat: LAT0, lon: LON0 + 0.02 };
  const mid = { lat: LAT0, lon: LON0 + 0.01 };
  const r = routeTo(road, from, to, 'walk');
  assert.ok(r);
  assert.ok(Math.abs(r.snappedStartM - m(from, mid)) < 1, `snapped ${r.snappedStartM} m`);
  assert.ok(m(r.points[1], mid) < 1, 'snapped point is the middle of the segment');
  assert.ok(Math.abs(r.distanceM - (r.snappedStartM + m(mid, to))) < 2);
});

test('a point more than 400 m from any road has no route', () => {
  const road = area([{ c: 3, p: [[LAT0, LON0], [LAT0, LON0 + 0.01]] }]);
  const far = { lat: LAT0 + 0.005, lon: LON0 + 0.005 }; // about 555 m away
  assert.equal(routeTo(road, far, { lat: LAT0, lon: LON0 + 0.01 }, 'walk'), null);
});

test('a disconnected island returns null', () => {
  const a = area([
    { c: 3, p: [[LAT0, LON0], [LAT0, LON0 + 0.001]] },
    { c: 3, p: [[LAT0 + 0.001, LON0], [LAT0 + 0.001, LON0 + 0.001]] }, // 110 m away, shares no vertex
  ]);
  assert.equal(routeTo(a, { lat: LAT0, lon: LON0 + 0.0005 }, { lat: LAT0 + 0.001, lon: LON0 + 0.0005 }, 'walk'), null);
});

test('shortest of two alternatives is chosen', () => {
  const a = area([
    { c: 2, p: [[LAT0, LON0], [LAT0, LON0 + 0.01]] }, // direct
    { c: 2, p: [[LAT0, LON0], [LAT0 + 0.004, LON0], [LAT0 + 0.004, LON0 + 0.01], [LAT0, LON0 + 0.01]] }, // detour
  ]);
  const from = { lat: LAT0, lon: LON0 };
  const to = { lat: LAT0, lon: LON0 + 0.01 };
  const r = routeTo(a, from, to, 'walk');
  assert.ok(r);
  assert.ok(Math.abs(r.distanceM - m(from, to)) < 1, `direct road, got ${r.distanceM}`);
  assert.ok(r.points.every((p) => p.lat < LAT0 + 0.001), 'no detour vertices used');
});

test('walking skips motorways and footpaths are not used for driving', () => {
  const motorway = area([{ c: 0, p: [[LAT0, LON0], [LAT0, LON0 + 0.01]] }]);
  const onRoad = { lat: LAT0, lon: LON0 + 0.005 };
  const end = { lat: LAT0, lon: LON0 + 0.01 };
  assert.equal(routeTo(motorway, onRoad, end, 'walk'), null);
  assert.ok(routeTo(motorway, onRoad, end, 'drive'));
  const footpath = area([{ c: 3, f: true, p: [[LAT0, LON0], [LAT0, LON0 + 0.01]] }]);
  assert.equal(routeTo(footpath, onRoad, end, 'drive'), null);
  assert.ok(routeTo(footpath, onRoad, end, 'walk'));
});

test('minutes use 4.8 km/h walking and 25 km/h driving', () => {
  const road = area([{ c: 3, p: [[LAT0, LON0], [LAT0, LON0 + 0.01]] }]);
  const from = { lat: LAT0, lon: LON0 };
  const to = { lat: LAT0, lon: LON0 + 0.01 };
  const d = m(from, to);
  const walk = routeTo(road, from, to, 'walk');
  const drive = routeTo(road, from, to, 'drive');
  assert.ok(walk && drive);
  assert.ok(Math.abs(walk.minutes - d / 80) <= 1, `walk ${walk.minutes}`);
  assert.ok(Math.abs(drive.minutes - d / (25000 / 60)) <= 1, `drive ${drive.minutes}`);
});

test('graph is built once per area object', () => {
  const a = grid(2);
  assert.equal(buildGraph(a), buildGraph(a));
});

test('routesTo ranks reachable places by road distance and puts unreachable ones last', () => {
  const a = area([
    { c: 3, p: [[LAT0, LON0], [LAT0, LON0 + 0.01]] }, // main road
    { c: 3, p: [[LAT0 + 0.0001, LON0], [LAT0 + 0.0001, LON0 + 0.0005]] }, // island, 11 m from the start, not connected
  ]);
  const from = { lat: LAT0, lon: LON0 };
  const reachable = { name: 'far but reachable', lat: LAT0, lon: LON0 + 0.01 };
  const island = { name: 'close but cut off', lat: LAT0 + 0.0001, lon: LON0 + 0.0005 };
  const out = routesTo(a, from, [reachable, island], 'walk', 8);
  assert.equal(out.length, 2);
  assert.equal(out[0].place.name, 'far but reachable');
  assert.ok(out[0].road && out[0].road.roadM >= out[0].straightM);
  assert.equal(out[1].place.name, 'close but cut off');
  assert.equal(out[1].road, null);
});

test('routesTo keeps only the nearest `limit` places by straight line', () => {
  const a = grid(3);
  const places = [0, 1, 2, 3].map((k) => ({ lat: LAT0, lon: LON0 + k * 0.001 }));
  assert.equal(routesTo(a, { lat: LAT0, lon: LON0 }, places, 'walk', 2).length, 2);
});

test('first bearing and turn hints describe the road legs', () => {
  const a = area([{ c: 3, p: [[LAT0, LON0], [LAT0 + 0.0027, LON0], [LAT0 + 0.0027, LON0 + 0.0033]] }]);
  const r = routeTo(a, { lat: LAT0, lon: LON0 }, { lat: LAT0 + 0.0027, lon: LON0 + 0.0033 }, 'walk');
  assert.ok(r);
  assert.ok(Math.abs(firstBearingDeg(r.points)! - 0) < 1 || Math.abs(firstBearingDeg(r.points)! - 360) < 1, 'first leg goes north');
  const legs = turnHints(r.points);
  assert.equal(legs.length, 2);
  assert.equal(legs[0].compass, 'N');
  assert.equal(legs[0].turn, 'right');
  assert.ok(Math.abs(legs[0].meters - 300) < 5, `north leg ${legs[0].meters} m`);
  assert.equal(legs[1].compass, 'E');
  assert.equal(legs[1].turn, null);
});

test('a 20k-edge graph routes corner to corner within a fraction of a second', () => {
  const big = grid(100, 0.0005); // 2 x 100 x 99 = 19,800 edges
  const t0 = performance.now();
  buildGraph(big);
  const built = performance.now() - t0;
  const from = { lat: LAT0, lon: LON0 };
  const to = { lat: LAT0 + 99 * 0.0005, lon: LON0 + 99 * 0.0005 };
  const t1 = performance.now();
  const r = routeTo(big, from, to, 'walk');
  const took = performance.now() - t1;
  assert.ok(r, 'route found');
  assert.ok(r.distanceM >= m(from, to));
  console.log(`graph build ${built.toFixed(1)} ms, route ${took.toFixed(1)} ms`);
  assert.ok(took < 200, `route took ${took.toFixed(1)} ms`);
});

// ---- reported road problems (avoid) ----
import { type Obstacle } from '../../services/roadStatus';

const DIRECT_END = { lat: LAT0, lon: LON0 + 0.01 };
/** Direct road (about 980 m) plus a detour whose far side sits `dy` degrees north. */
const twoWays = (dy: number) =>
  area([
    { c: 3, p: [[LAT0, LON0], [LAT0, LON0 + 0.01]] },
    { c: 3, p: [[LAT0, LON0], [LAT0 + dy, LON0], [LAT0 + dy, LON0 + 0.01], [LAT0, LON0 + 0.01]] },
  ]);
const obstacle = (status: Obstacle['status'], level: 'low' | 'medium' | 'high', over: Partial<Obstacle> = {}): Obstacle => ({
  lat: LAT0,
  lon: LON0 + 0.005,
  status,
  weight: level === 'high' ? 1 : level === 'medium' ? 0.7 : 0.4,
  id: 'ob000001',
  attesters: level === 'high' ? 2 : level === 'medium' ? 1 : 0,
  level,
  ...over,
});
const START = { lat: LAT0, lon: LON0 };

test('avoid: a high-trust blocked road is skipped, the detour is longer in real metres', () => {
  const a = twoWays(0.002);
  const plain = routeTo(a, START, DIRECT_END, 'walk')!;
  const r = routeTo(a, START, DIRECT_END, 'walk', { obstacles: [obstacle('blocked', 'high')] })!;
  assert.ok(r);
  assert.ok(r.distanceM > plain.distanceM + 300, `detour ${r.distanceM} vs ${plain.distanceM}`);
  assert.ok(r.points.some((p) => p.lat > LAT0 + 0.0015), 'went round the north side');
  assert.equal(r.avoided, 1);
  assert.deepEqual(r.blockedAhead, []);
  assert.equal(r.unsafe, false);
  // distance is real metres: start->corner->corner->end
  assert.ok(Math.abs(r.distanceM - (2 * m(START, { lat: LAT0 + 0.002, lon: LON0 }) + m(START, DIRECT_END))) < 3);
});

test('avoid: without the option nothing changes', () => {
  const a = twoWays(0.002);
  const r = routeTo(a, START, DIRECT_END, 'walk')!;
  assert.equal(r.avoided, 0);
  assert.deepEqual(r.blockedAhead, []);
  assert.equal(r.unsafe, false);
});

test('avoid: a small penalty keeps the direct road when the detour is much longer, and warns', () => {
  const a = twoWays(0.002); // detour is about 450 m longer; damaged costs 3 min = 240 m
  const r = routeTo(a, START, DIRECT_END, 'walk', { obstacles: [obstacle('damaged', 'high')] })!;
  assert.ok(Math.abs(r.distanceM - m(START, DIRECT_END)) < 2, 'still direct');
  assert.equal(r.blockedAhead.length, 1);
  assert.equal(r.avoided, 0);
  assert.equal(r.unsafe, false);
  assert.ok(r.costM > r.distanceM + 200, 'penalty is in the cost, not the reported distance');
});

test('avoid: impassable vs penalty for a flood (drive blocked, walk pays 8 minutes)', () => {
  const a = twoWays(0.004); // detour about 1.8 km: longer than direct plus 8 walking minutes (640 m)
  const o = { obstacles: [obstacle('flooded', 'high')] };
  const walk = routeTo(a, START, DIRECT_END, 'walk', o)!;
  const drive = routeTo(a, START, DIRECT_END, 'drive', o)!;
  assert.ok(Math.abs(walk.distanceM - m(START, DIRECT_END)) < 2, 'walkers wade through');
  assert.equal(walk.blockedAhead.length, 1);
  assert.ok(drive.distanceM > 1500, 'drivers detour');
  assert.deepEqual(drive.blockedAhead, []);
});

test('avoid: a single low-trust blocked report only penalises, even with no alternative road', () => {
  const only = area([{ c: 3, p: [[LAT0, LON0], [LAT0, LON0 + 0.01]] }]);
  const r = routeTo(only, START, DIRECT_END, 'walk', { obstacles: [obstacle('blocked', 'low')] })!;
  assert.ok(r);
  assert.equal(r.unsafe, false);
  assert.equal(r.blockedAhead.length, 1);
  // with a free detour a low-trust block is still avoided when it is cheap to do so
  const a = twoWays(0.0005); // detour only 110 m longer
  const r2 = routeTo(a, START, DIRECT_END, 'walk', { obstacles: [obstacle('blocked', 'low')] })!;
  assert.ok(r2.distanceM > m(START, DIRECT_END) + 100);
});

test('avoid: unsafe flag when the only road is impassable, route still returned', () => {
  const only = area([{ c: 3, p: [[LAT0, LON0], [LAT0, LON0 + 0.01]] }]);
  const r = routeTo(only, START, DIRECT_END, 'walk', { obstacles: [obstacle('blocked', 'high')] })!;
  assert.ok(r, 'a route is still returned');
  assert.equal(r.unsafe, true);
  assert.equal(r.blockedAhead.length, 1);
  assert.ok(Math.abs(r.distanceM - m(START, DIRECT_END)) < 2);
});

test('avoid: an old high-trust block (faded weight) no longer excludes the road', () => {
  const only = area([{ c: 3, p: [[LAT0, LON0], [LAT0, LON0 + 0.01]] }]);
  const r = routeTo(only, START, DIRECT_END, 'walk', { obstacles: [obstacle('blocked', 'high', { weight: 0.25 })] })!;
  assert.equal(r.unsafe, false);
});

test('avoid: an obstacle more than 35 m from every road does nothing', () => {
  const a = twoWays(0.002);
  const r = routeTo(a, START, DIRECT_END, 'walk', { obstacles: [obstacle('blocked', 'high', { lat: LAT0 + 0.0008 })] })!; // about 90 m off
  assert.equal(r.avoided, 0);
  assert.deepEqual(r.blockedAhead, []);
  assert.ok(Math.abs(r.distanceM - m(START, DIRECT_END)) < 2);
});

test('avoid: routesTo ranks by the avoid-aware cost', () => {
  const a = area([
    { c: 3, p: [[LAT0, LON0], [LAT0, LON0 + 0.01]] }, // north-south-free main road with a blocked middle
    { c: 3, p: [[LAT0, LON0], [LAT0 - 0.003, LON0], [LAT0 - 0.003, LON0 + 0.004]] }, // longer way to a second place
    { c: 3, p: [[LAT0, LON0 + 0.01], [LAT0 + 0.006, LON0 + 0.01]] },
  ]);
  const near = { name: 'near', lat: LAT0, lon: LON0 + 0.01 }; // 980 m, but the only way is blocked
  const other = { name: 'other', lat: LAT0 - 0.003, lon: LON0 + 0.004 }; // about 330 + 440 m
  const plain = routesTo(a, START, [near, other], 'walk', 8);
  assert.equal(plain[0].place.name, 'other', 'other is shorter anyway');
  const near2 = { name: 'near2', lat: LAT0, lon: LON0 + 0.0035 };
  const out = routesTo(a, START, [near2, other], 'walk', 8, { obstacles: [obstacle('blocked', 'high', { lon: LON0 + 0.002 })] });
  assert.equal(out[0].place.name, 'other');
  assert.equal(out[1].place.name, 'near2');
  assert.equal(out[1].road?.unsafe, true);
});

test('avoid: 30 obstacles on a 20k-edge graph route quickly', () => {
  const big = grid(100, 0.0005);
  const obstacles: Obstacle[] = [];
  for (let k = 0; k < 30; k++) {
    const i = 3 + k * 3;
    obstacles.push(obstacle(k % 2 ? 'blocked' : 'flooded', k % 3 ? 'high' : 'medium', { id: `ob${k}`, lat: LAT0 + i * 0.0005 + 0.00025, lon: LON0 + (i % 97) * 0.0005 }));
  }
  const from = START;
  const to = { lat: LAT0 + 99 * 0.0005, lon: LON0 + 99 * 0.0005 };
  buildGraph(big);
  const t0 = performance.now();
  const r = routeTo(big, from, to, 'walk', { obstacles });
  const took = performance.now() - t0;
  console.log(`avoid route (incl. grid build) ${took.toFixed(1)} ms`);
  assert.ok(r, 'route found');
  assert.ok(took < 250, `took ${took.toFixed(1)} ms`);
});
