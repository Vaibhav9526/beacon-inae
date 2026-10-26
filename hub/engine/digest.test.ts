import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDigest, escapeHtml, formatItemPost, labelData, splitHtml, stripHtml } from './digest.ts';
import type { FeedItem } from './types.ts';

const NOW = Date.UTC(2026, 9, 26, 6, 30);
const it = (id: string, over: Partial<FeedItem> = {}): FeedItem => ({
  id,
  agentId: 'a1',
  agentName: 'Weather agent',
  kind: 'weather',
  title: `Title ${id}`,
  body: 'Body.',
  severity: 'info',
  at: NOW,
  tags: [],
  ...over,
});

test('labelData humanises keys with units', () => {
  assert.equal(labelData('wind_kmh', 62), 'Wind 62 km/h');
  assert.equal(labelData('temp_c', 31), 'Temperature 31 C');
  assert.equal(labelData('humidity_pct', 70), 'Humidity 70%');
  assert.equal(labelData('aqi', 180), 'AQI 180');
  assert.equal(labelData('pm25', 91.26), 'PM2.5 91.3 ug/m3');
  assert.equal(labelData('rain_mm_3h', 12), 'Rain in 3 h 12 mm');
  assert.equal(labelData('river_level_m', 4.2), 'River level 4.2 m');
  assert.equal(labelData('hr:Maa', 72), 'Heart rate (Maa) 72 bpm');
  assert.equal(labelData('trend', 'rising'), 'Trend rising');
});

