import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCap, xmlEscape } from './cap.ts';
import type { Alert, Signal } from './types.ts';

const AT = Date.UTC(2026, 9, 25, 6, 30, 0);

const sig = (over: Partial<Signal> = {}): Signal => ({
  agentId: 'ag1', agentName: 'Heat watch', ruleId: 'r1', severity: 'severe', title: 'Heat', body: 'Hot.', metrics: {},
  fingerprint: 'heat:delhi', tags: ['heat'], at: AT, ...over,
});

const alert = (over: Partial<Alert> = {}): Alert => ({
  id: 'abc-0', severity: 'severe', title: 'Heatwave & heart rate', body: 'Heat index 43 <urgent> "now" \'today\'.',
  channels: ['beacon'], signals: [sig()], at: AT, status: 'sent', ...over,
});

const field = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : null;
};

test('builds a CAP 1.2 alert envelope with fixed status, msgType and scope', () => {
  const xml = toCap(alert(), { sender: 'beacon-hub', now: AT + 1000, tzOffsetMin: 330 });
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<alert xmlns="urn:oasis:names:tc:emergency:cap:1\.2">/);
  assert.equal(field(xml, 'identifier'), 'abc-0');
  assert.equal(field(xml, 'sender'), 'beacon-hub');
  assert.equal(field(xml, 'status'), 'Actual');
  assert.equal(field(xml, 'msgType'), 'Alert');
  assert.equal(field(xml, 'scope'), 'Public');
  assert.equal(field(xml, 'certainty'), 'Likely');
});

test('sent is ISO with the given offset', () => {
  const xml = toCap(alert(), { sender: 's', now: AT, tzOffsetMin: 330 });
  // 06:30 UTC is 12:00 at +05:30
  assert.equal(field(xml, 'sent'), '2026-10-25T12:00:00+05:30');
  const utc = toCap(alert(), { sender: 's', now: AT, tzOffsetMin: 0 });
  assert.equal(field(utc, 'sent'), '2026-10-25T06:30:00+00:00');
  const west = toCap(alert(), { sender: 's', now: AT, tzOffsetMin: -210 });
  assert.equal(field(west, 'sent'), '2026-10-25T03:00:00-03:30');
});

test('severity and urgency map from the hub severity', () => {
  const map: Array<[Alert['severity'], string, string]> = [
    ['info', 'Minor', 'Unknown'],
    ['watch', 'Moderate', 'Future'],
    ['warning', 'Severe', 'Expected'],
    ['severe', 'Extreme', 'Immediate'],
  ];
  for (const [sev, cap, urgency] of map) {
    const xml = toCap(alert({ severity: sev }), { sender: 's', now: AT, tzOffsetMin: 0 });
    assert.equal(field(xml, 'severity'), cap, sev);
    assert.equal(field(xml, 'urgency'), urgency, sev);
  }
});

test('category follows the most important hazard tag', () => {
  const cat = (tags: string[], severity: Alert['severity'] = 'severe') =>
    field(toCap(alert({ severity, signals: [sig({ tags, severity })] }), { sender: 's', now: AT, tzOffsetMin: 0 }), 'category');
  assert.equal(cat(['heat']), 'Met');
  assert.equal(cat(['flood']), 'Met');
  assert.equal(cat(['quake']), 'Geo');
  assert.equal(cat(['health']), 'Health');
  assert.equal(cat(['air']), 'Met');
});

test('areaDesc uses the given place, else the signal fingerprint place', () => {
  const given = toCap(alert(), { sender: 's', now: AT, place: 'Maa flat, Delhi', tzOffsetMin: 0 });
  assert.equal(field(given, 'areaDesc'), 'Maa flat, Delhi');
  const fromSignal = toCap(alert(), { sender: 's', now: AT, tzOffsetMin: 0 });
  assert.equal(field(fromSignal, 'areaDesc'), 'Delhi');
  const none = toCap(alert({ signals: [] }), { sender: 's', now: AT, tzOffsetMin: 0 });
  assert.equal(field(none, 'areaDesc'), 'Your area');
});

test('headline, event and description carry the alert text, escaped', () => {
  const xml = toCap(alert(), { sender: 's', now: AT, tzOffsetMin: 0 });
  assert.equal(field(xml, 'headline'), 'Heatwave &amp; heart rate');
  assert.equal(field(xml, 'event'), 'Heatwave &amp; heart rate');
  assert.equal(field(xml, 'description'), 'Heat index 43 &lt;urgent&gt; &quot;now&quot; &apos;today&apos;.');
  assert.doesNotMatch(xml, /<urgent>/);
});

test('xmlEscape escapes the five XML characters and drops control characters', () => {
  assert.equal(xmlEscape(`a&b<c>d"e'f`), 'a&amp;b&lt;c&gt;d&quot;e&apos;f');
  assert.equal(xmlEscape('x\u0001y'), 'xy');
});

test('an injected closing tag in the title cannot break out of the element', () => {
  const xml = toCap(alert({ title: '</event><status>Test</status>' }), { sender: 's', now: AT, tzOffsetMin: 0 });
  assert.equal(field(xml, 'status'), 'Actual');
  assert.doesNotMatch(xml, /<status>Test<\/status>/);
});

test('the XML is well formed: every element opened is closed in order', () => {
  const xml = toCap(alert(), { sender: 'beacon-hub', now: AT, tzOffsetMin: 330 });
  const stack: string[] = [];
  for (const m of xml.matchAll(/<(\/?)([a-zA-Z]+)(\s[^>]*)?(\/?)>/g)) {
    if (m[4] === '/') continue;
    if (m[1] === '') stack.push(m[2]);
    else assert.equal(stack.pop(), m[2]);
  }
  assert.equal(stack.length, 0);
});
