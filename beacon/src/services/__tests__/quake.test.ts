import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ShakeEvent } from '../../mesh/appTypes';
import { consensus, type QuakeSample, ShakeDetector } from '../quake';

const STEP = 40; // 25 Hz

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  };
}

/** Build a stream: still with noise for `leadMs`, then `fn(tSinceOnset)` residual added on x/y/z. */
function stream(
  leadMs: number,
  durMs: number,
  fn: (ms: number, r: () => number) => [number, number, number],
  noise = 0.003,
  seed = 7,
): QuakeSample[] {
  const r = rng(seed);
  const out: QuakeSample[] = [];
  for (let t = 0; t <= leadMs + durMs; t += STEP) {
    const [dx, dy, dz] = t < leadMs ? [0, 0, 0] : fn(t - leadMs, r);
    out.push({ t, x: dx + r() * noise, y: dy + r() * noise, z: 1 + dz + r() * noise });
  }
  return out;
}

function run(samples: QuakeSample[]) {
  const d = new ShakeDetector();
  const hits: { at: number; peakMg: number; startedAt: number }[] = [];
  for (const s of samples) {
    const h = d.push(s);
    if (h) hits.push({ at: s.t, ...h });
  }
  return hits;
}

test('earthquake-like decaying 4 Hz shaking triggers', () => {
  const hits = run(
    stream(8000, 8000, (ms, r) => {
      const a = 0.25 * Math.exp(-ms / 4000);
      const w = 2 * Math.PI * 4 * (ms / 1000);
      return [a * Math.sin(w) + r() * 0.02, a * 0.6 * Math.sin(w + 1) + r() * 0.02, a * 0.4 * Math.sin(w + 2)];
    }),
  );
  assert.equal(hits.length, 1);
  assert.ok(hits[0].peakMg >= 60, `peak ${hits[0].peakMg}`);
  assert.ok(hits[0].startedAt >= 7900 && hits[0].startedAt <= 8600, `start ${hits[0].startedAt}`);
});

test('a single spike (phone dropped) does not trigger', () => {
  const hits = run(stream(8000, 6000, (ms) => [0, 0, ms < 80 ? 3 : ms < 200 ? -0.6 * Math.exp(-(ms - 80) / 40) : 0]));
  assert.equal(hits.length, 0);
});

test('regular 2 Hz walking after standing still does not trigger', () => {
  const hits = run(stream(8000, 10000, (ms) => [0, 0, 0.25 * Math.sin(2 * Math.PI * 2 * (ms / 1000))]));
  assert.equal(hits.length, 0);
});

test('a phone in a moving vehicle does not trigger', () => {
  const hits = run(stream(0, 40000, (ms, r) => [r() * 0.12, r() * 0.12, r() * 0.12 + (ms % 7000 < 100 ? 0.3 : 0)], 0.03));
  assert.equal(hits.length, 0);
});

test('idle noise does not trigger', () => {
  assert.equal(run(stream(0, 60000, () => [0, 0, 0])).length, 0);
});

test('a constant tilt change does not trigger', () => {
  const hits = run(stream(8000, 10000, () => [0.5, 0, -0.13]));
  assert.equal(hits.length, 0);
});

test('stays quiet for the 120 s cooldown, then can trigger again', () => {
  const quake = (ms: number, r: () => number): [number, number, number] => {
    const a = 0.25 * Math.exp(-ms / 4000);
    return [a * Math.sin(2 * Math.PI * 4 * (ms / 1000)) + r() * 0.02, 0, 0];
  };
  const mk = (offset: number) => stream(8000, 8000, quake, 0.003, 3).map((s) => ({ ...s, t: s.t + offset }));
  const d = new ShakeDetector();
  const hits: number[] = [];
  const feed = (ss: QuakeSample[]) => ss.forEach((s) => d.push(s) && hits.push(s.t));
  feed(mk(0));
  feed(mk(40_000)); // second quake inside cooldown
  assert.equal(hits.length, 1);
  feed(mk(200_000)); // well after cooldown
  assert.equal(hits.length, 2);
});

// ------------------------------------------------------------ consensus

const ev = (from: string, receivedAt: number, over: Partial<ShakeEvent['vote']> = {}): ShakeEvent => ({
  from,
  hops: 1,
  receivedAt,
  vote: { id: from + receivedAt, lat: 28.61, lon: 77.2, peakMg: 80, startedAt: receivedAt, ...over },
});

test('three phones inside the window confirm', () => {
  const v = consensus([ev('a', 1000), ev('b', 4000), ev('c', 9000)], null, 10_000);
  assert.equal(v.level, 'confirmed');
  assert.equal(v.confirmed, true);
  assert.equal(v.phones, 3);
});

test('own vote counts as a phone', () => {
  const own = { id: 'o', lat: 28.61, lon: 77.2, peakMg: 90, startedAt: 2000 };
  assert.equal(consensus([ev('a', 1000), ev('b', 4000)], own, 10_000).level, 'confirmed');
});

test('two phones are only possible', () => {
  const v = consensus([ev('a', 1000), ev('b', 4000)], null, 10_000);
  assert.equal(v.level, 'possible');
  assert.equal(v.confirmed, false);
});

test('votes spread over 60 s do not confirm', () => {
  const v = consensus([ev('a', 1000), ev('b', 31_000), ev('c', 61_000)], null, 61_000);
  assert.notEqual(v.level, 'confirmed');
});

test('phones 50 km apart do not confirm', () => {
  const v = consensus([ev('a', 1000), ev('b', 2000, { lat: 28.61, lon: 77.7 }), ev('c', 3000, { lat: 29.1, lon: 77.2 })], null, 5000);
  assert.notEqual(v.level, 'confirmed');
});

test('duplicate sender counts once', () => {
  const v = consensus([ev('a', 1000), ev('a', 2000), ev('b', 3000)], null, 5000);
  assert.equal(v.phones, 2);
  assert.equal(v.level, 'possible');
});

test('malformed votes are ignored', () => {
  const v = consensus(
    [ev('a', 1000), ev('b', 2000, { lat: NaN }), ev('c', 3000, { lon: 400 }), ev('d', 3500, { peakMg: NaN }), { from: 'e' } as unknown as ShakeEvent],
    null,
    5000,
  );
  assert.equal(v.phones, 1);
  assert.equal(v.level, 'possible');
});

test('weak shaking from three phones stays possible', () => {
  const weak = { peakMg: 30 };
  const v = consensus([ev('a', 1000, weak), ev('b', 2000, weak), ev('c', 3000, weak)], null, 5000);
  assert.equal(v.level, 'possible');
});

test('no votes gives none', () => {
  assert.equal(consensus([], null, 1000).level, 'none');
});
