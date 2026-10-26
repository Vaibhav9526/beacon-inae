import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HubApp } from './app.ts';
import { startHttp } from './httpServer.ts';
import { cleanPipeline, nodeKindInfo } from './nodeCatalog.ts';
import { runPipeline } from './nodes.ts';
import type { NodeContext } from './nodes.ts';
import * as owm from './owm.ts';
import { TEMPLATES, templateById } from './templates.ts';
import type { Agent, NodeSpec } from './types.ts';

const KEY = 'abcd1234secretkey5678';
const NOW = Date.UTC(2026, 9, 26, 6, 0, 0);

// Shapes follow the examples in the OpenWeather docs.
const CURRENT = {
  coord: { lon: 77.21, lat: 28.61 }, weather: [{ id: 804, main: 'Clouds', description: 'overcast clouds', icon: '04d' }], base: 'stations',
  main: { temp: 8.48, feels_like: 4.9, temp_min: 8.18, temp_max: 9.26, pressure: 1016, humidity: 79, sea_level: 1016, grnd_level: 1016 },
  visibility: 10000, wind: { speed: 7.3, deg: 189, gust: 13.48 }, rain: { '1h': 2.73 }, clouds: { all: 100 }, dt: 1647347424,
  sys: { country: 'IN', sunrise: 1647325488, sunset: 1647367827 }, timezone: 19800, id: 1273294, name: 'Delhi', cod: 200,
};
const slot = (i: number, over: Record<string, unknown> = {}) => ({
  dt: 1647347424 + i * 10800, main: { temp: 20 + i, feels_like: 21 + i, humidity: 50 }, weather: [{ id: 500, main: 'Rain', description: 'light rain' }],
  clouds: { all: 90 }, wind: { speed: 4, deg: 90, gust: 8 }, visibility: 10000, pop: 0.3, rain: { '3h': 1 }, sys: { pod: 'd' }, dt_txt: '2022-03-15 12:00:00', ...over,
});
const FORECAST = { cod: '200', message: 0, cnt: 16, list: Array.from({ length: 16 }, (_, i) => slot(i)), city: { id: 1, name: 'Delhi', timezone: 19800, sunrise: 1, sunset: 2 } };
const AIR = { coord: [28.61, 77.21], list: [{ dt: 1606147200, main: { aqi: 4 }, components: { co: 203.609, no: 0, no2: 0.396, o3: 75.102, so2: 0.648, pm2_5: 23.253, pm10: 92.214, nh3: 0.117 } }] };
const LONG = 'Severe heat wave conditions are likely. '.repeat(40);
const ONECALL = {
  lat: 28.61, lon: 77.21, timezone: 'Asia/Kolkata', timezone_offset: 19800, current: { dt: 1, uvi: 9.2, temp: 33 },
  hourly: Array.from({ length: 48 }, (_, i) => ({ dt: 1647347424 + i * 3600, temp: 30 + (i % 5), feels_like: 33 + (i % 5), pop: i === 5 ? 0.8 : 0.1, wind_speed: 5, wind_gust: i === 7 ? 20 : 8, uvi: i === 3 ? 10.4 : 2, ...(i === 5 ? { rain: { '1h': 4 } } : {}) })),
  alerts: [{ sender_name: 'India Meteorological Department', event: 'Heat wave', start: 1647350000, end: 1647400000, description: LONG, tags: ['Extreme temperature value'] }],
};

const agent = (over: Partial<Agent> = {}): Agent => ({
  id: 'ag1', name: 'Desk', avatar: 'scout', enabled: true, watch: [], everyMin: 15, rules: [], channels: ['beacon'], createdAt: 0,
  place: { name: 'Delhi', lat: 28.61, lon: 77.21, state: 'delhi' }, ...over,
});
const node = (kind: NodeSpec['kind'], config: Record<string, unknown> = {}, id = 'n1'): NodeSpec => ({ id, kind, label: id, config, enabled: true });

type Reply = { status?: number; body: unknown };
function fake(routes: Record<string, Reply>, calls: string[] = []): NonNullable<NodeContext['fetch']> {
  return (async (url: string) => {
    calls.push(url);
    const k = Object.keys(routes).find((x) => url.includes(x));
    if (!k) throw new Error(`no route for ${url}`);
    const status = routes[k].status ?? 200;
    return { ok: status < 300, status, json: async () => routes[k].body, text: async () => JSON.stringify(routes[k].body) };
  }) as NonNullable<NodeContext['fetch']>;
}
const run = (n: NodeSpec, routes: Record<string, Reply>, over: Partial<NodeContext> = {}, a = agent()) =>
  runPipeline({ ...a, pipeline: [n] }, { fetch: fake(routes), owmKey: KEY, now: () => NOW, ...over });

