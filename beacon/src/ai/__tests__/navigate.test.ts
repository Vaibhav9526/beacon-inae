import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getDisaster, getGuide } from '../../kb';
import { parseNavigation } from '../navigate';

const routeOf = (text: string) => parseNavigation(text)?.route ?? null;

test('english screens, with filler and casing', () => {
  assert.deepEqual(parseNavigation('open map'), { route: '/map', label: 'Opening map' });
  assert.equal(routeOf('Open Settings'), '/settings');
  assert.equal(routeOf('please open the map.'), '/map');
  assert.equal(routeOf('show me the map'), '/map');
  assert.equal(routeOf('take me to settings'), '/settings');
  assert.equal(routeOf('go to the hub'), '/hub');
  assert.equal(routeOf('open go bag'), '/gobag');
  assert.equal(routeOf('Open Go-Bag!'), '/gobag');
  assert.equal(routeOf('start drill'), '/drills');
  assert.equal(routeOf('medical id'), '/medical');
  assert.equal(routeOf('report something'), '/report/new');
});

test('hindi and hinglish', () => {
  assert.equal(routeOf('nakshe kholo'), '/map');
  assert.equal(routeOf('नक्शा खोलो'), '/map');
  assert.equal(routeOf('सेटिंग खोलो'), '/settings');
  assert.equal(routeOf('मेडिकल आईडी दिखाओ'), '/medical');
  assert.equal(routeOf('परिवार खोलो'), '/family');
  assert.equal(routeOf('भूकंप गाइड दिखाओ'), '/disaster/earthquake');
});

test('first-aid and disaster guides use real ids', () => {
  assert.equal(routeOf('show earthquake guide'), '/disaster/earthquake');
  assert.equal(routeOf('bleeding'), '/guide/severe-bleeding');
  assert.equal(routeOf('open cpr guide'), '/guide/cpr-adult');
  assert.equal(routeOf('snake bite'), '/guide/snake-bite');
  for (const r of ['/disaster/flood', '/disaster/cyclone', '/disaster/heatwave', '/disaster/tsunami']) {
    assert.ok(getDisaster(r.split('/')[2]), `missing ${r}`);
  }
  for (const route of ['severe-bleeding', 'cpr-adult', 'burns', 'snake-bite', 'choking-adult', 'smoke-fire'].map((id) => `/guide/${id}`)) {
    assert.ok(getGuide(route.split('/')[2]), `missing ${route}`);
  }
});

test('every target route is a real screen or known id', () => {
  const screens = ['/map', '/settings', '/gobag', '/drills', '/medical', '/family', '/hub', '/report/new', '/adult/aid'];
  for (const phrase of ['map', 'settings', 'go bag', 'drill', 'medical', 'family', 'hub', 'report', 'first aid']) {
    assert.ok(screens.includes(routeOf(phrase) ?? ''), `${phrase} -> ${routeOf(phrase)}`);
  }
});

test('non-navigation phrases return null, so the caller falls back', () => {
  assert.equal(parseNavigation('call 112'), null);
  assert.equal(parseNavigation('I am safe'), null);
  assert.equal(parseNavigation('I am in danger, send help'), null);
  assert.equal(parseNavigation('he is bleeding badly from his leg and I do not know what to do'), null);
  assert.equal(parseNavigation('what is the weather tomorrow'), null);
  assert.equal(parseNavigation('open'), null);
  assert.equal(parseNavigation('please'), null);
  assert.equal(parseNavigation(''), null);
  assert.equal(parseNavigation('   '), null);
});
