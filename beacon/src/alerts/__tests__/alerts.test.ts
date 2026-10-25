import assert from 'node:assert/strict';
import { test } from 'node:test';
import { relevantHere, stateOf } from '../india';
import { fetchEarthquakes, fetchNdmaAlerts, fetchWeatherAlerts, parseCap, parseNdmaRss } from '../sources';

const CAP = `<cap:alert xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">
<cap:info><cap:language>TL</cap:language><cap:severity>Severe</cap:severity><cap:headline>తెలుగు</cap:headline></cap:info>
<cap:info><cap:language>en-IN</cap:language><cap:event>Lightning</cap:event><cap:severity>Severe</cap:severity>
<cap:expires>2026-10-25T19:50:00+05:30</cap:expires>
<cap:headline>There is a possibility of lightning in your area.</cap:headline><cap:description/>
<cap:instruction>Please follow SDMA guidelines.</cap:instruction>
<cap:area><cap:areaDesc>anm-mulakalacheruvu Mandal </cap:areaDesc></cap:area></cap:info></cap:alert>`;

const RSS = `<rss><channel><item><title>Lightning warning</title><category>Met</category>
<link>https://sachet.example/FetchXMLFile?identifier=1</link><author>controlroom@ndma.gov.in (Andhra Pradesh SDMA)</author>
<guid isPermaLink="false">1</guid><pubDate>Sun, 25 Oct 2026 11:19:39 GMT</pubDate></item>
<item><title>Heavy rain</title><category>Met</category><link>https://sachet.example/FetchXMLFile?identifier=2</link>
<author>controlroom@ndma.gov.in (Kerala SDMA)</author><guid isPermaLink="false">2</guid><pubDate>Sun, 25 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`;

test('CAP: picks the English block through the namespace prefix', () => {
  const c = parseCap(CAP);
  assert.equal(c.severity, 'severe');
  assert.equal(c.headline, 'There is a possibility of lightning in your area.');
  assert.equal(c.areaDesc, 'anm-mulakalacheruvu Mandal');
  assert.ok(c.expires! > 0);
});

test('state matching from NDMA sender strings', () => {
  assert.equal(stateOf('controlroom@ndma.gov.in (Andhra Pradesh SDMA)'), 'andhra pradesh');
  assert.equal(stateOf('Andhra-Pradesh-SDMA'), 'andhra pradesh');
  assert.equal(stateOf('Jammu & Kashmir SDMA'), 'jammu and kashmir');
  assert.ok(relevantHere('Kerala SDMA', { lat: 9.9, lon: 76.3 }));
  assert.ok(!relevantHere('Kerala SDMA', { lat: 28.6, lon: 77.2 }));
  assert.ok(relevantHere('IMD', { lat: 28.6, lon: 77.2 }), 'national senders apply across India');
  // regression: a Kerala flood bulletin signed "IMD Thiruvananthapuram" must not reach Delhi
  assert.ok(!relevantHere('NDMA IMD Thiruvananthapuram', { lat: 28.6, lon: 77.2 }));
  assert.ok(relevantHere('NDMA IMD Thiruvananthapuram', { lat: 9.9, lon: 76.3 }));
  assert.ok(!relevantHere('IMD', { lat: 28.6, lon: 77.2 }, 'Flash flood over Kozhikode and Idukki'), 'district names alone are not enough, but a named state is');
  assert.ok(!relevantHere('IMD', { lat: 28.6, lon: 77.2 }, 'Heavy rain over Kerala and Tamil Nadu'));
  assert.ok(relevantHere('IMD', { lat: 13.0, lon: 80.2 }, 'Heavy rain over Kerala and Tamil Nadu'));
  assert.ok(!relevantHere('IMD', { lat: 51.5, lon: -0.1 }), 'but not abroad');
});

test('NDMA feed is filtered to the user state and enriched from CAP', async () => {
  const fake = async (url: string) => ({
    ok: true,
    json: async () => ({}),
    text: async () => (url.includes('rss_india') ? RSS : CAP),
  });
  assert.equal(parseNdmaRss(RSS).length, 2);
  const kochi = await fetchNdmaAlerts({ lat: 9.93, lon: 76.27 }, { enrich: true }, fake);
  assert.equal(kochi.length, 1);
  assert.equal(kochi[0].id, 'ndma-2');
  const delhi = await fetchNdmaAlerts({ lat: 28.6, lon: 77.2 }, { enrich: true }, fake);
  assert.equal(delhi.length, 0, 'no Delhi alerts in this feed, and other states are not leaked');
  const all = await fetchNdmaAlerts(null, {}, fake);
  assert.equal(all.length, 2);
});

test('earthquakes: distance-aware near a user, only M6+ without a position', async () => {
  const feed = {
    features: [
      { id: 'a', properties: { mag: 6.2, place: 'Far', time: Date.now() - 600000, url: '' }, geometry: { coordinates: [100, 10, 30] } },
      { id: 'b', properties: { mag: 5.2, place: 'Near', time: Date.now() - 600000, url: '' }, geometry: { coordinates: [77.3, 28.9, 10] } },
      { id: 'c', properties: { mag: 4.6, place: 'Remote', time: Date.now(), url: '' }, geometry: { coordinates: [-70, -30, 10] } },
    ],
  };
  const fake = async () => ({ ok: true, json: async () => feed, text: async () => '' });
  const near = await fetchEarthquakes({ lat: 28.6, lon: 77.2 }, fake);
  assert.deepEqual(near.map((a) => a.id), ['usgs-b']);
  const global = await fetchEarthquakes(null, fake);
  assert.deepEqual(global.map((a) => a.id), ['usgs-a']);
});

test('weather thresholds follow IMD rainfall classes', async () => {
  const mk = (rain: number, gust: number, temp: number, code: number) => async () => ({
    ok: true,
    text: async () => '',
    json: async () => ({ daily: { time: ['2026-10-25', '2026-10-26'], precipitation_sum: [rain, 0], wind_gusts_10m_max: [gust, 0], temperature_2m_max: [temp, 20], weather_code: [code, 0] } }),
  });
  const p = { lat: 19, lon: 73 };
  assert.equal((await fetchWeatherAlerts(p, mk(10, 20, 30, 1))).length, 0);
  const heavy = await fetchWeatherAlerts(p, mk(130, 95, 46, 96));
  assert.deepEqual(heavy.map((a) => a.title).sort(), ['Damaging winds', 'Severe heat', 'Thunderstorm', 'Very heavy rain']);
});