test('url builders encode values and use metric units', () => {
  const u = owm.currentUrl(28.61, 77.21, 'a b&c');
  assert.equal(u, 'https://api.openweathermap.org/data/2.5/weather?lat=28.61&lon=77.21&units=metric&appid=a%20b%26c');
  assert.match(owm.forecastUrl(1, 2, 'k'), /\/data\/2\.5\/forecast\?lat=1&lon=2&units=metric&cnt=16&appid=k$/);
  assert.match(owm.airUrl(1, 2, 'k'), /\/data\/2\.5\/air_pollution\?lat=1&lon=2&appid=k$/);
  assert.match(owm.airForecastUrl(1, 2, 'k'), /\/air_pollution\/forecast\?/);
  assert.match(owm.oneCallUrl(1, 2, 'k'), /\/data\/3\.0\/onecall\?lat=1&lon=2&units=metric&exclude=minutely&appid=k$/);
});

test('parseCurrent converts wind to km/h and reads rain, sun and visibility', () => {
  const c = owm.parseCurrent(CURRENT);
  assert.equal(c.windKmh, 26.3);
  assert.equal(c.gustKmh, 48.5);
  assert.equal(c.visibilityKm, 10);
  assert.equal(c.rain1h, 2.73);
  assert.equal(c.snow1h, 0);
  assert.equal(c.sunrise, 1647325488000);
  assert.equal(owm.compass(c.windDeg), 'south');
  assert.equal(c.conditionId, 804);
});

test('parseForecast, parseAir and parseOneCall read the documented fields', () => {
  const f = owm.parseForecast(FORECAST);
  assert.equal(f.slots.length, 16);
  assert.equal(f.slots[0].rain3h, 1);
  assert.equal(f.slots[0].pop, 0.3);
  assert.equal(f.slots[0].gustKmh, 28.8);
  const a = owm.parseAir(AIR)[0];
  assert.equal(a.aqi, 4);
  assert.equal(a.pm25, 23.253);
  assert.equal(a.pm10, 92.214);
  const o = owm.parseOneCall(ONECALL);
  assert.equal(o.uvi, 9.2);
  assert.equal(o.hourly.length, 48);
  assert.equal(o.alerts[0].event, 'Heat wave');
  assert.equal(o.alerts[0].sender, 'India Meteorological Department');
  assert.equal(o.alerts[0].start, 1647350000000);
});

test('parsers reject answers that are not what OpenWeather sends', () => {
  assert.throws(() => owm.parseCurrent('x'), /unexpected answer/);
  assert.throws(() => owm.parseForecast({ cod: '200' }), /unexpected answer/);
  assert.throws(() => owm.parseAir({}), /unexpected answer/);
  assert.throws(() => owm.parseCurrent({ cod: 401, message: 'Invalid API key' }), /rejected the key/);
});

test('severity thresholds at their boundaries', () => {
  const s = owm;
  assert.deepEqual([39.9, 40, 59.9, 60, 89.9, 90].map(s.gustSeverity), ['info', 'watch', 'watch', 'warning', 'warning', 'severe']);
  assert.deepEqual([37.9, 38, 40.9, 41, 44.9, 45].map(s.heatSeverity), ['info', 'watch', 'watch', 'warning', 'warning', 'severe']);
  assert.deepEqual([4.1, 4, 0.1, 0, -5].map(s.coldSeverity), ['info', 'watch', 'watch', 'warning', 'warning']);
  assert.deepEqual([14.9, 15, 29.9, 30, 59.9, 60].map(s.rainSeverity), ['info', 'watch', 'watch', 'warning', 'warning', 'severe']);
  assert.equal(s.popSeverity(0.7, 10), 'watch');
  assert.equal(s.popSeverity(0.69, 10), 'info');
  assert.equal(s.popSeverity(0.9, 9.9), 'info');
  assert.deepEqual([3, 4, 5].map((a) => s.airSeverity(a, 10)), ['info', 'warning', 'severe']);
  assert.equal(s.airSeverity(2, 90), 'warning');
  assert.equal(s.airSeverity(2, 89.9), 'info');
  assert.deepEqual([199, 200, 201, 202, 210, 221, 230, 232, 233, 781, 800].map(s.conditionSeverity),
    ['info', 'watch', 'watch', 'warning', 'warning', 'warning', 'watch', 'warning', 'info', 'severe', 'info']);
  assert.deepEqual([1, 2, 3, 4, 5].map(s.aqiWord), ['Good', 'Fair', 'Moderate', 'Poor', 'Very poor']);
});

