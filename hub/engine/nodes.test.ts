import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline, defaultPipeline, MAX_ITEMS, BODY_WORDS, type NodeContext } from './nodes.ts';
import type { Agent, FeedItem, NodeSpec, SourceOptions } from './types.ts';

const NOW = Date.UTC(2026, 9, 26, 6, 0, 0);

const agent = (over: Partial<Agent> = {}): Agent => ({
  id: 'ag1', name: 'Watch', avatar: 'scout', enabled: true, watch: [], everyMin: 15, rules: [], channels: ['beacon'],
  createdAt: 0, place: { name: 'Delhi', lat: 28.61, lon: 77.2, state: 'delhi' }, ...over,
});

const node = (id: string, kind: NodeSpec['kind'], config: Record<string, unknown> = {}, extra: Partial<NodeSpec> = {}): NodeSpec => ({
  id, kind, label: id, config, ...extra,
});

type Reply = { status?: number; body: unknown };

/** Fake fetch: the first route whose key is a prefix of the URL answers. Unknown URLs fail the test. */
function fakeFetch(routes: Record<string, Reply | string>, calls: string[] = []): NonNullable<SourceOptions['fetch']> {
  return async (url: string) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) throw new Error(`no fake route for ${url}`);
    const r = routes[key];
    const reply: Reply = typeof r === 'string' ? { body: r } : r;
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      json: async () => reply.body,
      text: async () => (typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)),
    };
  };
}

const rssOf = (titles: Array<{ t: string; link?: string; date?: string; desc?: string }>) => `<rss><channel>${titles.map((x) =>
  `<item><title>${x.t}</title><link>${x.link ?? `https://n.in/${encodeURIComponent(x.t)}`}</link>`
  + `<description>${x.desc ?? 'Body text here.'}</description>${x.date ? `<pubDate>${x.date}</pubDate>` : ''}</item>`).join('')}</channel></rss>`;

const ctxWith = (routes: Record<string, Reply | string>, extra: Partial<NodeContext> = {}, calls?: string[]): NodeContext => ({
  fetch: fakeFetch(routes, calls), now: () => NOW, ...extra,
});

const OPEN_METEO_WIND = {
  current: { temperature_2m: 31, relative_humidity_2m: 40, apparent_temperature: 34, wind_speed_10m: 30, wind_gusts_10m: 65, precipitation: 0, uv_index: 6 },
  daily: { precipitation_sum: [0, 2] },
};
const OPEN_METEO_HOT = {
  current: { temperature_2m: 42, relative_humidity_2m: 30, apparent_temperature: 46, wind_speed_10m: 8, wind_gusts_10m: 12, precipitation: 0, uv_index: 10 },
  daily: { precipitation_sum: [0, 1] },
};
const USGS = (features: Array<{ mag: number; lon: number; lat: number }>) => ({
  features: features.map((f) => ({ properties: { mag: f.mag }, geometry: { coordinates: [f.lon, f.lat, 10] } })),
});

// ---------------------------------------------------------------------------
// source nodes

test('rss: items with ids, urls, dates, default limit 8, and the keyword bump to watch', async () => {
  const titles = [
    'Cyclone Dana nears coast', 'Markets close higher', ...Array.from({ length: 8 }, (_, i) => `Local story ${i}`),
  ];
  const xml = rssOf(titles.map((t, i) => ({ t, date: i === 0 ? 'Sun, 25 Oct 2026 12:00:00 GMT' : undefined })));
  const res = await runPipeline(agent({ pipeline: [node('r1', 'rss', { url: 'https://feed.in/a.rss' })] }),
    ctxWith({ 'https://feed.in/': xml }));
  assert.equal(res.results[0].ok, true);
  assert.equal(res.results[0].items, 8);
  assert.equal(res.items.length, 8);
  const cyclone = res.items.find((i) => i.title === 'Cyclone Dana nears coast')!;
  assert.equal(cyclone.severity, 'watch');
  assert.equal(cyclone.kind, 'news');
  assert.equal(cyclone.nodeId, 'r1');
  assert.equal(cyclone.agentId, 'ag1');
  assert.equal(cyclone.agentName, 'Watch');
  assert.equal(cyclone.at, Date.UTC(2026, 9, 25, 12));
  assert.equal(cyclone.url, 'https://n.in/Cyclone%20Dana%20nears%20coast');
  const markets = res.items.find((i) => i.title === 'Markets close higher')!;
  assert.equal(markets.severity, 'info');
  assert.equal(markets.at, NOW, 'no pubDate falls back to now');
  assert.equal(res.items.filter((i) => i.severity === 'watch').length, 1);
});

