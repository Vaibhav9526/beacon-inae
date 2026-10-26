import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BODY_MAX, TITLE_MAX, buildNotification, clip, dataRows, firstSentence, mergeNotices, parseNoticeData, whenLabel } from '../notify';
import type { AlertItem } from '../alerts';
import type { FeedItem } from '../wire';

const feed = (over: Partial<FeedItem> = {}): FeedItem => ({
  id: 'f1',
  agentId: 'a1',
  agentName: 'Weather Desk',
  kind: 'news',
  title: 'Something happened',
  body: 'Stay indoors. The streets are closed.',
  severity: 'info',
  at: 1_000,
  tags: ['notify'],
  ...over,
});

const alert = (over: Partial<AlertItem> = {}): AlertItem => ({
  id: 'al1',
  title: 'Flash flood warning for Pune',
  body: 'Move to higher ground now. Do not walk through floodwater.',
  severity: 'severe',
  source: 'IMD',
  trust: 'official',
  origin: 'server',
  seenAt: 5_000,
  ...over,
});

test('title and body respect the length limits, even for long input', () => {
  const long = feed({ title: 'x'.repeat(200), body: 'y'.repeat(400) });
  const n = buildNotification({ kind: 'feed', item: long }, 'en');
  assert.ok(n.title.length <= TITLE_MAX, `title ${n.title.length}`);
  assert.ok(n.body.length <= BODY_MAX, `body ${n.body.length}`);
  assert.ok(n.title.endsWith('…'));
});

test('body is one sentence: the first one of the source text', () => {
  const n = buildNotification({ kind: 'feed', item: feed() }, 'en');
  assert.equal(n.body, 'Stay indoors.');
});

test('numeric titles: heat, wind with gusts, rain, AQI, magnitude', () => {
  const heat = buildNotification({ kind: 'feed', item: feed({ kind: 'weather', severity: 'warning', data: { temp_c: 43 } }) }, 'en');
  assert.equal(heat.title, 'Heat warning: 43 C');
  const wind = buildNotification({ kind: 'feed', item: feed({ kind: 'wind', data: { wind_kmh: 40, gust_kmh: 62 } }) }, 'en');
  assert.equal(wind.title, 'Wind alert: gusts 62 km/h');
  const windOnly = buildNotification({ kind: 'feed', item: feed({ kind: 'wind', data: { wind_kmh: 48 } }) }, 'en');
  assert.equal(windOnly.title, 'Wind alert: 48 km/h');
  const flood = buildNotification({ kind: 'feed', item: feed({ kind: 'flood', data: { rain_mm_3h: 63.6 } }) }, 'en');
  assert.equal(flood.title, 'Flood risk: 64 mm rain');
  const aqi = buildNotification({ kind: 'feed', item: feed({ data: { aqi: 210 } }) }, 'en');
  assert.equal(aqi.title, 'Air quality: AQI 210');
  const quake = buildNotification({ kind: 'feed', item: feed({ kind: 'quake', data: { mag: 5.24 } }) }, 'en');
  assert.equal(quake.title, 'Earthquake: M5.2');
});

test('SOS items name the sender in the title', () => {
  const n = buildNotification({ kind: 'feed', item: feed({ kind: 'custom', title: 'SOS', tags: ['notify', 'sos'], data: { name: 'Maa' } }) }, 'en');
  assert.equal(n.title, 'SOS from Maa');
});

test('a title is never just the agent name', () => {
  const n = buildNotification({ kind: 'feed', item: feed({ agentName: 'Wind Agent', title: 'Gusts near the coast' }) }, 'en');
  assert.equal(n.title, 'Gusts near the coast');
  assert.ok(!n.title.startsWith('Wind Agent'));
});

test('digest items get an Update title from the item title', () => {
  const n = buildNotification({ kind: 'feed', item: feed({ title: 'Morning roundup', tags: ['digest'] }) }, 'en');
  assert.equal(n.title, 'Update: Morning roundup');
  const hi = buildNotification({ kind: 'feed', item: feed({ title: 'सुबह की खबर', tags: ['digest'] }) }, 'hi');
  assert.equal(hi.title, 'अपडेट: सुबह की खबर');
});

test('severity picks the channel and the sound', () => {
  const sev = buildNotification({ kind: 'alert', alert: alert({ severity: 'severe' }) }, 'en');
  assert.equal(sev.channelId, 'beacon-severe');
  assert.equal(sev.sound, 'default');
  const warn = buildNotification({ kind: 'alert', alert: alert({ severity: 'warning' }) }, 'en');
  assert.equal(warn.channelId, 'beacon-warning');
  assert.equal(warn.sound, 'default');
  const watch = buildNotification({ kind: 'feed', item: feed({ severity: 'watch' }) }, 'en');
  assert.equal(watch.channelId, 'beacon-info');
  assert.equal(watch.sound, false);
});

