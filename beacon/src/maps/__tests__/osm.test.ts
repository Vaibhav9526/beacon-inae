import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_MINOR_ROADS, bearingDeg, compassWord, formatDistance, nearest, needsRefresh, overpassQuery, parseOverpass, project, sharedVertices, simplify, vertexKey } from '../osm';

const C = { lat: 28.6139, lon: 77.209 };

const sample = {
  elements: [
    { type: 'way', id: 1, tags: { highway: 'primary' }, geometry: [{ lat: 28.61, lon: 77.2 }, { lat: 28.6101, lon: 77.2001 }, { lat: 28.62, lon: 77.21 }] },
    { type: 'way', id: 2, tags: { highway: 'footway' }, geometry: [{ lat: 28.61, lon: 77.2 }, { lat: 28.611, lon: 77.201 }] },
    { type: 'way', id: 3, tags: { waterway: 'stream' }, geometry: [{ lat: 28.6, lon: 77.2 }, { lat: 28.601, lon: 77.202 }] },
    { type: 'node', id: 4, lat: 28.615, lon: 77.21, tags: { amenity: 'hospital', name: 'City Hospital' } },
    { type: 'node', id: 5, lat: 28.6139, lon: 77.2191, tags: { amenity: 'drinking_water' } },
    { type: 'way', id: 6, tags: { amenity: 'school', name: 'Govt School' }, geometry: [{ lat: 28.62, lon: 77.2 }, { lat: 28.6202, lon: 77.2 }, { lat: 28.6202, lon: 77.2002 }] },
    { type: 'node', id: 7, lat: 28.6, lon: 77.2, tags: { emergency: 'assembly_point' } },
    { type: 'node', id: 8, lat: 28.615, lon: 77.21, tags: { amenity: 'hospital', name: 'City Hospital' } },
  ],
};

test('query covers roads, walking connectivity, water and emergency places in the bbox', () => {
  const q = overpassQuery(C.lat, C.lon, 3);
  assert.match(q, /\[out:json\]/);
  assert.match(q, /hospital/);
  assert.match(q, /drinking_water/);
  assert.match(q, /out geom/);
  assert.match(q, /footway/);
  assert.match(q, /service/);
});

test('parse keeps roads, footpaths (walking only), water and places; drops duplicates', () => {
  const a = parseOverpass(sample as never, C, 3, 123);
  assert.equal(a.v, 2);
  assert.equal(a.roads.length, 2, 'primary and footway');
  assert.equal(a.roads[0].c, 1);
  assert.equal(a.roads[0].f, undefined);
  assert.equal(a.roads[1].c, 3);
  assert.equal(a.roads[1].f, 1, 'footway flagged walking only');
  assert.equal(a.water.length, 1);
  const kinds = a.places.map((p) => p.kind).sort();
  assert.deepEqual(kinds, ['hospital', 'school', 'shelter', 'water'], 'duplicate hospital collapsed');
  assert.equal(a.places.find((p) => p.kind === 'shelter')!.name, 'Assembly point');
  assert.equal(a.places.find((p) => p.kind === 'water')!.name, 'Drinking water');
  assert.equal(a.places.find((p) => p.kind === 'school')!.name, 'Govt School');
  assert.equal(a.savedAt, 123);
});

test('nearest sorts by distance and reports bearing', () => {
  const a = parseOverpass(sample as never, C, 3);
  const n = nearest(a, C, ['hospital', 'water', 'shelter']);
  assert.equal(n[0].kind, 'hospital');
  assert.ok(n[0].distanceM > 100 && n[0].distanceM < 300);
  assert.ok(n[0].bearing > 30 && n[0].bearing < 55, `hospital is north-east, got ${n[0].bearing}`);
  assert.equal(compassWord(n[0].bearing), 'NE');
  assert.equal(nearest(a, C, 'police').length, 0);
});

test('bearing, compass and distance formatting', () => {
  assert.equal(Math.round(bearingDeg({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })), 0);
  assert.equal(Math.round(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })), 90);
  assert.equal(Math.round(bearingDeg({ lat: 0, lon: 0 }, { lat: -1, lon: 0 })), 180);
  assert.equal(Math.round(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: -1 })), 270);
  assert.equal(compassWord(92), 'E');
  assert.equal(compassWord(359), 'N');
  assert.equal(formatDistance(430), '430 m');
  assert.equal(formatDistance(1530), '1.5 km');
});

test('simplify keeps a shared junction vertex that would otherwise be dropped', () => {
  // the middle vertex is about 3 m from the first one, so the plain simplifier drops it
  const way = [{ lat: 28.6, lon: 77.2 }, { lat: 28.60003, lon: 77.2 }, { lat: 28.6005, lon: 77.2 }];
  assert.equal(simplify(way).length, 4, 'dropped without junction data');
  const shared = new Set([vertexKey(28.60003, 77.2)]);
  assert.equal(simplify(way, 6, shared).length, 6, 'kept as a junction');
  assert.equal(sharedVertices([way, [{ lat: 28.60003, lon: 77.2 }, { lat: 28.6, lon: 77.21 }]]).size, 1);
});

test('parse keeps the junction where a road and a footpath meet', () => {
  const j = { lat: 28.60003, lon: 77.2 };
  const json = {
    elements: [
      { type: 'way', id: 1, tags: { highway: 'primary' }, geometry: [{ lat: 28.6, lon: 77.2 }, j, { lat: 28.6005, lon: 77.2 }] },
      { type: 'way', id: 2, tags: { highway: 'footway' }, geometry: [j, { lat: 28.6, lon: 77.21 }] },
    ],
  };
  const a = parseOverpass(json as never, C, 3, 1);
  const p = a.roads[0].p;
  assert.equal(p.length, 6, 'junction vertex kept on the primary road');
  assert.ok(p.some((v, i) => i % 2 === 0 && Math.abs(v - j.lat) < 1e-9));
});

test('minor ways are capped at MAX_MINOR_ROADS, class 0-2 always kept', () => {
  const elements: never[] = [];
  elements.push({ type: 'way', id: 0, tags: { highway: 'primary' }, geometry: [{ lat: C.lat, lon: C.lon }, { lat: C.lat + 0.001, lon: C.lon }] } as never);
  for (let k = 0; k < MAX_MINOR_ROADS + 100; k++) {
    const y = C.lat + k * 0.0001;
    elements.push({ type: 'way', id: k + 1, tags: { highway: 'footway' }, geometry: [{ lat: y, lon: C.lon + 0.01 }, { lat: y + 0.00005, lon: C.lon + 0.01 }] } as never);
  }
  const a = parseOverpass({ elements } as never, C, 3);
  assert.equal(a.roads.length, MAX_MINOR_ROADS + 1);
  assert.equal(a.roads[0].c, 1);
});

test('areas saved before v 2 are flagged for refresh', () => {
  const old = { ...parseOverpass(sample as never, C, 3), v: 1 as const };
  assert.equal(needsRefresh(old), true);
  assert.equal(needsRefresh(parseOverpass(sample as never, C, 3)), false);
});

test('projection puts the centre in the middle and north up, east right', () => {
  const mid = project(C, C, 100, 400);
  assert.deepEqual(mid, { x: 200, y: 200 });
  const north = project({ lat: C.lat + 0.01, lon: C.lon }, C, 100, 400);
  assert.ok(north.y < 200 && Math.abs(north.x - 200) < 1e-6);
  const east = project({ lat: C.lat, lon: C.lon + 0.01 }, C, 100, 400);
  assert.ok(east.x > 200 && Math.abs(east.y - 200) < 1e-6);
});
