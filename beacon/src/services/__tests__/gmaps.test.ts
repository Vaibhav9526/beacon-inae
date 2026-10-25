import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directionsUrl, geoIntent, placeUrl, searchUrl } from '../gmaps';

test('directionsUrl builds exact destination URL with default walking mode', () => {
  assert.equal(directionsUrl({ lat: 28.6139, lon: 77.209 }), 'https://www.google.com/maps/dir/?api=1&destination=28.6139,77.209&travelmode=walking');
});

test('directionsUrl honours explicit mode', () => {
  assert.equal(directionsUrl({ lat: 1, lon: 2, mode: 'driving' }), 'https://www.google.com/maps/dir/?api=1&destination=1,2&travelmode=driving');
  assert.equal(directionsUrl({ lat: 1, lon: 2, mode: 'transit' }), 'https://www.google.com/maps/dir/?api=1&destination=1,2&travelmode=transit');
});

test('directionsUrl adds origin only when both origin coords are given', () => {
  assert.equal(
    directionsUrl({ lat: 1, lon: 2, originLat: 3, originLon: 4 }),
    'https://www.google.com/maps/dir/?api=1&destination=1,2&travelmode=walking&origin=3,4',
  );
  assert.equal(directionsUrl({ lat: 1, lon: 2, originLat: 3 }), 'https://www.google.com/maps/dir/?api=1&destination=1,2&travelmode=walking');
});

test('searchUrl encodes English query', () => {
  assert.equal(searchUrl('hospital'), 'https://www.google.com/maps/search/?api=1&query=hospital');
});

test('searchUrl encodes Hindi query and near point', () => {
  assert.equal(
    searchUrl('अस्पताल', { lat: 28.5, lon: 77.1 }),
    'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('अस्पताल 28.5,77.1'),
  );
  assert.ok(!searchUrl('अस्पताल').includes('अस्पताल'));
});

test('searchUrl encodes spaces and reserved characters', () => {
  assert.equal(searchUrl('police & station'), 'https://www.google.com/maps/search/?api=1&query=police%20%26%20station');
});

test('placeUrl uses coordinate query', () => {
  assert.equal(placeUrl(12.5, -3.25), 'https://www.google.com/maps/search/?api=1&query=12.5,-3.25');
  assert.equal(placeUrl(12.5, -3.25, 'Shelter'), 'https://www.google.com/maps/search/?api=1&query=12.5,-3.25');
});

test('geoIntent without label and with English label', () => {
  assert.equal(geoIntent(1, 2), 'geo:1,2?q=1,2');
  assert.equal(geoIntent(1, 2, 'Water'), 'geo:1,2?q=1,2(Water)');
});

test('geoIntent encodes Hindi label', () => {
  assert.equal(geoIntent(1, 2, 'पानी'), 'geo:1,2?q=1,2(' + encodeURIComponent('पानी') + ')');
});
