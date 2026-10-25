import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { beaconSchedule, beaconWav, isOnAt, matchScore, SignalTracker, sosEnvelope } from '../locator';

const expect = (v: unknown) => ({
  toBe: (e: unknown) => assert.equal(v, e),
  toHaveLength: (n: number) => assert.equal((v as unknown[]).length, n),
  toBeGreaterThan: (n: number) => assert.ok((v as number) > n, `${v} > ${n}`),
});

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FLOOR = -50;
/** A metering stream of `seconds` at 100 ms: beacon rhythm (scaled by `tempo`, shifted by `offsetMs`) over noise. */
function beaconStream(seconds: number, o: { tempo?: number; offsetMs?: number; amp?: number; noise?: number; seed?: number } = {}) {
  const { tempo = 1, offsetMs = 0, amp = 30, noise = 1.5, seed = 1 } = o;
  const r = rng(seed);
  const steps = sosEnvelope();
  const out: number[] = [];
  for (let i = 0; i < seconds * 10; i++) {
    const on = isOnAt(steps, (i * 100 + offsetMs) / tempo);
    out.push(FLOOR + (on ? amp : 0) + (r() - 0.5) * 2 * noise);
  }
  return out;
}

function run(stream: number[]) {
  const t = new SignalTracker();
  let last = t.push(stream[0], 0);
  const seen = new Set<string>();
  stream.forEach((d, i) => {
    last = t.push(d, i * 100);
    seen.add(last.state);
  });
  return { last, seen };
}

describe('schedule', () => {
  it('is SOS then a 2 s gap', () => {
    const b = beaconSchedule();
    expect(b.steps.filter((s) => s.on)).toHaveLength(9);
    expect(b.periodMs).toBe(27 * 150 + 2000);
    expect(isOnAt(b.steps, 10)).toBe(true);
    expect(isOnAt(b.steps, 200)).toBe(false);
    expect(isOnAt(b.steps, b.periodMs - 100)).toBe(false);
  });
  it('makes a WAV', () => {
    expect(beaconWav().startsWith('UklGR')).toBe(true);
  });
});

describe('matchScore', () => {
  it('scores the clean rhythm high and constants zero', () => {
    const env = beaconStream(12, { noise: 0 }).map((d) => (d > FLOOR + 10 ? 1 : 0));
    expect(matchScore(env)).toBeGreaterThan(0.85);
    expect(matchScore(new Array(120).fill(1))).toBe(0);
    expect(matchScore(new Array(120).fill(0))).toBe(0);
  });
});

describe('SignalTracker', () => {
  it('finds a clean SOS rhythm', () => {
    const { last } = run(beaconStream(30));
    expect(last.state).toBe('found');
    expect(last.strength).toBeGreaterThan(60);
  });
  it('finds it with 12 percent tempo drift', () => {
    expect(run(beaconStream(35, { tempo: 1.12 })).last.state).toBe('found');
    expect(run(beaconStream(35, { tempo: 0.88 })).last.state).toBe('found');
  });
  it('finds it at any time offset', () => {
    for (const offsetMs of [300, 1700, 3333]) expect(run(beaconStream(30, { offsetMs })).last.state).toBe('found');
  });
  it('stays searching with strength 0 in silence', () => {
    const { last, seen } = run(new Array(400).fill(-60));
    expect(last.state).toBe('searching');
    expect(last.strength).toBe(0);
    expect(seen.has('found')).toBe(false);
  });
  it('does not find loud constant machinery', () => {
    const r = rng(7);
    const s = Array.from({ length: 400 }, () => -20 + (r() - 0.5) * 6);
    expect(run(s).seen.has('found')).toBe(false);
  });
  it('never finds random noise bursts (1000 trials)', () => {
    const r = rng(12345);
    let hits = 0;
    for (let k = 0; k < 1000; k++) {
      const s: number[] = [];
      let on = false;
      let left = 0;
      while (s.length < 200) {
        if (left <= 0) {
          on = !on;
          left = 1 + Math.floor(r() * (on ? 12 : 25));
        }
        s.push(FLOOR + (on ? 25 : 0) + (r() - 0.5) * 3);
        left--;
      }
      if (run(s).seen.has('found')) hits++;
    }
    expect(hits).toBe(0);
  });
  it('gives at most "maybe" for a weak rhythm near the noise floor', () => {
    const { seen } = run(beaconStream(40, { amp: 4, noise: 4, seed: 5 }));
    expect(seen.has('found')).toBe(false);
  });
  it('resets', () => {
    const t = new SignalTracker();
    beaconStream(30).forEach((d, i) => t.push(d, i * 100));
    t.reset();
    expect(t.push(-60, 0).strength).toBe(0);
  });
});
