import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchMetrics, getAlerts, getAqi, getQuakes, getWeather, heatIndexC,
} from './sources.ts';
import type { Metrics, Place, SourceOptions } from './types.ts';

const PLACE: Place = { name: 'Delhi', lat: 28.6139, lon: 77.209, state: 'delhi' };

const WEATHER_JSON = {
  current: {
    temperature_2m: 35, relative_humidity_2m: 60, apparent_temperature: 41,
    wind_speed_10m: 14, wind_gusts_10m: 22, precipitation: 0.2, uv_index: 9,
  },
  daily: { precipitation_sum: [3.1, 1.4] },
};
const AQI_JSON = { current: { us_aqi: 162, pm2_5: 71 } };
const QUAKE_JSON = {
  features: [
    { properties: { mag: 5.0 }, geometry: { coordinates: [77.25, 28.7, 10] } }, // Delhi, ~10 km
    { properties: { mag: 6.5 }, geometry: { coordinates: [139.7, 35.7, 30] } }, // Tokyo, far
  ],
};
const ALERT_JSON = [
  { area: 'Delhi NCR', severity: 'Moderate', headline: 'Heavy rain' },
  { area: 'Kerala', severity: 'Severe', headline: 'Flood' },
  { area: 'Delhi', severity: 'Minor', headline: 'Wind' },
];

type Route = { match: string; body: unknown; fail?: boolean };

function fakeFetch(routes: Route[], calls: string[] = []): NonNullable<SourceOptions['fetch']> {
  return async (url: string) => {
    calls.push(url);
    const route = routes.find((r) => url.startsWith(r.match));
    if (!route) return { ok: false, json: async () => null, text: async () => '' };
    if (route.fail) throw new Error('network down');
    return { ok: true, json: async () => route.body, text: async () => JSON.stringify(route.body) };
  };
}

const ALL_ROUTES: Route[] = [
  { match: 'https://api.open-meteo.com', body: WEATHER_JSON },
  { match: 'https://air-quality-api.open-meteo.com', body: AQI_JSON },
  { match: 'https://earthquake.usgs.gov', body: QUAKE_JSON },
  { match: 'https://sachet.ndma.gov.in', body: ALERT_JSON },
];

function assertFiniteKeys(m: Metrics, keys: string[]) {
  for (const k of keys) {
    assert.equal(typeof m[k], 'number', `missing numeric key ${k}`);
    assert.ok(Number.isFinite(m[k]), `non-finite ${k}`);
  }
}

test('heatIndexC: Rothfusz regression and the below-80F shortcut', () => {
  const hi = heatIndexC(35, 60);
  assert.ok(hi > 44 && hi < 46, `expected about 45 C, got ${hi}`);
  assert.equal(heatIndexC(20, 50), 20, 'below 80 F returns air temperature');
  assert.ok(heatIndexC(40, 80) > 40);
});

test('getWeather maps Open-Meteo current and daily values', async () => {
  const calls: string[] = [];
  const m = await getWeather(PLACE, { fetch: fakeFetch(ALL_ROUTES, calls) });
  assert.equal(m.temp_c, 35);
  assert.equal(m.feels_like_c, 41);
  assert.equal(m.humidity_pct, 60);
  assert.equal(m.wind_kmh, 14);
  assert.equal(m.wind_gust_kmh, 22);
  assert.equal(m.rain_mm_now, 0.2);
  assert.equal(m.rain_mm_24h, 1.4);
  assert.equal(m.uv_index, 9);
  assert.ok(m.heat_index_c > 44 && m.heat_index_c < 46);
  assert.match(calls[0], /latitude=28\.6139&longitude=77\.209/);
  assert.match(calls[0], /past_days=1/);
});

test('getAqi maps us_aqi and pm2_5', async () => {
  const m = await getAqi(PLACE, { fetch: fakeFetch(ALL_ROUTES) });
  assert.deepEqual(m, { aqi: 162, pm25: 71 });
});

test('getQuakes counts only quakes within 500 km for max and count, nearest over all', async () => {
  const m = await getQuakes(PLACE, { fetch: fakeFetch(ALL_ROUTES) });
  assert.equal(m.quake_max_mag, 5.0, 'Tokyo M6.5 must be excluded');
  assert.equal(m.quake_count, 1);
  assert.ok(m.quake_nearest_km < 20, `nearest should be Delhi quake, got ${m.quake_nearest_km}`);
});

test('getQuakes with an empty feed gives 0 / 9999 / 0', async () => {
  const m = await getQuakes(PLACE, {
    fetch: fakeFetch([{ match: 'https://earthquake.usgs.gov', body: { features: [] } }]),
  });
  assert.deepEqual(m, { quake_max_mag: 0, quake_nearest_km: 9999, quake_count: 0 });
});