test('rss: a configured kind and limit are honoured, limit is clamped to 30', async () => {
  const xml = rssOf(Array.from({ length: 12 }, (_, i) => ({ t: `Flood story ${i}` })));
  const small = await runPipeline(agent({ pipeline: [node('r', 'rss', { url: 'https://f.in/x', kind: 'flood', limit: 3 })] }),
    ctxWith({ 'https://f.in/': xml }));
  assert.equal(small.items.length, 3);
  assert.equal(small.items[0].kind, 'flood');
  const big = await runPipeline(agent({ pipeline: [node('r', 'rss', { url: 'https://f.in/x', limit: 500 })] }),
    ctxWith({ 'https://f.in/': xml }));
  assert.equal(big.items.length, 12);
});

test('rss: HTTP failure is a result error, not a thrown exception', async () => {
  const res = await runPipeline(agent({ pipeline: [node('r', 'rss', { url: 'https://down.in/x' })] }),
    ctxWith({ 'https://down.in/': { status: 503, body: 'nope' } }));
  assert.equal(res.items.length, 0);
  assert.equal(res.results[0].ok, false);
  assert.match(res.results[0].error ?? '', /503|HTTP error/);
});

test('http-json: dot path with indexes, custom keys, object path and missing path', async () => {
  const json = {
    data: { alerts: [
      { headline: 'Dengue cases rise', note: '<p>Clear <b>standing</b> water.</p>', href: 'https://h.in/1', sev: 'watch' },
      { headline: 'Smog advisory', note: 'Stay indoors.', href: 'https://h.in/2' },
    ] },
    single: { headline: 'Solo', note: 'One.' },
  };
  const ctx = ctxWith({ 'https://api.in/': { body: json } });
  const res = await runPipeline(agent({ pipeline: [node('h', 'http-json', {
    url: 'https://api.in/feed', path: 'data.alerts', titleKey: 'headline', bodyKey: 'note', urlKey: 'href', kind: 'advisory',
  })] }), ctx);
  assert.equal(res.items.length, 2);
  assert.equal(res.items[0].title, 'Dengue cases rise');
  assert.equal(res.items[0].body, 'Clear standing water.');
  assert.equal(res.items[0].url, 'https://h.in/1');
  assert.equal(res.items[0].kind, 'advisory');
  assert.equal(res.items[0].severity, 'info', 'severity field only counts when it is a known level');

  const path = await runPipeline(agent({ pipeline: [node('h', 'http-json', { url: 'https://api.in/feed', path: 'data.alerts[1]' })] }),
    ctxWith({ 'https://api.in/': { body: json } }));
  assert.equal(path.items.length, 1);
  assert.equal(path.items[0].title, 'Smog advisory');

  const single = await runPipeline(agent({ pipeline: [node('h', 'http-json', { url: 'https://api.in/feed', path: 'single' })] }),
    ctxWith({ 'https://api.in/': { body: json } }));
  assert.equal(single.items[0].title, 'Solo');

  const missing = await runPipeline(agent({ pipeline: [node('h', 'http-json', { url: 'https://api.in/feed', path: 'nope.x' })] }),
    ctxWith({ 'https://api.in/': { body: json } }));
  assert.equal(missing.results[0].ok, true);
  assert.equal(missing.items.length, 0);
});

