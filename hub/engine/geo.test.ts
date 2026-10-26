import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILTIN_PLACES, fold, offlinePlaces, placeLabel, searchPlaces } from './geo.ts';
import type { FetchLike } from './geo.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake fetch that records the URLs it was asked for. The reply can depend on the URL. */
function fake(reply: (url: string) => Promise<Response> | Response, calls: string[] = []): FetchLike {
  return async (url) => {
    calls.push(url);
    return reply(url);
  };
}

const isOwm = (u: string) => u.startsWith('https://api.openweathermap.org/geo/1.0/direct');
const isOm = (u: string) => u.startsWith('https://geocoding-api.open-meteo.com/v1/search');

const QUICK = ['Raipur', 'Delhi', 'Mumbai', 'Kolkata', 'Chennai', 'Bengaluru', 'Hyderabad', 'Ahmedabad', 'Bhopal', 'Nagpur'];

test('an empty query returns nothing and never calls the network', async () => {
  const calls: string[] = [];
  const f = fake(() => json({ results: [] }), calls);
  assert.deepEqual(await searchPlaces('', f), []);
  assert.deepEqual(await searchPlaces('   ', f), []);
  assert.equal(calls.length, 0);
});

test('one character answers from the built-in list and does not call the network', async () => {
  const calls: string[] = [];
  const f = fake(() => json({ results: [] }), calls);
  const out = await searchPlaces(' r ', f);
  assert.equal(calls.length, 0);
  assert.ok(out.length > 0 && out.length <= 8);
  assert.equal(out[0].name, 'Raipur');
});

test('online search sends an encoded Open-Meteo request and maps the result with the country code', async () => {
  const calls: string[] = [];
  const f = fake((u) => isOm(u) ? json({
    results: [{ name: 'Raipur', admin1: 'Chhattisgarh', country: 'India', country_code: 'IN', latitude: 21.25, longitude: 81.63 }],
  }) : json([]), calls);
  const out = await searchPlaces('  New Delhi & co  ', f);
  const om = calls.find(isOm);
  assert.ok(om, 'Open-Meteo was called');
  const u = new URL(om);
  assert.equal(u.searchParams.get('name'), 'New Delhi & co');
  assert.equal(u.searchParams.get('count'), '8');
  assert.equal(u.searchParams.get('language'), 'en');
  assert.equal(u.searchParams.get('format'), 'json');
  assert.deepEqual(out, [{ name: 'Raipur', state: 'Chhattisgarh', country: 'IN', lat: 21.25, lon: 81.63, label: 'Raipur, Chhattisgarh, IN' }]);
});

test('no OpenWeather key means no OpenWeather call', async () => {
  const calls: string[] = [];
  await searchPlaces('Pune', fake(() => json([]), calls));
  assert.equal(calls.filter(isOwm).length, 0);
});

test('with a key, OpenWeather Geocoding is asked with q, limit and appid', async () => {
  const calls: string[] = [];
  await searchPlaces('Raipur', fake((u) => isOwm(u) ? json([]) : json({ results: [] }), calls), false, { owmKey: 'abc123' });
  const owm = calls.find(isOwm);
  assert.ok(owm);
  const u = new URL(owm);
  assert.equal(u.searchParams.get('q'), 'Raipur');
  assert.equal(u.searchParams.get('limit'), '8');
  assert.equal(u.searchParams.get('appid'), 'abc123');
});

test('OpenWeather and Open-Meteo results are merged, duplicates dropped, India first', async () => {
  const f = fake((u) => isOwm(u)
    ? json([
        { name: 'Paris', state: 'Texas', country: 'US', lat: 33.66, lon: -95.55 },
        { name: 'Raipur', state: 'Chhattisgarh', country: 'IN', lat: 21.2514, lon: 81.6296 },
      ])
    : json({
        results: [
          { name: 'Raipur', admin1: 'Chhattisgarh', country_code: 'IN', latitude: 21.25, longitude: 81.63 },
          { name: 'Paris', admin1: 'Ile-de-France', country_code: 'FR', latitude: 48.85, longitude: 2.35 },
          { name: 'Raipur', admin1: 'Odisha', country_code: 'IN', latitude: 20.5, longitude: 84.1 },
        ],
      }),
  );
  const out = await searchPlaces('Raipur', f, false, { owmKey: 'k' });
  // Raipur at 21.25/81.63 appears once (duplicate), Raipur in Odisha is a different place, and India comes first.
  assert.deepEqual(out.map((p) => p.label), [
    'Raipur, Chhattisgarh, IN',
    'Raipur, Odisha, IN',
    'Paris, Texas, US',
    'Paris, Ile-de-France, FR',
  ]);
});

test('the OpenWeather key is never in a returned label, even when a result tries to carry it', async () => {
  const key = 'SECRETKEY42';
  const f = fake((u) => isOwm(u)
    ? json([{ name: 'SECRETKEY42 Town', state: '', country: 'IN', lat: 20, lon: 80 }, { name: 'Bhopal', state: 'Madhya Pradesh', country: 'IN', lat: 23.26, lon: 77.41 }])
    : json({ results: [] }),
  );
  const out = await searchPlaces('bhop', f, false, { owmKey: key });
  assert.ok(out.length >= 1);
  for (const p of out) {
    assert.ok(!JSON.stringify(p).includes(key), 'the key leaked into a result');
  }
  assert.ok(!out.some((p) => p.name.includes('SECRET')));
});

test('a fetch that throws with the key in its message leaks nothing', async () => {
  const key = 'TOPSECRET99';
  const f: FetchLike = async (u) => {
    if (isOwm(u)) throw new Error('request to ' + u + ' failed');
    return json({ results: [{ name: 'Nagpur', admin1: 'Maharashtra', country_code: 'IN', latitude: 21.14, longitude: 79.08 }] });
  };
  const out = await searchPlaces('nagp', f, false, { owmKey: key });
  assert.equal(JSON.stringify(out).includes(key), false);
  assert.equal(out[0]?.name, 'Nagpur');
});

