import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromPfif, toPfif, type PersonRecord } from '../pfif';

const NOW = Date.UTC(2026, 9, 25, 10, 0, 0);

const rec = (over: Partial<PersonRecord> = {}): PersonRecord => ({
  id: 'p1',
  fullName: 'Asha Devi',
  status: 'looking',
  note: 'Last seen near the market',
  at: Date.UTC(2026, 9, 24, 8, 30, 0),
  source: 'Ravi',
  ...over,
});

test('round trip keeps id, name, note, status, date and source', () => {
  const input = [
    rec(),
    rec({ id: 'p2', fullName: 'Mohan', status: 'safe', note: 'At the school shelter', source: 'Self' }),
    rec({ id: 'p3', fullName: 'Kavya', status: 'unknown', note: undefined }),
  ];
  const back = fromPfif(toPfif(input, NOW));
  assert.equal(back.length, 3);
  assert.deepEqual(back[0], input[0]);
  assert.deepEqual(back[1], input[1]);
  assert.equal(back[2].status, 'unknown');
  assert.equal(back[2].note, undefined);
  assert.equal(back[2].at, input[2].at);
});

test('found is exported as believed_alive and read back as safe', () => {
  const xml = toPfif([rec({ status: 'found' })], NOW);
  assert.match(xml, /<pfif:status>believed_alive<\/pfif:status>/);
  assert.equal(fromPfif(xml)[0].status, 'safe');
});

test('output is a PFIF 1.4 document with the right namespace and element structure', () => {
  const xml = toPfif([rec()], NOW);
  assert.ok(xml.includes('<pfif:pfif xmlns:pfif="http://zesty.ca/pfif/1.4">'));
  assert.ok(xml.includes('<pfif:person_record_id>p1</pfif:person_record_id>'));
  assert.ok(xml.includes('<pfif:note_record_id>p1-note</pfif:note_record_id>'));
  assert.ok(xml.includes('<pfif:status>information_sought</pfif:status>'));
  assert.ok(xml.includes('<pfif:entry_date>2026-10-24T08:30:00.000Z</pfif:entry_date>'));
});

test('escapes ampersand, angle brackets and quotes and reads them back intact', () => {
  const tricky = `Tom & Jerry <say> "hi" 'there'`;
  const xml = toPfif([rec({ fullName: tricky, note: tricky, source: 'A&B' })], NOW);
  assert.ok(!xml.includes('Tom & Jerry'));
  assert.ok(xml.includes('Tom &amp; Jerry &lt;say&gt; &quot;hi&quot; &apos;there&apos;'));
  const [back] = fromPfif(xml);
  assert.equal(back.fullName, tricky);
  assert.equal(back.note, tricky);
  assert.equal(back.source, 'A&B');
});

test('empty input gives no records', () => {
  assert.deepEqual(fromPfif(''), []);
  assert.deepEqual(fromPfif('   '), []);
  assert.deepEqual(fromPfif(toPfif([], NOW)), []);
});

test('an invalid or missing status falls back to unknown', () => {
  const xml = `<?xml version="1.0"?>
<pfif:pfif xmlns:pfif="http://zesty.ca/pfif/1.4">
  <pfif:person>
    <pfif:person_record_id>x1</pfif:person_record_id>
    <pfif:entry_date>2026-10-24T08:30:00Z</pfif:entry_date>
    <pfif:full_name>Bad Status</pfif:full_name>
  </pfif:person>
  <pfif:note>
    <pfif:person_record_id>x1</pfif:person_record_id>
    <pfif:status>made_up_value</pfif:status>
  </pfif:note>
</pfif:pfif>`;
  const [r] = fromPfif(xml);
  assert.equal(r.id, 'x1');
  assert.equal(r.fullName, 'Bad Status');
  assert.equal(r.status, 'unknown');
});

test('control characters are dropped so the XML stays valid', () => {
  const xml = toPfif([rec({ note: 'a\u0001b' })], NOW);
  assert.ok(!xml.includes('\u0001'));
  assert.equal(fromPfif(xml)[0].note, 'ab');
});
