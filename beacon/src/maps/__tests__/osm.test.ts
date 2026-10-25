import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bearingDeg, compassWord, formatDistance, nearest, overpassQuery, parseOverpass, project } from '../osm';

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

test('query covers roads, water and emergency places in the bbox', () => {
  const q = overpassQuery(C.lat, C.lon, 3);
  assert.match(q, /\[out:json\]/);
  assert.match(q, /hospital/);
  assert.match(q, /drinking_water/);
  assert.match(q, /out geom/);
});

test('parse keeps drivable roads, water and places; drops footpaths and duplicates', () => {
  const a = parseOverpass(sample as never, C, 3, 123);
  assert.equal(a.roads.length, 1, 'footway excluded');
  assert.equal(a.roads[0].c, 1);
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

test('projection puts the centre in the middle and north up, east right', () => {
  const mid = project(C, C, 100, 400);
  assert.deepEqual(mid, { x: 200, y: 200 });
  const north = project({ lat: C.lat + 0.01, lon: C.lon }, C, 100, 400);
  assert.ok(north.y < 200 && Math.abs(north.x - 200) < 1e-6);
  const east = project({ lat: C.lat, lon: C.lon + 0.01 }, C, 100, 400);
  assert.ok(east.x > 200 && Math.abs(east.y - 200) < 1e-6);
});
