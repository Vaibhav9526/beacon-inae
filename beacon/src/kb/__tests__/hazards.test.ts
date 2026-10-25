import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DISCLAIMER, hazardCalendar, hazardProfile } from '../hazards';

const find = (place: Parameters<typeof hazardProfile>[0], id: 'seismic' | 'flood' | 'cyclone') =>
  hazardProfile(place).find((h) => h.id === id);

test('Delhi is seismic zone IV and Guwahati is zone V', () => {
  const delhi = find({ city: 'Delhi' }, 'seismic');
  assert.equal(delhi?.zone, 4);
  assert.equal(delhi?.level, 3);
  assert.match(delhi?.why ?? '', /Zone IV/);

  const guwahati = find({ city: 'Guwahati', state: 'Assam' }, 'seismic');
  assert.equal(guwahati?.zone, 5);
  assert.equal(guwahati?.level, 3);
  assert.match(guwahati?.why ?? '', /Zone V/);
});

test('unknown place falls back to the nearest city by lat/lon', () => {
  const delhi = hazardProfile({ lat: 28.6139, lon: 77.209 });
  assert.equal(delhi.find((h) => h.id === 'seismic')?.zone, 4);
  assert.equal(delhi.find((h) => h.id === 'flood')?.level, 2);

  const guwahati = hazardProfile({ lat: 26.1445, lon: 91.7362 });
  assert.equal(guwahati.find((h) => h.id === 'seismic')?.zone, 5);
  assert.equal(guwahati.find((h) => h.id === 'flood')?.level, 3);
});

test('profile is ranked by level and has plain-language why lines', () => {
  const profile = hazardProfile({ state: 'Odisha' });
  assert.ok(profile.length > 0);
  for (let i = 1; i < profile.length; i++) assert.ok(profile[i - 1].level >= profile[i].level);
  for (const h of profile) {
    assert.ok(h.level >= 0 && h.level <= 3, `${h.id} level out of range`);
    assert.ok(h.why.trim().length > 10, `${h.id} needs a why line`);
  }
});

test('major city seismic zones match the BIS overrides', () => {
  const expected: [string, 2 | 3 | 4 | 5][] = [
    ['Mumbai', 3],
    ['Chennai', 3],
    ['Kolkata', 3],
    ['Bengaluru', 2],
    ['Hyderabad', 2],
    ['Kochi', 3],
  ];
  for (const [city, zone] of expected) {
    assert.equal(find({ city }, 'seismic')?.zone, zone, `${city} zone`);
  }
});

test('state-only and unknown-state places resolve sensibly', () => {
  assert.equal(find({ state: 'Assam' }, 'seismic')?.zone, 5);
  // An unrecognised state with coordinates falls back to the nearest city.
  assert.equal(find({ state: 'Atlantis', lat: 28.6139, lon: 77.209 }, 'seismic')?.zone, 4);
  assert.deepEqual(hazardProfile({}), []);
});

test('calendar tolerates out-of-range and non-finite months', () => {
  assert.deepEqual(hazardCalendar(-3), hazardCalendar(0));
  assert.deepEqual(hazardCalendar(20), hazardCalendar(11));
  assert.ok(Array.isArray(hazardCalendar(Number.NaN)));
});

test('July calendar includes floods, and winter includes cold waves', () => {
  assert.ok(hazardCalendar(6).includes('flood'));
  assert.ok(hazardCalendar(6).includes('landslide'));
  assert.ok(hazardCalendar(3).includes('cyclone'));
  assert.ok(hazardCalendar(11).includes('coldwave'));
  assert.equal(DISCLAIMER, 'Approximate, from public zoning maps. Check your local authority for exact risk.');
});