test('weather metric wind: gust 65 km/h is a warning, data holds the numbers', async () => {
  const res = await runPipeline(agent({ pipeline: [node('w', 'weather', { metric: 'wind' })] }),
    ctxWith({ 'https://api.open-meteo.com/': { body: OPEN_METEO_WIND } }));
  assert.equal(res.items.length, 1);
  const [it] = res.items;
  assert.equal(it.kind, 'wind');
  assert.equal(it.severity, 'warning');
  assert.equal(it.title, 'Wind gusts 65 km/h');
  assert.equal(it.place, 'Delhi');
  assert.equal(it.data?.wind_gust_kmh, 65);
  assert.equal(it.data?.wind_kmh, 30);
});

test('weather metric wind: gust 40 is a watch, 20 is info', async () => {
  const gust = (g: number) => ({ current: { wind_speed_10m: 10, wind_gusts_10m: g, temperature_2m: 30, relative_humidity_2m: 50 } });
  const at = async (g: number) => (await runPipeline(agent({ pipeline: [node('w', 'weather', { metric: 'wind' })] }),
    ctxWith({ 'https://api.open-meteo.com/': { body: gust(g) } }))).items[0].severity;
  assert.equal(await at(40), 'watch');
  assert.equal(await at(20), 'info');
});

test('weather metric weather (default): hot day is a warning, always one item', async () => {
  const res = await runPipeline(agent({ pipeline: [node('w', 'weather', {})] }),
    ctxWith({ 'https://api.open-meteo.com/': { body: OPEN_METEO_HOT } }));
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].kind, 'weather');
  assert.equal(res.items[0].severity, 'warning');
  assert.match(res.items[0].title, /42 C/);
  assert.equal(res.items[0].data?.temp_c, 42);
  assert.equal(res.items[0].data?.rain_mm_24h, 1);
});

test('weather offline uses sample readings and never calls the network', async () => {
  const calls: string[] = [];
  const res = await runPipeline(agent({ pipeline: [node('w', 'weather', { metric: 'wind' })] }),
    ctxWith({}, { offline: true }, calls));
  assert.equal(calls.length, 0);
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].kind, 'wind');
});

test('weather uses metricsFor when the hub already has readings', async () => {
  const res = await runPipeline(agent({ pipeline: [node('w', 'weather', { metric: 'wind' })] }),
    ctxWith({}, { metricsFor: async () => ({ wind_gust_kmh: 75, wind_kmh: 50 }) }));
  assert.equal(res.items[0].severity, 'warning');
  assert.equal(res.items[0].title, 'Wind gusts 75 km/h');
});

test('aqi: an item at 182 (unhealthy) and none under 101', async () => {
  const aq = (v: number) => ({ current: { us_aqi: v, pm2_5: 95 } });
  const high = await runPipeline(agent({ pipeline: [node('a', 'aqi')] }),
    ctxWith({ 'https://air-quality-api.open-meteo.com/': { body: aq(182) } }));
  assert.equal(high.items.length, 1);
  assert.equal(high.items[0].kind, 'advisory');
  assert.equal(high.items[0].severity, 'watch');
  assert.match(high.items[0].title, /182/);
  const low = await runPipeline(agent({ pipeline: [node('a', 'aqi')] }),
    ctxWith({ 'https://air-quality-api.open-meteo.com/': { body: aq(90) } }));
  assert.equal(low.items.length, 0);
  assert.equal(low.results[0].ok, true);
});

test('quake: item only when a M4.5+ quake is within range', async () => {
  const feed = USGS([{ mag: 5.2, lat: 28.7, lon: 77.1 }, { mag: 7.5, lat: 35.7, lon: 139.7 }]);
  const res = await runPipeline(agent({ pipeline: [node('q', 'quake')] }),
    ctxWith({ 'https://earthquake.usgs.gov/': { body: feed } }));
  assert.equal(res.items.length, 1, 'the Tokyo quake is outside the radius');
  assert.equal(res.items[0].kind, 'quake');
  assert.equal(res.items[0].severity, 'warning');
  assert.equal(res.items[0].data?.quake_max_mag, 5.2);

  const small = await runPipeline(agent({ pipeline: [node('q', 'quake')] }),
    ctxWith({ 'https://earthquake.usgs.gov/': { body: USGS([{ mag: 4.4, lat: 28.7, lon: 77.1 }]) } }));
  assert.equal(small.items.length, 0);
  assert.equal(small.results[0].ok, true);
});

