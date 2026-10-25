import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCapAlert, capToFeedItem, capSeverity } from './capParse.ts';
import { toCap } from './cap.ts';
import type { Agent, Alert, Signal } from './types.ts';

// SACHET-style CAP 1.2 alert: namespaced root, English and Hindi info blocks, a polygon on one area.
const SACHET = `<?xml version="1.0" encoding="UTF-8"?>
<cap:alert xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">
  <cap:identifier>NDMA-IMD-2026-10-25-0931</cap:identifier>
  <cap:sender>sachet@ndma.gov.in</cap:sender>
  <cap:sent>2026-10-25T09:31:00+05:30</cap:sent>
  <cap:status>Actual</cap:status>
  <cap:msgType>Alert</cap:msgType>
  <cap:scope>Public</cap:scope>
  <cap:info>
    <cap:language>en-IN</cap:language>
    <cap:category>Met</cap:category>
    <cap:event>Heavy Rainfall Warning</cap:event>
    <cap:urgency>Expected</cap:urgency>
    <cap:severity>Severe</cap:severity>
    <cap:certainty>Likely</cap:certainty>
    <cap:expires>2026-10-26T09:31:00+05:30</cap:expires>
    <cap:headline>Heavy rainfall warning for Kerala and Karnataka coast</cap:headline>
    <cap:description>Heavy to very heavy rainfall is likely over coastal districts during the next 48 hours. Waterlogging and landslides are possible in hilly areas. Fishermen are advised not to venture into the sea.</cap:description>
    <cap:instruction>Stay away from riverbanks and low-lying areas. Keep a bag of essential documents ready.</cap:instruction>
    <cap:area>
      <cap:areaDesc>Kerala</cap:areaDesc>
      <cap:polygon>9.5,76.2 10.1,76.4 9.9,76.9 9.5,76.2</cap:polygon>
    </cap:area>
    <cap:area>
      <cap:areaDesc>Dakshina Kannada, Karnataka</cap:areaDesc>
    </cap:area>
  </cap:info>
  <cap:info>
    <cap:language>hi-IN</cap:language>
    <cap:category>Met</cap:category>
    <cap:event>Heavy Rainfall Warning</cap:event>
    <cap:severity>Moderate</cap:severity>
    <cap:headline>कोंकण तट के लिए भारी वर्षा चेतावनी</cap:headline>
    <cap:description>तटीय जिलों में भारी वर्षा की संभावना है।</cap:description>
    <cap:area>
      <cap:areaDesc>Goa</cap:areaDesc>
      <cap:circle>15.5,73.8 25</cap:circle>
    </cap:area>
  </cap:info>
</cap:alert>`;

const DELHI: Agent = {
  id: 'ag-delhi', name: 'Delhi alerts', avatar: 'sentinel', enabled: true, watch: [], everyMin: 15, rules: [],
  channels: ['beacon'], createdAt: 0, place: { name: 'Delhi', lat: 28.61, lon: 77.2, state: 'delhi' },
};

test('reads one record per info block with alert-level fields copied across', () => {
  const infos = parseCapAlert(SACHET);
  assert.equal(infos.length, 2);
  const en = infos[0];
  assert.equal(en.identifier, 'NDMA-IMD-2026-10-25-0931');
  assert.equal(en.sender, 'sachet@ndma.gov.in');
  assert.equal(en.sent, Date.UTC(2026, 9, 25, 4, 1));
  assert.equal(en.status, 'Actual');
  assert.equal(en.msgType, 'Alert');
  assert.equal(en.language, 'en-IN');
  assert.equal(en.category, 'Met');
  assert.equal(en.event, 'Heavy Rainfall Warning');
  assert.equal(en.urgency, 'Expected');
  assert.equal(en.severity, 'Severe');
  assert.equal(en.certainty, 'Likely');
  assert.equal(en.expires, Date.UTC(2026, 9, 26, 4, 1));
  assert.equal(en.headline, 'Heavy rainfall warning for Kerala and Karnataka coast');
  assert.match(en.description, /^Heavy to very heavy rainfall/);
  assert.match(en.instruction, /riverbanks/);
});

test('reads every area with its description, polygon and circle', () => {
  const [en, hi] = parseCapAlert(SACHET);
  assert.equal(en.areas.length, 2);
  assert.equal(en.areas[0].areaDesc, 'Kerala');
  assert.equal(en.areas[0].polygon, '9.5,76.2 10.1,76.4 9.9,76.9 9.5,76.2');
  assert.equal(en.areas[0].circle, undefined);
  assert.equal(en.areas[1].areaDesc, 'Dakshina Kannada, Karnataka');
  assert.equal(hi.language, 'hi-IN');
  assert.equal(hi.headline, 'कोंकण तट के लिए भारी वर्षा चेतावनी');
  assert.equal(hi.areas[0].circle, '15.5,73.8 25');
  assert.equal(hi.expires, null);
  assert.equal(hi.instruction, '');
});

