import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FallDetector, type FallSample, useFallAlert } from '../fall';

const STEP_MS = 50; // 20 Hz

const sample = (t: number, mag: number): FallSample => ({ t, x: mag, y: 0, z: 0 });

/** Near-1 g samples with tiny ripple, low variance. */
function still(start: number, ms: number, mag = 1): FallSample[] {
  const out: FallSample[] = [];
  for (let t = start; t <= start + ms; t += STEP_MS) {
    out.push(sample(t, mag + ((t / STEP_MS) % 3 - 1) * 0.01));
  }
  return out;
}

/** Hard fall: 150 ms free fall, 3.2 g impact, then six seconds still. Fall is reported at about start + 7200. */
function fallStream(start: number): FallSample[] {
  return [
    ...still(start, 950),
    sample(start + 1000, 0.2),
    sample(start + 1050, 0.2),
    sample(start + 1100, 0.2),
    sample(start + 1150, 3.2),
    ...still(start + 1200, 6000),
  ];
}

/** Deterministic pseudo-random generator so the tests are repeatable. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function feed(detector: FallDetector, samples: FallSample[]): number[] {
  const events: number[] = [];
  for (const s of samples) {
    if (detector.push(s) === 'fall') events.push(s.t);
  }
  return events;
}

test('detects a hard fall followed by six seconds of stillness', () => {
  const events = feed(new FallDetector(), fallStream(0));
  assert.equal(events.length, 1);
  assert.ok(events[0] >= 7000 && events[0] <= 7300, `unexpected fall time ${events[0]}`);
});

test('does not fire when the person lies still for less than six seconds', () => {
  const samples = [
    ...still(0, 950),
    sample(1000, 0.2),
    sample(1050, 0.2),
    sample(1100, 0.2),
    sample(1150, 3.2),
    ...still(1200, 5000),
    sample(6250, 1.6), // a movement breaks the stillness
    ...still(6300, 5000),
  ];
  assert.deepEqual(feed(new FallDetector(), samples), []);
});

test('does not fire for ordinary walking (2 steps per second, 0.6-1.8 g)', () => {
  const samples: FallSample[] = [];
  for (let t = 0; t <= 12000; t += STEP_MS) {
    const a = (t / STEP_MS) * ((2 * Math.PI) / 10); // 2 Hz step rate at 20 Hz sampling
    samples.push(sample(t, 1 + 0.4 * Math.sin(a) + 0.15 * Math.sin(2 * a)));
  }
  assert.deepEqual(feed(new FallDetector(), samples), []);
});

test('does not fire when walking stops and the person stands still', () => {
  const samples: FallSample[] = [];
  for (let t = 0; t <= 6000; t += STEP_MS) {
    const a = (t / STEP_MS) * ((2 * Math.PI) / 10);
    samples.push(sample(t, 1 + 0.4 * Math.sin(a) + 0.15 * Math.sin(2 * a)));
  }
  samples.push(...still(6050, 12000));
  assert.deepEqual(feed(new FallDetector(), samples), []);
});

test('does not fire for a repeating shake with dips and spikes', () => {
  const samples: FallSample[] = [];
  for (let t = 0; t <= 12000; t += STEP_MS) {
    const i = t / STEP_MS;
    // 150 ms dips followed by 3 g spikes, over and over: each spike resets the stillness check
    samples.push(sample(t, i % 4 === 3 ? 3.0 : 0.2));
  }
  assert.deepEqual(feed(new FallDetector(), samples), []);
});

test('does not fire for vigorous random shaking between 0.2 and 3.5 g', () => {
  const rand = rng(7);
  const samples: FallSample[] = [];
  for (let t = 0; t <= 20000; t += STEP_MS) {
    samples.push(sample(t, 0.2 + rand() * 3.3));
  }
  assert.deepEqual(feed(new FallDetector(), samples), []);
});

test('does not fire when a dropped phone lands on a bed and is then moved', () => {
  const samples: FallSample[] = [
    ...still(0, 950),
    sample(1000, 0.2),
    sample(1050, 0.2),
    sample(1100, 0.2),
    sample(1150, 3.1),
  ];
  for (let t = 1200; t <= 9200; t += STEP_MS) {
    const i = (t - 1200) / STEP_MS;
    samples.push(sample(t, 1 + 0.35 * Math.sin(i * 1.7)));
  }
  assert.deepEqual(feed(new FallDetector(), samples), []);
});

test('a single low sample is not a free fall', () => {
  const samples = [...still(0, 950), sample(1000, 0.1), ...still(1050, 7000)];
  assert.deepEqual(feed(new FallDetector(), samples), []);
});

test('ignores non-finite samples without crashing', () => {
  const detector = new FallDetector();
  assert.equal(detector.push({ t: 0, x: NaN, y: 0, z: 0 }), null);
  assert.equal(detector.push({ t: 50, x: 0, y: 0, z: Infinity }), null);
  assert.deepEqual(feed(detector, fallStream(100)).length, 1);
});

test('ignores another fall during the 60 second cooldown, then detects again', () => {
  const detector = new FallDetector();
  assert.equal(feed(detector, fallStream(0)).length, 1);
  assert.deepEqual(feed(detector, fallStream(30000)), []);
  assert.equal(feed(detector, fallStream(70000)).length, 1);
});

test('reset() clears the cooldown so a fall right after is detected', () => {
  const detector = new FallDetector();
  assert.equal(feed(detector, fallStream(0)).length, 1);
  detector.reset();
  assert.equal(feed(detector, fallStream(20000)).length, 1);
});

test('the alert store keeps only the first pending fall and clears on demand', () => {
  const store = useFallAlert.getState();
  store.clear();
  store.raise(1000);
  store.raise(2000);
  assert.equal(useFallAlert.getState().at, 1000);
  useFallAlert.getState().clear();
  assert.equal(useFallAlert.getState().at, null);
});