test('quake: a feed failure gives no item and no error', async () => {
  const res = await runPipeline(agent({ pipeline: [node('q', 'quake')] }),
    ctxWith({ 'https://earthquake.usgs.gov/': { status: 500, body: '' } }));
  assert.equal(res.items.length, 0);
  assert.equal(res.results[0].ok, true);
});

const SACHET_XML = `<alert><identifier>A-1</identifier><sent>2026-10-25T09:31:00+05:30</sent>
  <info><event>Heavy Rain</event><severity>Severe</severity><headline>Heavy rain for Kerala</headline>
  <description>Rain expected.</description><area><areaDesc>Kerala coast</areaDesc></area></info></alert>`;
const SACHET_MIXED = `<alerts>
  <alert><identifier>A-2</identifier><info><event>Heat</event><severity>Moderate</severity><headline>Heat in Delhi</headline>
    <description>Hot.</description><area><areaDesc>Delhi</areaDesc></area></info></alert>
  <alert><identifier>A-3</identifier><info><event>Flood</event><severity>Minor</severity><headline>Flood in Bihar</headline>
    <description>Water up.</description><area><areaDesc>Bihar, Assam</areaDesc></area></info></alert>
  <alert><identifier>A-4</identifier><info><event>Statewide</event><severity>Minor</severity><headline>Statewide watch</headline>
    <description>Everywhere.</description><area><areaDesc>Delhi, Haryana</areaDesc></area></info></alert>
</alerts>`;

test('cap: parses SACHET XML into alert items with severity mapping and node id', async () => {
  const res = await runPipeline(agent({ pipeline: [node('c', 'cap', { url: 'https://sachet.ndma.gov.in/x' })] }),
    ctxWith({ 'https://sachet.ndma.gov.in/': SACHET_XML }));
  assert.equal(res.results[0].ok, true);
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].kind, 'alert');
  assert.equal(res.items[0].severity, 'severe');
  assert.equal(res.items[0].nodeId, 'c');
  assert.equal(res.items[0].place, 'Kerala coast');
});

test('cap: filterByPlace drops alerts that name another state, keeps the rest', async () => {
  const run = (config: Record<string, unknown>) => runPipeline(agent({ pipeline: [node('c', 'cap', { url: 'https://sachet.ndma.gov.in/x', ...config })] }),
    ctxWith({ 'https://sachet.ndma.gov.in/': SACHET_MIXED }));
  const all = await run({});
  assert.deepEqual(all.items.map((i) => i.title).sort(), ['Flood in Bihar', 'Heat in Delhi', 'Statewide watch']);
  const filtered = await run({ filterByPlace: true });
  assert.deepEqual(filtered.items.map((i) => i.title).sort(), ['Heat in Delhi', 'Statewide watch']);
  assert.equal(filtered.items.find((i) => i.title === 'Heat in Delhi')!.severity, 'warning');
  assert.equal(filtered.items.find((i) => i.title === 'Statewide watch')!.severity, 'watch');
});

test('cap: missing url is a result error', async () => {
  const res = await runPipeline(agent({ pipeline: [node('c', 'cap')] }), ctxWith({}));
  assert.equal(res.results[0].ok, false);
  assert.match(res.results[0].error ?? '', /config\.url/);
});