test('escapeHtml escapes < > & and quotes', () => {
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

test('phone item: one combined item with limits, tags, units and stable id', () => {
  const items = [
    it('1', { title: 'Rain later today', severity: 'watch', tags: ['rain'], data: { temp_c: 31, rain_mm_3h: 12 }, place: 'Raipur' }),
    it('2', { kind: 'wind', title: 'Gusty wind', severity: 'warning', tags: ['wind', 'rain'], data: { wind_kmh: 62 }, place: 'Raipur' }),
    it('3', { title: 'Humid', data: { humidity_pct: 80 }, place: 'Raipur' }),
    it('4', { title: 'Sunny tomorrow' }),
  ];
  const { phoneItem: p } = buildDigest(items, { now: NOW, notify: true });
  assert.equal(p.kind, 'weather');
  assert.ok(p.title.length <= 50, p.title);
  assert.match(p.title, /^Weather update: Raipur 31 C/);
  assert.equal(p.severity, 'warning');
  assert.deepEqual(p.tags, ['digest', 'rain', 'wind', 'notify']);
  assert.ok(p.body.split(/\s+/).length <= 60);
  assert.match(p.body, /Gusty wind/);
  assert.ok(p.detail!.length <= 1500);
  assert.match(p.detail!, /Wind 62 km\/h/);
  assert.match(p.detail!, /Temperature 31 C/);
  assert.match(p.detail!, /Rain in 3 h 12 mm/);
  assert.equal(buildDigest(items, { now: NOW + 1 }).phoneItem.id, p.id, 'id is stable for the same items');
  assert.ok(!buildDigest(items, { now: NOW }).phoneItem.tags.includes('notify'));
  assert.notEqual(buildDigest(items.slice(1), { now: NOW }).phoneItem.id, p.id);
});

test('phone item: advisory when a non weather item is mixed in; detail capped at 1500', () => {
  const many = Array.from({ length: 60 }, (_, i) => it(`n${i}`, { kind: i === 0 ? 'news' : 'weather', title: `Headline number ${i} with some words`, body: 'x'.repeat(200) }));
  const { phoneItem } = buildDigest(many, { now: NOW });
  assert.equal(phoneItem.kind, 'advisory');
  assert.ok(phoneItem.detail!.length <= 1500);
  assert.ok(phoneItem.title.length <= 50);
});

test('telegram: header, sections in order, bullets with numbers, footer', () => {
  const items = [
    it('n', { kind: 'news', title: 'Local news', url: 'https://example.com/a?x=1&y=2' }),
    it('q', { kind: 'quake', title: 'Quake M4.6', data: { quake_max_mag: 4.6, quake_nearest_km: 120 } }),
    it('a', { kind: 'alert', title: 'IMD orange alert', severity: 'warning' }),
    it('w', { title: 'Warm', data: { temp_c: 31 } }),
    it('f', { title: 'Rain tomorrow', tags: ['forecast'] }),
    it('d', { kind: 'wind', title: 'Gusty', data: { wind_kmh: 62 } }),
    it('r', { kind: 'flood', title: 'River rising' }),
    it('x', { title: 'Hazy', data: { aqi: 160, pm25: 70 } }),
  ];
  const { telegram } = buildDigest(items, { now: NOW, title: 'Family update', place: 'Raipur', nextInMin: 60 });
  const all = telegram.join('\n');
  const order = ['Alerts', 'Weather now', 'Next 24 hours', 'Wind', 'Rain and flood', 'Air quality', 'Quakes', 'News headlines'].map((h) => all.indexOf(`<b>${h}</b>`));
  assert.ok(order.every((n) => n >= 0), String(order));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.match(all, /^<b>Family update<\/b>\n<i>Raipur - /);
  assert.match(all, /- <b>Gusty<\/b>\n  Wind 62 km\/h/);
  assert.match(all, /Largest quake 4\.6 M, Nearest quake 120 km/);
  assert.match(all, /<a href="https:\/\/example\.com\/a\?x=1&amp;y=2">Local news<\/a>/);
  assert.match(all, /Sent by Beacon Hub\. Next update in 60 min\./);
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(all), 'no emojis');
});

test('telegram: dynamic text is escaped and only http/https links become anchors', () => {
  const items = [
    it('1', { title: 'A <b>&</b> "quote"', body: 'x', detail: 'Line <script>alert(1)</script> & "more"', url: 'javascript:alert(1)' }),
    it('2', { kind: 'news', title: 'File', url: 'file:///etc/passwd' }),
    it('3', { kind: 'news', title: 'Plain http', url: 'http://example.com/x' }),
  ];
  const { telegram } = buildDigest(items, { now: NOW, title: 'T <i>', place: 'P & Q' });
  const all = telegram.join('\n');
  assert.ok(!all.includes('<script>'));
  assert.ok(!all.includes('javascript:'));
  assert.ok(!all.includes('file:'));
  assert.match(all, /A &lt;b&gt;&amp;&lt;\/b&gt; &quot;quote&quot;/);
  assert.match(all, /Line &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;more&quot;/);
  assert.match(all, /<b>T &lt;i&gt;<\/b>/);
  assert.match(all, /P &amp; Q/);
  assert.match(all, /<a href="http:\/\/example\.com\/x">Plain http<\/a>/);
  assert.deepEqual([...new Set([...all.matchAll(/<\/?([a-z]+)/g)].map((m) => m[1]))].sort(), ['a', 'b', 'i']);
});

test('telegram: item detail is trimmed to 600 characters', () => {
  const { telegram } = buildDigest([it('1', { detail: 'd'.repeat(1500) })], { now: NOW });
  const run = /d+/.exec(telegram.join('\n'))![0];
  assert.ok(run.length <= 600);
});

test('telegram: long digests are split under 4000 characters on section boundaries, tags intact', () => {
  const items = [
    ...Array.from({ length: 30 }, (_, i) => it(`n${i}`, { kind: 'news', title: `News ${i} <&>`, detail: 'w'.repeat(550), url: `https://example.com/${i}` })),
    ...Array.from({ length: 6 }, (_, i) => it(`w${i}`, { title: `Weather ${i}`, detail: 'v'.repeat(550), severity: 'warning' })),
  ];
  const { telegram } = buildDigest(items, { now: NOW, nextInMin: 30 });
  assert.ok(telegram.length >= 3);
  for (const m of telegram) {
    assert.ok(m.length <= 4000, `message of ${m.length}`);
    for (const tag of ['b', 'i', 'a']) {
      const open = (m.match(new RegExp(`<${tag}[ >]`, 'g')) ?? []).length;
      const close = (m.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
      assert.equal(open, close, `${tag} balanced`);
    }
  }
  assert.ok(telegram[0]!.includes('<b>Weather now</b>'), 'weather warnings come before news');
  assert.match(telegram[telegram.length - 1]!, /Sent by Beacon Hub/);
});

test('splitHtml: splits on newlines, reopens tags that span a split, and never cuts inside a tag', () => {
  const text = '<b>' + Array.from({ length: 200 }, (_, i) => `line ${i} ${'z'.repeat(40)}`).join('\n') + '</b>';
  const parts = splitHtml(text, 1000);
  assert.ok(parts.length > 5);
  for (const p of parts) {
    assert.ok(p.length <= 1000);
    assert.equal((p.match(/<b>/g) ?? []).length, (p.match(/<\/b>/g) ?? []).length);
  }
  assert.equal(stripHtml(parts.join('\n')).replace(/\s+/g, ''), stripHtml(text).replace(/\s+/g, ''));
  const long = splitHtml(`<a href="https://example.com/${'p'.repeat(50)}">${'word '.repeat(1500)}</a>`, 4000);
  for (const p of long) {
    assert.ok(p.length <= 4000);
    assert.equal(p.lastIndexOf('<') > p.lastIndexOf('>'), false, 'no dangling tag start');
  }
  assert.deepEqual(splitHtml('short'), ['short']);
});

test('formatItemPost: big single post, escaped, link only for http(s)', () => {
  const post = formatItemPost(it('1', { title: 'Flood <now>', severity: 'severe', body: 'Move up & stay safe.', detail: 'Details & more', data: { rain_mm_24h: 120 }, url: 'https://example.com/f', place: 'Raipur' }), { now: NOW });
  assert.match(post, /^<b>Flood &lt;now&gt;<\/b>\n<i>Severe - Weather agent - Raipur - /);
  assert.match(post, /Details &amp; more/);
  assert.match(post, /- Rain in 24 h 120 mm/);
  assert.match(post, /<a href="https:\/\/example\.com\/f">Read more<\/a>/);
  assert.match(post, /Sent by Beacon Hub\./);
  assert.ok(!formatItemPost(it('2', { url: 'ftp://x/y' }), { now: NOW }).includes('<a '));
});

test('buildDigest rejects an empty list', () => {
  assert.throws(() => buildDigest([], { now: NOW }));
});