test('current node: detail text, data and tags', async () => {
  const r = await run(node('owm-current'), { '/weather': { body: CURRENT } });
  assert.equal(r.results[0].ok, true);
  assert.equal(r.items.length, 1);
  const it = r.items[0];
  assert.equal(it.kind, 'weather');
  assert.equal(it.severity, 'info');
  assert.ok(it.tags.includes('owm'));
  assert.equal(it.data?.wind_kmh, 26.3);
  assert.equal(it.data?.wind_gust_kmh, 48.5);
  assert.match(it.detail ?? '', /feels like 4.9 C/);
  assert.match(it.detail ?? '', /from the south/);
  assert.match(it.detail ?? '', /Sunrise \d\d:\d\d, sunset \d\d:\d\d/);
  assert.ok((it.detail ?? '').length <= 1500);
});

test('current node severity: cold watch at 4 C, tornado is severe', async () => {
  const cold = { ...CURRENT, main: { ...CURRENT.main, temp: 3.5 } };
  assert.equal((await run(node('owm-current'), { '/weather': { body: cold } })).items[0].severity, 'watch');
  const tornado = { ...CURRENT, weather: [{ id: 781, description: 'tornado' }] };
  assert.equal((await run(node('owm-current'), { '/weather': { body: tornado } })).items[0].severity, 'severe');
});

test('same data in the same 3 hour window gives the same id; a worse reading gives a new one', async () => {
  const a = await run(node('owm-current', { part: 'wind' }), { '/weather': { body: CURRENT } });
  const b = await run(node('owm-current', { part: 'wind' }), { '/weather': { body: CURRENT } });
  assert.equal(a.items[0].id, b.items[0].id);
  assert.equal(a.items[0].kind, 'wind');
  assert.equal(a.items[0].severity, 'watch');
  const worse = { ...CURRENT, wind: { speed: 30, deg: 90, gust: 30 } };
  const c = await run(node('owm-current', { part: 'wind' }), { '/weather': { body: worse } });
  assert.equal(c.items[0].severity, 'severe');
  assert.notEqual(c.items[0].id, a.items[0].id);
  const d = await run(node('owm-current', { part: 'wind' }, 'other'), { '/weather': { body: CURRENT } });
  assert.notEqual(d.items[0].id, a.items[0].id);
});

test('rain part uses the flood kind', async () => {
  const r = await run(node('owm-current', { part: 'rain' }), { '/weather': { body: CURRENT } });
  assert.equal(r.items[0].kind, 'flood');
  assert.match(r.items[0].body, /2\.73 mm/);
});

test('forecast node summarises the next 24 hours', async () => {
  const calls: string[] = [];
  const r = await runPipeline({ ...agent(), pipeline: [node('owm-forecast')] }, { fetch: fake({ '/forecast': { body: FORECAST } }, calls), owmKey: KEY, now: () => NOW });
  const it = r.items[0];
  assert.match(calls[0], /cnt=16/);
  assert.equal(it.data?.temp_min_c, 20);
  assert.equal(it.data?.temp_max_c, 27);
  assert.equal(it.data?.rain_mm_24h, 8);
  assert.equal(it.data?.pop_max_pct, 30);
  assert.match(it.detail ?? '', /low 20 C at/);
  assert.match(it.detail ?? '', /Strongest gust 28.8 km\/h/);
});

test('forecast rain part: heavy 3 hour rain is a warning and a likely downpour a watch', async () => {
  const heavy = { ...FORECAST, list: FORECAST.list.map((s, i) => (i === 2 ? slot(2, { rain: { '3h': 32 }, pop: 1 }) : s)) };
  const r = await run(node('owm-forecast', { part: 'rain' }), { '/forecast': { body: heavy } });
  assert.equal(r.items[0].kind, 'flood');
  assert.equal(r.items[0].severity, 'warning');
  const likely = { ...FORECAST, list: FORECAST.list.map((s, i) => (i === 1 ? slot(1, { rain: { '3h': 11 }, pop: 0.75 }) : s)) };
  const w = await run(node('owm-forecast', { part: 'rain' }), { '/forecast': { body: likely } });
  assert.equal(w.items[0].severity, 'watch');
});