test('mcp-tool: array, {items}, string, object results, args passed through, kind default custom', async () => {
  const calls: Array<{ server: string; tool: string; args: Record<string, unknown> }> = [];
  let answer: unknown = [];
  const callMcp = async (server: string, tool: string, args: Record<string, unknown>) => {
    calls.push({ server, tool, args });
    return answer;
  };
  const run = () => runPipeline(agent({ pipeline: [node('m', 'mcp-tool', { server: 'news-mcp', tool: 'latest', args: { region: 'in' } })] }),
    ctxWith({}, { callMcp }));

  answer = [{ title: 'Water tanker schedule', summary: 'Tankers at 6 pm.', url: 'https://x.in/tank', severity: 'watch' }, { name: 'Shelter open' }, { summary: 'no title' }];
  let res = await run();
  assert.equal(res.items.length, 2);
  assert.equal(res.items[0].title, 'Water tanker schedule');
  assert.equal(res.items[0].body, 'Tankers at 6 pm.');
  assert.equal(res.items[0].severity, 'watch');
  assert.equal(res.items[1].title, 'Shelter open');
  assert.equal(res.items[1].kind, 'custom');
  assert.deepEqual(calls[0], { server: 'news-mcp', tool: 'latest', args: { region: 'in' } });

  answer = { items: [{ text: 'Relief camp at school', headline: 'Relief camp' }] };
  res = await run();
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].title, 'Relief camp');
  assert.equal(res.items[0].body, 'Relief camp at school');

  answer = 'Roads to Gangtok are closed after the landslide.';
  res = await run();
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].body, 'Roads to Gangtok are closed after the landslide.');
  assert.match(res.items[0].title, /^Roads to Gangtok/);

  answer = { status: 'ok' };
  res = await run();
  assert.equal(res.items.length, 0, 'an object with no title gives no item');
  assert.equal(res.results[0].ok, true);
});

test('mcp-tool: missing callMcp or a thrown tool is a result error', async () => {
  const none = await runPipeline(agent({ pipeline: [node('m', 'mcp-tool', { server: 's', tool: 't' })] }), ctxWith({}));
  assert.equal(none.results[0].ok, false);
  assert.match(none.results[0].error ?? '', /MCP/);

  const boom = await runPipeline(agent({ pipeline: [node('m', 'mcp-tool', { server: 's', tool: 't' })] }),
    ctxWith({}, { callMcp: async () => { throw new Error('server exited'); } }));
  assert.equal(boom.results[0].ok, false);
  assert.equal(boom.results[0].error, 'server exited');
});

// ---------------------------------------------------------------------------
// transform nodes

/** An mcp-tool source node; the seedCtx callMcp decides what it returns. */
const seeded = (): NodeSpec => node('seed', 'mcp-tool', { server: 's', tool: 't' });
const seedCtx = (titles: string[], extra: Partial<NodeContext> = {}): NodeContext => ({
  now: () => NOW,
  callMcp: async () => titles.map((t, i) => ({ title: t, summary: `Summary of ${t} with some words.`, url: `https://u.in/${i}` })),
  ...extra,
});

test('keyword-filter: any, all and none, case-insensitive, substring of title or body', async () => {
  const titles = ['Flood in Assam', 'Heat wave in Rajasthan', 'Cricket match tonight'];
  const run = (cfg: Record<string, unknown>) => runPipeline(agent({ pipeline: [seeded(), node('k', 'keyword-filter', cfg)] }), seedCtx(titles));
  assert.deepEqual((await run({ words: ['FLOOD', 'heat'], mode: 'any' })).items.map((i) => i.title).sort(), ['Flood in Assam', 'Heat wave in Rajasthan']);
  assert.deepEqual((await run({ words: ['flood', 'assam'], mode: 'all' })).items.map((i) => i.title), ['Flood in Assam']);
  assert.deepEqual((await run({ words: ['flood', 'cricket'], mode: 'none' })).items.map((i) => i.title), ['Heat wave in Rajasthan']);
  assert.equal((await run({ words: ['rajasthan'] })).items.length, 1, 'default mode is any');
  assert.equal((await run({ words: [] })).items.length, 3, 'no words passes everything');
});

