import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_CARD_LENGTH, buildCardText, buildVCard, qrMatrix, type MedicalCardProfile } from '../medicalCard';

const profile = (over: Partial<MedicalCardProfile> = {}): MedicalCardProfile => ({
  fullName: 'Asha Devi',
  bloodGroup: 'B+',
  allergies: 'Penicillin',
  conditions: 'Asthma',
  medicines: 'Inhaler',
  notes: 'Wears glasses',
  contacts: [{ name: 'Ravi', phone: '+911234567890' }],
  ...over,
});

test('card text keeps the responder order and ends with the call line', () => {
  const text = buildCardText(profile(), 'en');
  const order = ['Name: Asha Devi', 'Blood group: B+', 'Allergies: Penicillin', 'Conditions: Asthma', 'Medicines: Inhaler', 'Emergency contacts: Ravi +911234567890', 'Call 112'];
  let at = -1;
  for (const part of order) {
    const next = text.indexOf(part);
    assert.ok(next > at, `${part} should come after the previous field`);
    at = next;
  }
  assert.ok(text.endsWith('Call 112'));
  assert.ok(!text.includes('Notes:'), 'notes stay out of the compact QR text');
});

test('empty fields are skipped and an empty profile still tells people how to call', () => {
  const text = buildCardText(profile({ fullName: '', bloodGroup: '', allergies: '', conditions: '', medicines: '', notes: '', contacts: [] }), 'en');
  assert.equal(text, 'Call 112');
  assert.ok(!text.includes('Name:'));
  assert.ok(!text.includes('Blood group:'));
});

test('contacts without a phone number never become a blank line', () => {
  const text = buildCardText(profile({ contacts: [{ name: 'Ravi', phone: '   ' }] }), 'en');
  assert.ok(!text.includes('Emergency contacts:'));
});

test('the length cap holds and allergies and blood group survive heavy truncation', () => {
  const text = buildCardText(
    profile({
      fullName: 'A'.repeat(300),
      allergies: `Penicillin ${'x'.repeat(500)}`,
      conditions: `Asthma ${'y'.repeat(500)}`,
      medicines: `Inhaler ${'z'.repeat(500)}`,
      contacts: [{ name: 'Ravi', phone: '+911234567890' }],
    }),
    'en',
  );
  assert.ok(text.length <= MAX_CARD_LENGTH, `length was ${text.length}`);
  assert.ok(text.includes('Blood group: B+'));
  assert.ok(text.includes('Allergies: Penicillin'), 'the start of the allergy list is kept');
  assert.ok(text.includes('…'), 'long fields end in an ellipsis');
  assert.ok(text.endsWith('Call 112'));
});

test('Hindi labels are used when asked', () => {
  const text = buildCardText(profile(), 'hi');
  assert.ok(text.includes('रक्त समूह: B+'));
  assert.ok(text.includes('एलर्जी: Penicillin'));
  assert.ok(text.endsWith('112 पर कॉल करें'));
});

test('vCard is 3.0 with an escaped FN, NOTE and one TEL per contact', () => {
  const card = buildVCard(profile());
  assert.ok(card.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\n'));
  assert.ok(card.includes('FN:Asha Devi\r\n'));
  assert.ok(card.includes('NOTE:Name: Asha Devi\\nBlood group: B+'));
  assert.ok(card.includes('TEL;TYPE=CELL:+911234567890\r\n'));
  assert.ok(card.endsWith('END:VCARD\r\n'));
});

test('vCard escapes commas, semicolons, newlines and backslashes', () => {
  const card = buildVCard(
    profile({
      fullName: 'Asha, Devi; Ravi\nKumar',
      notes: 'First line, with a comma; and a semicolon\nsecond line with a \\ backslash',
      contacts: [{ name: 'Ravi', phone: '+91,123;456' }],
    }),
  );
  assert.ok(card.includes('FN:Asha\\, Devi\\; Ravi Kumar\r\n'), 'line breaks in a name collapse to spaces');
  assert.ok(card.includes('\\, with a comma\\; and a semicolon second line with a \\\\ backslash'));
  assert.ok(card.includes('TEL;TYPE=CELL:+91\\,123\\;456\r\n'));
  for (const line of card.split('\r\n').filter(Boolean)) {
    assert.match(line, /^(BEGIN|VERSION|FN|N|NOTE|TEL|END)[;:]/, `stray line break inside a value: ${line}`);
  }
});

const finderOk = (m: boolean[][], top: number, left: number): boolean => {
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const border = y === 0 || y === 6 || x === 0 || x === 6;
      const center = y >= 2 && y <= 4 && x >= 2 && x <= 4;
      if (m[top + y][left + x] !== (border || center)) return false;
    }
  }
  return true;
};

test('qrMatrix is square with the three finder patterns in the corners', () => {
  const m = qrMatrix(buildCardText(profile(), 'en'));
  const n = m.length;
  assert.ok(n >= 21, `matrix should be a real QR, got ${n}`);
  assert.equal((n - 21) % 4, 0, 'QR size is 21 + 4 per version step');
  for (const row of m) {
    assert.equal(row.length, n);
    assert.ok(row.every((v) => typeof v === 'boolean'));
  }
  assert.ok(finderOk(m, 0, 0), 'top-left finder');
  assert.ok(finderOk(m, 0, n - 7), 'top-right finder');
  assert.ok(finderOk(m, n - 7, 0), 'bottom-left finder');
});