test('getAlerts filters by state and maps severity words', async () => {
  const m = await getAlerts(PLACE, { fetch: fakeFetch(ALL_ROUTES) });
  assert.equal(m.official_alert_count, 2, 'Kerala alert excluded');
  assert.equal(m.official_alert_max, 2, 'Moderate is 2, Minor is 1');
});

test('getAlerts accepts an object wrapping the array', async () => {
  const m = await getAlerts(PLACE, {
    fetch: fakeFetch([{ match: 'https://sachet.ndma.gov.in', body: { alerts: [{ area: 'Delhi', severity: 'Extreme' }] } }]),
  });
  assert.deepEqual(m, { official_alert_count: 1, official_alert_max: 3 });
});

test('getAlerts with an unexpected shape gives zeros', async () => {
  const m = await getAlerts(PLACE, {
    fetch: fakeFetch([{ match: 'https://sachet.ndma.gov.in', body: '<html>' }]),
  });
  assert.deepEqual(m, { official_alert_count: 0, official_alert_max: 0 });
});

test('fetchMetrics merges all requested kinds and ignores others', async () => {
  const m = await fetchMetrics(['weather', 'aqi', 'quake', 'alerts', 'health'], undefined, {
    fetch: fakeFetch(ALL_ROUTES),
  });
  assert.equal(m.temp_c, 35);
  assert.equal(m.aqi, 162);
  assert.equal(m.quake_max_mag, 5.0);
  assert.equal(m.official_alert_count, 2);
});

test('fetchMetrics with no kinds returns an empty object without fetching', async () => {
  const calls: string[] = [];
  const m = await fetchMetrics([], PLACE, { fetch: fakeFetch(ALL_ROUTES, calls) });
  assert.deepEqual(m, {});
  assert.equal(calls.length, 0);
});

test('offline mode makes no requests and returns sample-backed values for every key', async () => {
  const calls: string[] = [];
  const opts: SourceOptions = { offline: true, fetch: fakeFetch(ALL_ROUTES, calls) };
  const m = await fetchMetrics(['weather', 'aqi', 'quake', 'alerts'], PLACE, opts);
  assert.equal(calls.length, 0);
  assertFiniteKeys(m, [
    'temp_c', 'feels_like_c', 'humidity_pct', 'heat_index_c', 'wind_kmh', 'wind_gust_kmh',
    'rain_mm_24h', 'rain_mm_now', 'uv_index', 'aqi', 'pm25',
    'quake_max_mag', 'quake_nearest_km', 'quake_count',
    'official_alert_count', 'official_alert_max',
  ]);
});

test('a failing fetch never throws: sample values for weather/aqi/quake, zero alerts', async () => {
  const failing = fakeFetch([
    { match: 'https://api.open-meteo.com', body: null, fail: true },
    { match: 'https://air-quality-api.open-meteo.com', body: null, fail: true },
    { match: 'https://earthquake.usgs.gov', body: null, fail: true },
    { match: 'https://sachet.ndma.gov.in', body: null, fail: true },
  ]);
  const m = await fetchMetrics(['weather', 'aqi', 'quake', 'alerts'], PLACE, { fetch: failing });
  assertFiniteKeys(m, ['temp_c', 'aqi', 'pm25', 'quake_nearest_km']);
  assert.equal(m.official_alert_count, 0);
  assert.equal(m.official_alert_max, 0);
});

test('a non-ok HTTP response also falls back without throwing', async () => {
  const m = await getAqi(PLACE, { fetch: fakeFetch([]) });
  assertFiniteKeys(m, ['aqi', 'pm25']);
});

test('one failing source keeps the real results of the others', async () => {
  const m = await fetchMetrics(['weather', 'aqi'], PLACE, {
    fetch: fakeFetch([
      { match: 'https://api.open-meteo.com', body: null, fail: true },
      { match: 'https://air-quality-api.open-meteo.com', body: AQI_JSON },
    ]),
  });
  assert.equal(m.aqi, 162, 'real AQI kept');
  assert.equal(m.pm25, 71, 'real PM2.5 kept');
  assertFiniteKeys(m, ['temp_c']);
});

test('partial weather payload keeps real fields and fills the rest from sample', async () => {
  const m = await getWeather(PLACE, {
    fetch: fakeFetch([{ match: 'https://api.open-meteo.com', body: { current: { temperature_2m: 30 } } }]),
  });
  assert.equal(m.temp_c, 30);
  assertFiniteKeys(m, ['humidity_pct', 'wind_kmh', 'uv_index']);
});

test('no place uses Delhi coordinates', async () => {
  const calls: string[] = [];
  await getQuakes(undefined, { fetch: fakeFetch(ALL_ROUTES, calls) });
  await getWeather(undefined, { fetch: fakeFetch(ALL_ROUTES, calls) });
  assert.ok(calls.some((u) => u.includes('latitude=28.6139&longitude=77.209')));
});