test('keyword-filter matches the body too', async () => {
  const res = await runPipeline(agent({ pipeline: [node('m', 'mcp-tool', { server: 's', tool: 't' }),
    node('k', 'keyword-filter', { words: ['tanker'], mode: 'any' })] }),
  seedCtx([], { callMcp: async () => [{ title: 'Water plan', summary: 'Tanker runs at noon' }, { title: 'Power plan', summary: 'Grid repairs' }] }));
  assert.deepEqual(res.items.map((i) => i.title), ['Water plan']);
});

test('threshold: keeps items whose data field satisfies the operator, drops items without the field', async () => {
  const wind = (g: number) => ({ current: { wind_gusts_10m: g, wind_speed_10m: 5, temperature_2m: 30, relative_humidity_2m: 50 } });
  const feed = async (op: string, value: number) => runPipeline(agent({ pipeline: [
    node('w', 'weather', { metric: 'wind' }), node('t', 'threshold', { key: 'wind_gust_kmh', op, value }),
  ] }), ctxWith({ 'https://api.open-meteo.com/': { body: wind(50) } }));
  assert.equal((await feed('>=', 40)).items.length, 1);
  assert.equal((await feed('>', 50)).items.length, 0);
  assert.equal((await feed('<', 60)).items.length, 1);
  assert.equal((await feed('<=', 49)).items.length, 0);
  assert.equal((await feed('==', 50)).items.length, 1);
  assert.equal((await feed('!=', 50)).items.length, 0);

  const bad = await runPipeline(agent({ pipeline: [seeded(), node('t', 'threshold', { key: 'wind_gust_kmh', op: '~', value: 1 })] }), seedCtx(['x']));
  assert.equal(bad.results[1].ok, false);
  assert.equal(bad.items.length, 1, 'a failed node leaves the stream as it was');
});

test('dedupe: by normalised title, first one wins, punctuation and case ignored', async () => {
  const res = await runPipeline(agent({ pipeline: [
    node('m', 'mcp-tool', { server: 's', tool: 't' }), node('d', 'dedupe'),
  ] }), seedCtx([], { callMcp: async () => [
    { title: 'Flood alert: Assam!', url: 'https://a.in/1' },
    { title: 'flood alert assam', url: 'https://b.in/2' },
    { title: 'Flood alert Bihar', url: 'https://c.in/3' },
  ] }));
  assert.equal(res.items.length, 2);
  assert.deepEqual(res.items.map((i) => i.title).sort(), ['Flood alert Bihar', 'Flood alert: Assam!']);
});

test('summarize: long bodies go to ctx.summarize, short ones are left alone', async () => {
  const long = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ');
  const asked: string[] = [];
  const res = await runPipeline(agent({ pipeline: [
    node('m', 'mcp-tool', { server: 's', tool: 't' }), node('s', 'summarize'),
  ] }), seedCtx([], {
    callMcp: async () => [{ title: 'Long one', summary: long }, { title: 'Short one', summary: 'Just a few words.' }],
    summarize: async (text) => { asked.push(text); return 'A short model summary of the story.'; },
  }));
  assert.equal(asked.length, 1);
  assert.equal(asked[0], long);
  assert.equal(res.items.find((i) => i.title === 'Long one')!.body, 'A short model summary of the story.');
  assert.equal(res.items.find((i) => i.title === 'Short one')!.body, 'Just a few words.');
});

test('summarize without a model, or when the model fails, trims to about 60 words', async () => {
  const long = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ');
  const trimmed = Array.from({ length: BODY_WORDS }, (_, i) => `w${i}`).join(' ') + '...';
  for (const summarize of [undefined, async () => { throw new Error('model down'); }, async () => null]) {
    const res = await runPipeline(agent({ pipeline: [node('m', 'mcp-tool', { server: 's', tool: 't' }), node('s', 'summarize')] }),
      seedCtx([], { callMcp: async () => [{ title: 'Long', summary: long }], summarize: summarize as NodeContext['summarize'] }));
    assert.equal(res.results[1].ok, true);
    assert.equal(res.items[0].body, trimmed);
  }
});

// ---------------------------------------------------------------------------
// pipeline behaviour