test('data carries type, the stable id and the origin', () => {
  const h = buildNotification({ kind: 'feed', item: feed({ id: 'stable-1' }) }, 'en');
  assert.deepEqual(h.data, { type: 'notice', id: 'stable-1', origin: 'hub' });
  const a = buildNotification({ kind: 'alert', alert: alert({ id: 'al-9' }) }, 'en');
  assert.deepEqual(a.data, { type: 'notice', id: 'al-9', origin: 'alert' });
});

test('an alert never adds an "Urgent:" prefix; the title is the alert title', () => {
  const n = buildNotification({ kind: 'alert', alert: alert({ title: 'Heavy rain expected' }) }, 'en');
  assert.equal(n.title, 'Heavy rain expected');
});

test('Hindi: generated words are Hindi, units and the item text stay as given', () => {
  const heat = buildNotification({ kind: 'feed', item: feed({ kind: 'weather', data: { temp_c: 43 } }) }, 'hi');
  assert.equal(heat.title, 'गर्मी की चेतावनी: 43 C');
  const flood = buildNotification({ kind: 'feed', item: feed({ kind: 'flood', data: { rain_mm: 20 } }) }, 'hi');
  assert.equal(flood.title, 'बाढ़ का ख़तरा: 20 mm बारिश');
  const hiBody = buildNotification({ kind: 'feed', item: feed({ body: 'ऊँची जगह जाएँ। पानी से दूर रहें।' }) }, 'hi');
  assert.equal(hiBody.body, 'ऊँची जगह जाएँ।');
});

test('fallbacks when data and text are empty', () => {
  const empty = buildNotification({ kind: 'feed', item: feed({ title: 'Notice', body: '', data: undefined }) }, 'en');
  assert.equal(empty.title, 'Notice');
  assert.equal(empty.body, 'Open Beacon for details.');
  const noBody = buildNotification({ kind: 'alert', alert: alert({ body: '' }) }, 'en');
  assert.equal(noBody.body, 'Open Beacon for what to do.');
  const hi = buildNotification({ kind: 'feed', item: feed({ body: '', data: {} }) }, 'hi');
  assert.equal(hi.body, 'विवरण के लिए Beacon खोलें।');
  const emptyTitle = buildNotification({ kind: 'alert', alert: alert({ title: '' }) }, 'en');
  assert.equal(emptyTitle.title, 'Beacon');
});

test('clip and firstSentence', () => {
  assert.equal(clip('short', 10), 'short');
  assert.equal(clip('abcdefghijkl', 6), 'abcde…');
  assert.equal(firstSentence('पहला वाक्य। दूसरा।', 90), 'पहला वाक्य।');
  assert.equal(firstSentence('No full stop here', 90), 'No full stop here');
});

test('parseNoticeData accepts only our payloads', () => {
  assert.deepEqual(parseNoticeData({ type: 'notice', id: 'x', origin: 'hub' }), { id: 'x', origin: 'hub' });
  assert.equal(parseNoticeData({ type: 'other', id: 'x', origin: 'hub' }), null);
  assert.equal(parseNoticeData({ type: 'notice', id: '', origin: 'hub' }), null);
  assert.equal(parseNoticeData({ type: 'notice', id: 'x', origin: 'mesh' }), null);
  assert.equal(parseNoticeData({ alertId: 'x' }), null);
  assert.equal(parseNoticeData(undefined), null);
});

test('dataRows: known labels and units, unknown keys title-cased', () => {
  const rows = dataRows({ wind_kmh: 62, temp_c: 43.25, humidity_pct: 40, some_thing_new: 'ok' }, 'en');
  assert.deepEqual(rows, [
    { label: 'Wind', value: '62 km/h' },
    { label: 'Temperature', value: '43.3 °C' },
    { label: 'Humidity', value: '40 %' },
    { label: 'Some Thing New', value: 'ok' },
  ]);
  assert.deepEqual(dataRows(undefined, 'en'), []);
  assert.equal(dataRows({ wind_kmh: 10 }, 'hi')[0].label, 'हवा');
});

test('mergeNotices: newest first, both sources, no duplicate ids, capped', () => {
  const items = [feed({ id: 'a', at: 10 }), feed({ id: 'b', at: 30 })];
  const alerts = [alert({ id: 'c', seenAt: 20 }), alert({ id: 'a', seenAt: 1 })];
  const rows = mergeNotices(items, alerts, 50);
  assert.deepEqual(rows.map((r) => r.id), ['b', 'c', 'a']);
  assert.equal(rows[1].origin, 'alert');
  assert.equal(mergeNotices(items, alerts, 2).length, 2);
});

test('whenLabel: Today for the same day, date otherwise', () => {
  const now = new Date(2026, 9, 26, 18, 0).getTime();
  assert.equal(whenLabel(new Date(2026, 9, 26, 14, 5).getTime(), now, 'en'), 'Today 14:05');
  assert.equal(whenLabel(new Date(2026, 9, 25, 9, 7).getTime(), now, 'en'), '25 Oct 09:07');
  assert.equal(whenLabel(new Date(2026, 9, 26, 14, 5).getTime(), now, 'hi'), 'आज 14:05');
});
