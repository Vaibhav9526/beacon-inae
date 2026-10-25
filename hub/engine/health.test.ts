import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { HealthStore, newKey, STALE_MS } from './healthStore.ts';
import { healthMetrics } from './healthMetrics.ts';
import { parseHealthCsv } from './csvImport.ts';

const tmpRoot = mkdtempSync(`${process.env.TEMP ?? process.env.TMPDIR ?? '/tmp'}/beacon-health-`);
after(() => rmSync(tmpRoot, { recursive: true, force: true }));
const file = (name: string) => `${tmpRoot}/${name}`;

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

test('round trip keeps readings, members and latest values', () => {
  const key = newKey();
  assert.equal(key.length, 32);
  const f = file('roundtrip.enc');
  const s = new HealthStore(f, key);
  s.addMany([
    { member: 'Maa', at: NOW - 3 * HOUR, hr: 72, spo2: 97 },
    { member: 'Maa', at: NOW - 1 * HOUR, steps: 4200, sleepHours: 6.5 },
    { member: 'Papa', at: NOW - 2 * HOUR, hr: 80 },
  ]);
  s.save();

  const loaded = HealthStore.load(f, key);
  assert.deepEqual(loaded.members().sort(), ['Maa', 'Papa']);
  assert.deepEqual(loaded.latest('Maa', NOW), {
    member: 'Maa', at: NOW - 1 * HOUR, hr: 72, spo2: 97, steps: 4200, sleepHours: 6.5,
  });
  assert.equal(loaded.history('Maa', NOW - 2 * HOUR).length, 1);
  assert.equal(loaded.history('Maa', 0).length, 2);
  assert.equal(loaded.latest('Nobody', NOW), undefined);
});

test('load of a missing file gives an empty store', () => {
  const s = HealthStore.load(file('does-not-exist.enc'), newKey());
  assert.deepEqual(s.members(), []);
});

test('wrong key throws a clear error', () => {
  const f = file('wrongkey.enc');
  const good = newKey();
  const s = new HealthStore(f, good);
  s.add({ member: 'Maa', at: NOW, hr: 70 });
  s.save();
  assert.throws(() => HealthStore.load(f, newKey()), { message: 'Health data could not be decrypted' });
});

test('tampered file throws a clear error', () => {
  const f = file('tamper.enc');
  const key = newKey();
  const s = new HealthStore(f, key);
  s.add({ member: 'Maa', at: NOW, hr: 70 });
  s.save();

  const original = readFileSync(f);
  const ctByte = Buffer.from(original);
  ctByte[ctByte.length - 1] ^= 0x01; // flip a ciphertext bit
  writeFileSync(f, ctByte);
  assert.throws(() => HealthStore.load(f, key), { message: 'Health data could not be decrypted' });

  const tagByte = Buffer.from(original);
  tagByte[12] ^= 0x01; // flip a tag bit
  writeFileSync(f, tagByte);
  assert.throws(() => HealthStore.load(f, key), { message: 'Health data could not be decrypted' });

  writeFileSync(f, original.subarray(0, 10)); // truncated
  assert.throws(() => HealthStore.load(f, key), { message: 'Health data could not be decrypted' });
});

test('store keeps at most 5000 readings per member, dropping the oldest', () => {
  const s = new HealthStore(file('cap.enc'), newKey());
  for (let i = 0; i < 5001; i++) s.add({ member: 'Maa', at: NOW - (5001 - i) * 1000, hr: 60 + (i % 5) });
  const h = s.history('Maa', 0);
  assert.equal(h.length, 5000);
  assert.equal(h[0].at, NOW - 5000 * 1000);
});

test('latest ignores readings older than 48h and merges newest value per field', () => {
  const s = new HealthStore(file('stale.enc'), newKey());
  s.add({ member: 'Maa', at: NOW - (STALE_MS + HOUR), hr: 150, spo2: 80 }); // too old, ignored
  assert.equal(s.latest('Maa', NOW), undefined);

  s.add({ member: 'Maa', at: NOW - 47 * HOUR, spo2: 95, steps: 1000 }); // fresh, but older
  s.add({ member: 'Maa', at: NOW - 1 * HOUR, hr: 88 }); // newest, hr only
  const r = s.latest('Maa', NOW);
  assert.equal(r?.hr, 88);
  assert.equal(r?.spo2, 95);
  assert.equal(r?.steps, 1000);
  assert.equal(r?.at, NOW - 1 * HOUR);

  // Same data, but read 2 days later: everything is stale now.
  assert.equal(s.latest('Maa', NOW + 2 * 24 * HOUR), undefined);
});