test('pipeline runs nodes in order, transforms see what came before them', async () => {
  const res = await runPipeline(agent({ pipeline: [
    node('m', 'mcp-tool', { server: 's', tool: 't' }),
    node('k', 'keyword-filter', { words: ['flood'], mode: 'any' }),
    node('d', 'dedupe'),
  ] }), seedCtx([], {
    callMcp: async () => [{ title: 'Flood A' }, { title: 'Sunny day' }, { title: 'flood a' }, { title: 'Flood B' }],
  }));
  assert.deepEqual(res.results.map((r) => r.nodeId), ['m', 'k', 'd']);
  assert.deepEqual(res.results.map((r) => r.items), [4, 3, 2], 'source adds four, filter keeps three, dedupe keeps two');
  assert.deepEqual(res.items.map((i) => i.title).sort(), ['Flood A', 'Flood B']);
});

test('disabled nodes are skipped entirely: no call, no result row', async () => {
  const calls: string[] = [];
  const res = await runPipeline(agent({ pipeline: [
    node('off', 'rss', { url: 'https://off.in/x' }, { enabled: false }),
    node('on', 'rss', { url: 'https://on.in/x' }),
  ] }), ctxWith({ 'https://on.in/': rssOf([{ t: 'Hello' }]), 'https://off.in/': rssOf([{ t: 'Never' }]) }, {}, calls));
  assert.deepEqual(res.results.map((r) => r.nodeId), ['on']);
  assert.deepEqual(calls, ['https://on.in/x']);
  assert.deepEqual(res.items.map((i) => i.title), ['Hello']);
});

test('failure isolation: a throwing node is recorded and the rest of the pipeline still runs', async () => {
  const res = await runPipeline(agent({ pipeline: [
    node('bad', 'rss', { url: 'https://down.in/x' }),
    node('good', 'mcp-tool', { server: 's', tool: 't' }),
    node('unknown', 'bogus' as NodeSpec['kind']),
    node('after', 'dedupe'),
  ] }), ctxWith({ 'https://down.in/': { status: 500, body: '' } }, {
    callMcp: async () => [{ title: 'Survivor' }],
  }));
  assert.deepEqual(res.results.map((r) => r.ok), [false, true, false, true]);
  assert.match(res.results[2].error ?? '', /unknown node kind/);
  assert.equal(res.results[0].items, 0);
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].title, 'Survivor');
});

test('ids are stable across runs and depend on kind, title and url', async () => {
  const pipe = [node('r', 'rss', { url: 'https://ids.in/x' })];
  const xml = rssOf([{ t: 'Flood in Assam', link: 'https://ids.in/a' }]);
  const a = await runPipeline(agent({ pipeline: pipe }), ctxWith({ 'https://ids.in/': xml }));
  const b = await runPipeline(agent({ pipeline: pipe }), ctxWith({ 'https://ids.in/': xml }));
  assert.equal(a.items[0].id, b.items[0].id);
  assert.match(a.items[0].id, /^[0-9a-f]{16}$/);

  const other = await runPipeline(agent({ pipeline: pipe }), ctxWith({ 'https://ids.in/': rssOf([{ t: 'Flood in Assam', link: 'https://ids.in/b' }]) }));
  assert.notEqual(other.items[0].id, a.items[0].id, 'different url, different id');
});

test('the same story from two feeds is kept once (same id)', async () => {
  const xml = rssOf([{ t: 'Same story', link: 'https://same.in/s' }]);
  const res = await runPipeline(agent({ pipeline: [
    node('r1', 'rss', { url: 'https://one.in/x' }), node('r2', 'rss', { url: 'https://two.in/x' }),
  ] }), ctxWith({ 'https://one.in/': xml, 'https://two.in/': xml }));
  assert.equal(res.items.length, 1);
  assert.equal(res.results[1].items, 0, 'the second feed adds nothing new');
});