test('forecast with a thunderstorm and strong gusts', async () => {
  const stormy = { ...FORECAST, list: FORECAST.list.map((s, i) => (i === 1 ? slot(1, { weather: [{ id: 211, description: 'thunderstorm' }], wind: { speed: 26, gust: 28 } }) : s)) };
  const r = await run(node('owm-forecast'), { '/forecast': { body: stormy } });
  assert.equal(r.items[0].severity, 'warning');
  assert.ok(r.items.some((i) => i.kind === 'wind' && i.severity === 'severe'));
  assert.match(r.items[0].detail ?? '', /Thunderstorm risk/);
});

test('air node reports the index word and pollutants', async () => {
  const later = { list: [{ dt: 1606147200 + 7200, main: { aqi: 5 }, components: { pm2_5: 100 } }] };
  const r = await run(node('owm-air'), { 'air_pollution/forecast': { body: later }, '/air_pollution': { body: AIR } });
  const it = r.items[0];
  assert.equal(it.kind, 'advisory');
  assert.equal(it.severity, 'warning');
  assert.match(it.title, /Poor/);
  assert.equal(it.data?.pm25, 23.253);
  assert.match(it.detail ?? '', /PM2\.5 23\.3 ug\/m3, PM10 92\.2 ug\/m3/);
  assert.match(it.detail ?? '', /NO2 0.4, O3 75.1, SO2 0.6, CO 203.6/);
  assert.match(it.detail ?? '', /Worst in the next 24 hours: Very poor/);
});

test('air node still works when only the forecast call fails', async () => {
  const r = await run(node('owm-air'), { 'air_pollution/forecast': { status: 500, body: {} }, '/air_pollution': { body: AIR } });
  assert.equal(r.results[0].ok, true);
  assert.equal(r.items.length, 1);
});