test('reads a bare CAP document without an alert wrapper, and an unprefixed one', () => {
  const bare = `<alert><identifier>X-1</identifier><sent>2026-10-25T00:00:00Z</sent>
    <info><event>Flood</event><severity>Minor</severity><headline>Minor flood</headline>
    <description>River level rising.</description><area><areaDesc>Bihar</areaDesc></area></info></alert>`;
  const [one] = parseCapAlert(bare);
  assert.equal(one.identifier, 'X-1');
  assert.equal(one.event, 'Flood');
  assert.equal(one.areas[0].areaDesc, 'Bihar');
  const [two] = parseCapAlert(`<info><event>Storm</event><headline>Storm</headline></info>`);
  assert.equal(two.event, 'Storm');
  assert.equal(two.identifier, '');
});

test('non-CAP or broken input returns []', () => {
  assert.deepEqual(parseCapAlert(''), []);
  assert.deepEqual(parseCapAlert('<html><body>Maintenance</body></html>'), []);
  assert.deepEqual(parseCapAlert('<alert><identifier>x'), []);
  assert.deepEqual(parseCapAlert(null as unknown as string), []);
});

test('capSeverity maps CAP severity to the hub scale', () => {
  assert.equal(capSeverity('Extreme'), 'severe');
  assert.equal(capSeverity('Severe'), 'severe');
  assert.equal(capSeverity('Moderate'), 'warning');
  assert.equal(capSeverity('Minor'), 'watch');
  assert.equal(capSeverity('Unknown'), 'info');
  assert.equal(capSeverity(''), 'info');
});

test('capToFeedItem: headline plus 40 words of description, kind alert, place from the first area', () => {
  const [en] = parseCapAlert(SACHET);
  const item = capToFeedItem(en, DELHI, 1);
  assert.equal(item.kind, 'alert');
  assert.equal(item.title, 'Heavy rainfall warning for Kerala and Karnataka coast');
  assert.equal(item.severity, 'severe');
  assert.equal(item.place, 'Kerala');
  assert.equal(item.agentId, 'ag-delhi');
  assert.equal(item.agentName, 'Delhi alerts');
  assert.equal(item.at, Date.UTC(2026, 9, 25, 4, 1));
  assert.deepEqual(item.tags, ['met', 'heavy rainfall warning']);
  assert.match(item.id, /^[0-9a-f]{16}$/);
  const bodyWords = item.body.split(/\s+/).length;
  assert.ok(bodyWords <= 50, `body has ${bodyWords} words`);
  assert.ok(item.body.startsWith('Heavy rainfall warning for Kerala and Karnataka coast. Heavy to very heavy rainfall'));
  assert.ok(!item.body.endsWith('...'));
});

test('capToFeedItem cuts a long description at 40 words and falls back to now without a sent time', () => {
  const long = Array.from({ length: 60 }, (_, i) => 'w' + i).join(' ');
  const [info] = parseCapAlert(`<alert><info><event>Flood</event><headline>Flood</headline><description>${long}</description></info></alert>`);
  const item = capToFeedItem(info, DELHI, 777);
  assert.equal(item.body, 'Flood. ' + Array.from({ length: 40 }, (_, i) => 'w' + i).join(' ') + '...');
  assert.equal(item.at, 777);
});

test('capToFeedItem: severity and place from the second info block', () => {
  const [, hi] = parseCapAlert(SACHET);
  const item = capToFeedItem(hi, DELHI, 777);
  assert.equal(item.severity, 'warning');
  assert.equal(item.at, Date.UTC(2026, 9, 25, 4, 1));
  assert.equal(item.place, 'Goa');
  assert.equal(item.body.includes('तटीय जिलों'), true);
});

test('round trip: toCap output reads back to the same identifier, times, text and area', () => {
  const AT = Date.UTC(2026, 9, 25, 6, 30, 0);
  const sig: Signal = {
    agentId: 'ag1', agentName: 'Heat watch', ruleId: 'r1', severity: 'severe', title: 'Heat', body: 'Hot.', metrics: {},
    fingerprint: 'heat:delhi', tags: ['heat'], at: AT,
  };
  const alert: Alert = {
    id: 'abc-0', severity: 'severe', title: 'Heatwave & heart rate',
    body: 'Heat index 43 <urgent> "now" \'today\'. Drink water.',
    channels: ['beacon'], signals: [sig], at: AT, status: 'sent',
  };
  const xml = toCap(alert, { sender: 'beacon-hub', now: AT + 1000, tzOffsetMin: 330, place: 'Delhi' });
  const [info] = parseCapAlert(xml);
  assert.equal(info.identifier, 'abc-0');
  assert.equal(info.sender, 'beacon-hub');
  assert.equal(info.status, 'Actual');
  assert.equal(info.msgType, 'Alert');
  assert.equal(info.sent, AT);
  assert.equal(info.event, 'Heatwave & heart rate');
  assert.equal(info.headline, 'Heatwave & heart rate');
  assert.equal(info.description, alert.body);
  assert.equal(info.areas[0].areaDesc, 'Delhi');
  assert.equal(info.severity, 'Extreme');

  const item = capToFeedItem(info, DELHI, AT);
  assert.equal(item.title, 'Heatwave & heart rate');
  // Extreme maps to severe, so severe alerts survive the round trip.
  assert.equal(item.severity, 'severe');
  assert.equal(item.place, 'Delhi');
  assert.equal(item.body.startsWith('Heatwave & heart rate. Heat index 43 <urgent> "now"'), true);
});