test('caps: 60 items from two nodes leave the run at 30, and bodies at most 60 words', async () => {
  const longBody = Array.from({ length: 80 }, (_, w) => `word${w}`).join(' ');
  const batch = (prefix: string) => Array.from({ length: 30 }, (_, i) => ({
    title: `${prefix} story ${i}`, summary: longBody,
  }));
  const res = await runPipeline(agent({ pipeline: [
    node('a', 'mcp-tool', { server: 's', tool: 'a', limit: 30 }),
    node('b', 'mcp-tool', { server: 's', tool: 'b', limit: 30 }),
  ] }), seedCtx([], { callMcp: async (_s, tool) => batch(tool === 'a' ? 'A' : 'B') }));
  assert.equal(MAX_ITEMS, 30);
  assert.equal(res.results[1].items, 30, 'the second node adds its 30 before the cap');
  assert.equal(res.items.length, MAX_ITEMS);
  for (const it of res.items) assert.ok(it.body.split(/\s+/).length <= BODY_WORDS, `body too long: ${it.body.length}`);
});

test('the agent with no pipeline (or an empty one) gives no items and no results', async () => {
  assert.deepEqual(await runPipeline(agent(), ctxWith({})), { items: [], results: [] });
  assert.deepEqual(await runPipeline(agent({ pipeline: [] }), ctxWith({})), { items: [], results: [] });
});

test('items carry agent name and id, node id and a FeedItem shape', async () => {
  const res = await runPipeline(agent({ pipeline: [node('quake', 'quake')] }),
    ctxWith({ 'https://earthquake.usgs.gov/': { body: USGS([{ mag: 4.9, lat: 28.7, lon: 77.1 }]) } }));
  const it: FeedItem = res.items[0];
  assert.equal(it.nodeId, 'quake');
  assert.equal(it.agentId, 'ag1');
  assert.equal(it.agentName, 'Watch');
  assert.equal(typeof it.at, 'number');
  assert.deepEqual(it.tags, []);
});

// ---------------------------------------------------------------------------
// starter pipelines

test('defaultPipeline: starter nodes per genre', () => {
  const news = defaultPipeline('news');
  assert.deepEqual(news.map((n) => n.kind), ['rss', 'rss', 'keyword-filter']);
  assert.equal(news[0].config.url, 'https://www.thehindu.com/news/national/feeder/default.rss');
  assert.equal(news[1].config.url, 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms');
  assert.ok(news.every((n) => n.enabled === true));

  assert.deepEqual(defaultPipeline('wind').map((n) => [n.kind, n.config.metric]), [['weather', 'wind']]);
  assert.deepEqual(defaultPipeline('quake').map((n) => n.kind), ['quake']);

  const flood = defaultPipeline('flood');
  assert.deepEqual(flood.map((n) => n.kind), ['weather', 'rss', 'keyword-filter']);
  assert.ok((flood[2].config.words as string[]).includes('flood'));

  const weather = defaultPipeline('weather', { name: 'Kochi', lat: 9.9, lon: 76.3, state: 'kerala' });
  const cap = weather.find((n) => n.kind === 'cap')!;
  assert.equal(cap.config.url, 'https://sachet.ndma.gov.in/cap_public_website/FetchXMLFile?');
  assert.equal(cap.config.filterByPlace, true);
  assert.equal(defaultPipeline('weather').find((n) => n.kind === 'cap')!.config.filterByPlace, false);

  for (const g of ['health', 'supply', 'community', 'custom'] as const) assert.deepEqual(defaultPipeline(g), []);
});

test('defaultPipeline output runs through runPipeline without throwing', async () => {
  const res = await runPipeline(agent({ pipeline: defaultPipeline('news') }), ctxWith({
    'https://www.thehindu.com/': rssOf([{ t: 'Cyclone warning for Tamil Nadu' }, { t: 'Budget debate' }]),
    'https://timesofindia.indiatimes.com/': rssOf([{ t: 'Flood relief camps open' }]),
  }));
  assert.equal(res.results.every((r) => r.ok), true);
  assert.deepEqual(res.items.map((i) => i.title).sort(), ['Cyclone warning for Tamil Nadu', 'Flood relief camps open']);
});