test('healthMetrics thresholds and omission', () => {
  const cases: Array<[{ hr?: number; spo2?: number }, number]> = [
    [{ hr: 72, spo2: 98 }, 0],
    [{ hr: 105, spo2: 98 }, 1],
    [{ hr: 40, spo2: 98 }, 1],
    [{ hr: 70, spo2: 93 }, 1],
    [{ hr: 121, spo2: 98 }, 2],
    [{ hr: 70, spo2: 89 }, 2],
  ];
  for (const [i, [vals, expected]] of cases.entries()) {
    const s = new HealthStore(file(`thr-${i}.enc`), newKey());
    s.add({ member: 'Maa', at: NOW - HOUR, ...vals });
    const m = healthMetrics(s, ['Maa', 'Papa'], NOW);
    assert.equal(m['health_status:Maa'], expected, JSON.stringify(vals));
    assert.equal(m['hr:Maa'], vals.hr);
    assert.equal(m['spo2:Maa'], vals.spo2);
    assert.equal('hr:Papa' in m, false);
    assert.equal('health_status:Papa' in m, false);
  }

  const s = new HealthStore(file('metrics-all.enc'), newKey());
  s.add({ member: 'Maa', at: NOW - HOUR, hr: 90, spo2: 96, steps: 3000, sleepHours: 7 });
  assert.deepEqual(healthMetrics(s, ['Maa'], NOW), {
    'hr:Maa': 90, 'spo2:Maa': 96, 'steps:Maa': 3000, 'sleep_h:Maa': 7, 'health_status:Maa': 0,
  });
});

test('CSV: member/time/ISO with CRLF and quoted names', () => {
  const csv = [
    'member,time,hr,spo2,steps,sleep',
    '"Maa, senior",2026-10-25T07:00:00Z,72,97,1200,6.5',
    'Papa,2026-10-25T08:00:00+05:30,118,,,',
    '',
  ].join('\r\n');
  const { readings, skipped } = parseHealthCsv(csv);
  assert.equal(skipped, 0);
  assert.deepEqual(readings, [
    { member: 'Maa, senior', at: Date.UTC(2026, 9, 25, 7), hr: 72, spo2: 97, steps: 1200, sleepHours: 6.5 },
    { member: 'Papa', at: Date.UTC(2026, 9, 25, 2, 30), hr: 118 },
  ]);
});

test('CSV: name/timestamp/heart_rate/oxygen with epoch seconds, default member', () => {
  const t = Math.floor(NOW / 1000);
  const csv = `﻿name,timestamp,heart_rate,oxygen\n,${t},64,99\n`;
  const { readings, skipped } = parseHealthCsv(csv);
  assert.equal(skipped, 0);
  assert.deepEqual(readings, [{ member: 'Maa', at: t * 1000, hr: 64, spo2: 99 }]);
});

test('CSV: person/datetime/pulse/o2/sleep_hours with epoch ms, bad rows skipped', () => {
  const ms = NOW;
  const csv = [
    'Person,datetime,pulse,o2,sleep_hours',
    `Dada,${ms},55,,`,
    `Dada,not a date,60,95,`,
    `Dada,${ms},,,`,
    `Dada,${ms},,,7.25`,
  ].join('\n');
  const { readings, skipped } = parseHealthCsv(csv, 'Maa');
  assert.equal(skipped, 2);
  assert.deepEqual(readings, [
    { member: 'Dada', at: ms, hr: 55 },
    { member: 'Dada', at: ms, sleepHours: 7.25 },
  ]);
});

test('CSV: quoted field with escaped quote and embedded newline', () => {
  const csv = 'name,date,steps\r\n"Ma ""Ji""",2026-10-25,"4,500"\r\n';
  const { readings } = parseHealthCsv(csv);
  assert.deepEqual(readings, [{ member: 'Ma "Ji"', at: Date.parse('2026-10-25'), steps: 4500 }]);
});
