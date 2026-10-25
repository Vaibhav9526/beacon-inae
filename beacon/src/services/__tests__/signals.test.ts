import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeToneWav, morse, sosPattern, strobeSchedule } from '../signals';

test('morse uses 1:3:7 timing for dots, dashes, letter and word gaps', () => {
  // A = .-  : dot(1 on), gap(1 off), dash(3 on)
  assert.deepEqual(morse('A'), [
    { on: true, units: 1 },
    { on: false, units: 1 },
    { on: true, units: 3 },
  ]);
  // E E : dot, letter gap 3, dot
  assert.deepEqual(morse('E E'), [
    { on: true, units: 1 },
    { on: false, units: 7 },
    { on: true, units: 1 },
  ]);
  // E T : letter gap is 3, not 7
  assert.deepEqual(morse('ET').filter((s) => !s.on).map((s) => s.units), [3]);
});

test('morse skips unknown characters and has no trailing gap', () => {
  const steps = morse('a?!');
  assert.deepEqual(steps, morse('A'));
  assert.equal(steps[steps.length - 1].on, true);
  assert.deepEqual(morse('   '), []);
});

test('sosPattern is ... --- ... with standard timing', () => {
  const s = sosPattern();
  const on = s.filter((x) => x.on).map((x) => x.units);
  assert.deepEqual(on, [1, 1, 1, 3, 3, 3, 1, 1, 1]);
  // three letter gaps of 3 units and two inner gaps per letter
  assert.equal(s.filter((x) => !x.on && x.units === 3).length, 2);
  assert.equal(s.filter((x) => !x.on && x.units === 1).length, 6);
});

test('strobeSchedule converts units to milliseconds and keeps on/off', () => {
  const sched = strobeSchedule(sosPattern(), 100);
  assert.equal(sched[0].ms, 100);
  assert.equal(sched[0].on, true);
  assert.equal(
    sched.reduce((t, x) => t + x.ms, 0),
    sosPattern().reduce((t, x) => t + x.units * 100, 0),
  );
  assert.deepEqual(
    sched.map((x) => x.on),
    sosPattern().map((x) => x.on),
  );
});

test('makeToneWav returns a valid 16-bit mono PCM WAV of the requested length', () => {
  const b64 = makeToneWav(880, 500, 8000);
  const bytes = Buffer.from(b64, 'base64');
  const samples = 4000; // 8000 Hz * 0.5 s
  assert.equal(bytes.length, 44 + samples * 2);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.readUInt32LE(4), 36 + samples * 2);
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  assert.equal(bytes.toString('ascii', 12, 16), 'fmt ');
  assert.equal(bytes.readUInt32LE(16), 16);
  assert.equal(bytes.readUInt16LE(20), 1); // PCM
  assert.equal(bytes.readUInt16LE(22), 1); // mono
  assert.equal(bytes.readUInt32LE(24), 8000);
  assert.equal(bytes.readUInt32LE(28), 16000);
  assert.equal(bytes.readUInt16LE(32), 2);
  assert.equal(bytes.readUInt16LE(34), 16);
  assert.equal(bytes.toString('ascii', 36, 40), 'data');
  assert.equal(bytes.readUInt32LE(40), samples * 2);
  // the tone is not silent
  let peak = 0;
  for (let i = 44; i < bytes.length; i += 2) peak = Math.max(peak, Math.abs(bytes.readInt16LE(i)));
  assert.ok(peak > 10000, `peak ${peak}`);
});

test('makeToneWav default sample rate is 8000 and base64 round-trips', () => {
  const b64 = makeToneWav(440, 100);
  assert.match(b64, /^[A-Za-z0-9+/]+={0,2}$/);
  const bytes = Buffer.from(b64, 'base64');
  assert.equal(bytes.readUInt32LE(24), 8000);
  assert.equal(bytes.length, 44 + 800 * 2);
});