test('one call node: alerts are quoted, trimmed and severe, plus a 48 hour summary', async () => {
  const r = await run(node('owm-onecall'), { '/onecall': { body: ONECALL } });
  const alert = r.items.find((i) => i.kind === 'alert');
  assert.ok(alert);
  assert.equal(alert.severity, 'severe');
  assert.match(alert.title, /Heat wave \(India Meteorological Department\)/);
  assert.match(alert.detail ?? '', /"Severe heat wave conditions are likely\./);
  assert.ok((alert.detail ?? '').length < 700, 'description trimmed');
  assert.match(alert.detail ?? '', /\.\.\."$/);
  const sum = r.items.find((i) => i.kind !== 'alert');
  assert.ok(sum);
  assert.equal(sum.data?.uv_index, 9.2);
  assert.equal(sum.data?.uv_index_max_48h, 10.4);
  assert.match(sum.detail ?? '', /UV index now 9.2, peak in 48 hours 10.4/);
  const only = await run(node('owm-onecall', { part: 'alerts' }), { '/onecall': { body: ONECALL } });
  assert.equal(only.items.length, 1);
});

test('one call 401 explains the subscription; other 401s explain activation', async () => {
  const oc = await run(node('owm-onecall'), { '/onecall': { status: 401, body: { cod: 401 } } });
  assert.equal(oc.results[0].ok, false);
  assert.equal(oc.results[0].error, 'One Call needs the One Call by Call subscription on your OpenWeather account');
  const cur = await run(node('owm-current'), { '/weather': { status: 401, body: {} } });
  assert.equal(cur.results[0].error, 'OpenWeather rejected the key (new keys can take up to a couple of hours to start working)');
});

test('429, other HTTP errors and network errors become short messages', async () => {
  const r429 = await run(node('owm-current'), { '/weather': { status: 429, body: {} } });
  assert.equal(r429.results[0].error, 'OpenWeather rate limit reached');
  const r500 = await run(node('owm-current'), { '/weather': { status: 500, body: {} } });
  assert.match(r500.results[0].error ?? '', /error \(500\)/);
  const boom = await runPipeline({ ...agent(), pipeline: [node('owm-current')] }, { fetch: (async (u: string) => { throw new Error(`socket hang up at ${u}`); }) as never, owmKey: KEY });
  assert.equal(boom.results[0].error, 'Could not reach OpenWeather');
});

test('the key never appears in errors', async () => {
  const leaks = await runPipeline({ ...agent(), pipeline: [node('owm-current')] }, { fetch: (async (u: string) => { throw new Error(`failed ${u}`); }) as never, owmKey: KEY });
  assert.ok(!JSON.stringify(leaks).includes(KEY));
  assert.equal(owm.redactKey(`GET https://x/y?appid=${KEY}&lat=1`, KEY), 'GET https://x/y?appid=[hidden]&lat=1');
  assert.equal(owm.redactKey(`oops ${KEY} again`, KEY), 'oops [hidden] again');
  assert.ok(!owm.redactKey('https://a?appid=zzz', undefined).includes('zzz'));
});

test('no key and no place give clear errors; nothing throws', async () => {
  const noKey = await runPipeline({ ...agent(), pipeline: [node('owm-current')] }, { fetch: fake({}) });
  assert.equal(noKey.results[0].error, 'Add your OpenWeather key in Connections');
  const noPlace = await run(node('owm-current'), {}, {}, agent({ place: undefined }));
  assert.equal(noPlace.results[0].error, 'This agent has no place');
});

test('offline mode returns clearly marked sample items at info', async () => {
  for (const kind of ['owm-current', 'owm-forecast', 'owm-air', 'owm-onecall'] as const) {
    const r = await runPipeline({ ...agent(), pipeline: [node(kind)] }, { offline: true, now: () => NOW });
    assert.equal(r.results[0].ok, true, kind);
    assert.ok(r.items.length >= 1, kind);
    for (const it of r.items) {
      assert.ok(it.tags.includes('sample'), kind);
      assert.match(it.title, /^Sample: /);
      assert.equal(it.severity, 'info');
    }
  }
});

test('catalog and templates are valid', () => {
  for (const k of ['owm-current', 'owm-forecast', 'owm-air', 'owm-onecall'] as const) {
    const info = nodeKindInfo(k);
    assert.ok(info?.source);
    assert.equal(info.fields[0].key, 'part');
    assert.deepEqual(info.fields[0].options, ['all', 'wind', 'rain', 'temperature', 'air', 'alerts']);
  }
  assert.match(nodeKindInfo('owm-onecall')?.description ?? '', /subscription/);
  for (const id of ['owm-weather-desk', 'owm-storm-desk', 'owm-air-desk']) {
    const t = templateById(id);
    assert.ok(t, id);
    const p = t.agent.pipeline ?? [];
    assert.ok(p.length > 0 && p.every((n) => n.kind.startsWith('owm-')), id);
    assert.equal(cleanPipeline(p).length, p.length);
  }
  assert.equal(templateById('owm-storm-desk')?.agent.pipeline?.[0].config.part, 'wind');
  assert.equal(templateById('owm-storm-desk')?.agent.pipeline?.[1].config.part, 'rain');
  assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, TEMPLATES.length);
});

test('app stores the key privately, hides it in state, and cleans pasted input', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'owm-'));
  const app = new HubApp({ dir, offline: true, interactive: false });
  assert.equal(app.state().connections.openWeather.hasKey, false);
  assert.equal((await app.testOpenWeather()).error, 'Add your OpenWeather key in Connections');
  app.setOpenWeatherKey(`  "${KEY}"\n`);
  assert.equal(app.state().connections.openWeather.hasKey, true);
  assert.ok(!JSON.stringify(app.state()).includes(KEY));
  assert.equal(JSON.parse(readFileSync(join(dir, 'secrets.json'), 'utf8')).openWeatherKey, KEY);
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'secrets.json')).mode & 0o077, 0);
  app.setOpenWeatherKey('');
  assert.equal(app.state().connections.openWeather.hasKey, true, 'an empty save keeps the key');
  app.removeOpenWeatherKey();
  assert.equal(app.state().connections.openWeather.hasKey, false);
});

test('settings endpoint saves the key without echoing it; test endpoint answers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'owm-http-'));
  const app = new HubApp({ dir, offline: true, interactive: false });
  const { server, port } = await startHttp(app, { token: 'tok' });
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'x-hub-token': 'tok', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, text: await r.text() };
  };
  try {
    const put = await call('PUT', '/api/settings', { openWeatherKey: KEY });
    assert.equal(put.status, 200);
    assert.ok(!put.text.includes(KEY));
    assert.equal(JSON.parse(put.text).openWeather.hasKey, true);
    const st = await call('GET', '/api/state');
    assert.ok(!st.text.includes(KEY));
    app.removeOpenWeatherKey();
    const t = await call('POST', '/api/owm/test', {});
    assert.equal(t.status, 200);
    assert.equal(JSON.parse(t.text).ok, false);
    assert.ok(!t.text.includes(KEY));
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

test('UI files parse', () => {
  for (const f of ['ui/js/pages/connections.js', 'ui/js/demo.js']) execFileSync(process.execPath, ['--check', f], { cwd: join(import.meta.dirname, '..') });
});