test('when OpenWeather fails, Open-Meteo results are used without any error', async () => {
  const f = fake((u) => isOwm(u) ? json({ cod: 401, message: 'Invalid API key' }, 401) : json({
    results: [{ name: 'Bhilai', admin1: 'Chhattisgarh', country_code: 'IN', latitude: 21.21, longitude: 81.38 }],
  }));
  const out = await searchPlaces('bhilai', f, false, { owmKey: 'bad' });
  assert.deepEqual(out.map((p) => p.name), ['Bhilai']);
});

test('when both network layers fail, the built-in list answers', async () => {
  const f = fake((u) => isOwm(u) ? json({}, 500) : new Response('<html>', { status: 200 }));
  const out = await searchPlaces('bhop', f, false, { owmKey: 'k' });
  assert.equal(out[0]?.name, 'Bhopal');
  assert.equal(out[0]?.label, 'Bhopal, Madhya Pradesh, IN');
});

test('a network error, an HTTP error or bad JSON falls back to the built-in list and never throws', async () => {
  const errors: FetchLike[] = [
    async () => { throw new Error('offline'); },
    fake(() => json({ error: true }, 500)),
    fake(() => new Response('<html>', { status: 200 })),
  ];
  for (const f of errors) {
    const out = await searchPlaces('bhop', f);
    assert.equal(out[0]?.name, 'Bhopal');
  }
});

test('an empty online answer falls back to the built-in list', async () => {
  const f = fake(() => json({ generationtime_ms: 0.2 }));
  const out = await searchPlaces('kolk', f);
  assert.equal(out[0].name, 'Kolkata');
  assert.equal(out[0].label, 'Kolkata, West Bengal, IN');
});

test('a layer that never answers gives up after the timeout and the other layer still answers', async () => {
  const f: FetchLike = (u) => isOwm(u)
    ? new Promise(() => {})
    : Promise.resolve(json({ results: [{ name: 'Nagpur', admin1: 'Maharashtra', country_code: 'IN', latitude: 21.14, longitude: 79.08 }] }));
  const started = Date.now();
  const out = await searchPlaces('nagp', f, false, { timeoutMs: 40, owmKey: 'k' });
  assert.ok(Date.now() - started < 2000);
  assert.equal(out[0]?.name, 'Nagpur');
});

test('a fetch that never answers gives up after the timeout and uses the built-in list', async () => {
  const hang: FetchLike = () => new Promise(() => {});
  const started = Date.now();
  const out = await searchPlaces('nagp', hang, false, { timeoutMs: 40 });
  assert.ok(Date.now() - started < 2000);
  assert.equal(out[0]?.name, 'Nagpur');
});

test('offline mode never calls the network', async () => {
  const calls: string[] = [];
  const f = fake(() => json({ results: [] }), calls);
  const out = await searchPlaces('chenn', f, true, { owmKey: 'k' });
  assert.equal(calls.length, 0);
  assert.equal(out[0].name, 'Chennai');
  assert.equal(out[0].label, 'Chennai, Tamil Nadu, IN');
});

test('offline search ranks names that start with the query first and returns at most 8', () => {
  const out = offlinePlaces('ra');
  assert.equal(out[0].name, 'Raipur');
  assert.ok(out.length <= 8);
  assert.ok(out.every((p) => p.name.toLowerCase().includes('ra') || p.state.toLowerCase().includes('ra')));
});

test('a state name lists its cities, ignoring case and accents', () => {
  const byState = offlinePlaces('Chhattisgarh').map((p) => p.name);
  assert.ok(byState.includes('Raipur') && byState.includes('Bhilai') && byState.includes('Durg'), byState.join(','));
  assert.ok(offlinePlaces('CHHATTISGARH').some((p) => p.name === 'Raipur'));
  assert.ok(offlinePlaces('Odísha').some((p) => p.name === 'Bhubaneswar'));
  assert.equal(fold('Odísha'), 'odisha');
});

test('a query with a comma searches by the city part only', () => {
  assert.equal(offlinePlaces('Raipur, Chh')[0]?.name, 'Raipur');
});

test('built-in list has at least 150 Indian places with valid coordinates and the ten quick choices', () => {
  assert.ok(BUILTIN_PLACES.length >= 150, `got ${BUILTIN_PLACES.length}`);
  for (const p of BUILTIN_PLACES) {
    assert.ok(p.lat >= 6 && p.lat <= 37 && p.lon >= 68 && p.lon <= 98, `${p.name} is outside India`);
    assert.ok(p.state.length > 0);
  }
  for (const q of QUICK) {
    assert.ok(BUILTIN_PLACES.some((p) => p.name === q), `missing quick choice ${q}`);
  }
});

test('Raipur, Bhilai, Durg, Bilaspur and Korba are in the built-in list', () => {
  for (const name of ['Raipur', 'Bhilai', 'Durg', 'Bilaspur', 'Korba']) {
    assert.ok(BUILTIN_PLACES.some((p) => p.name === name && p.state === 'Chhattisgarh'), name);
  }
});

test('labels leave the state out when it repeats the city name', () => {
  assert.equal(placeLabel('Chandigarh', 'Chandigarh', 'IN'), 'Chandigarh, IN');
  assert.equal(placeLabel('Raipur', 'Chhattisgarh', 'IN'), 'Raipur, Chhattisgarh, IN');
});

test('blank input gives empty results from the offline list too', () => {
  assert.deepEqual(offlinePlaces(''), []);
  assert.deepEqual(offlinePlaces('   '), []);
});
