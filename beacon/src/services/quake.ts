import type { ShakeEvent, ShakeVerdict, ShakeVote } from '../mesh/appTypes';

/**
 * Shake warning: pure detector and consensus. No react-native imports so it runs in unit tests.
 *
 * This is a phone-to-phone estimate. It never replaces official alerts. The thresholds below are
 * educated starting points, not tuned on shake-table or field data.
 */

export interface QuakeSample {
  /** Milliseconds. */
  t: number;
  /** Acceleration in g, including gravity. */
  x: number;
  y: number;
  z: number;
}

export interface QuakeTrigger {
  /** Strongest residual (gravity removed) in milli-g. */
  peakMg: number;
  /** When the shaking started (ms). */
  startedAt: number;
}

export const QUAKE = {
  /** Gravity estimate time constant. Slow, so 3-6 Hz shaking passes and a tilt fades. */
  gravityTauMs: 2000,
  staMs: 500,
  ltaMs: 8000,
  /** The long-term average ignores the newest 2 s so the quake itself does not raise its own baseline. */
  ltaSkipMs: 2000,
  ltaFloorG: 0.004,
  triggerRatio: 4,
  /** Short-term average needed even if the ratio is high. */
  minStaG: 0.02,
  peakG: 0.06,
  sustainMs: 1500,
  segmentMs: 500,
  /** Each half second of the sustained window must average at least this. */
  segmentMinG: 0.02,
  minCrossings: 4,
  crossHystG: 0.01,
  /** Peak over rms of the window: a drop is far above this, shaking is not. */
  maxPeakToRms: 6,
  /** The phone must have been still: mean residual below this over the last 5 s before onset. */
  quietG: 0.02,
  quietMs: 5000,
  /** Walking and running are regular steps at this rate. */
  walkHzMin: 1.2,
  walkHzMax: 2.8,
  /** Zero-crossing interval variation below this counts as rhythmic. */
  walkRegularCv: 0.3,
  cooldownMs: 120_000,
  retryLockMs: 3000,
  maxGapMs: 500,
  bufferMs: 14_000,
} as const;

interface Rec {
  t: number;
  rx: number;
  ry: number;
  rz: number;
  r: number;
}

const mean = (a: number[]): number => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

/** Crossings of ±hysteresis on one axis, and the intervals between them. */
function crossings(vals: number[], times: number[], hyst: number): { count: number; intervals: number[] } {
  let state = 0;
  let last = -1;
  let count = 0;
  const intervals: number[] = [];
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    const s = v > hyst ? 1 : v < -hyst ? -1 : 0;
    if (s === 0 || s === state) continue;
    if (state !== 0) {
      count++;
      if (last >= 0) intervals.push(times[i] - last);
      last = times[i];
    }
    state = s;
  }
  return { count, intervals };
}

/**
 * Earthquake-like shaking detector. Feed it samples at about 20-50 Hz.
 *
 * 1. Gravity is removed with a slow exponential average; the residual vector length is the signal.
 * 2. STA/LTA (0.5 s over 8 s) must reach 4, with the short average at least 0.02 g.
 * 3. The phone must have been still for 5 s before (no walking, no vehicle).
 * 4. The shaking must last 1.5 s, every half second strong, peak at least 0.06 g, with several
 *    zero crossings (oscillation, not one impact or a tilt).
 * 5. Regular 1.2-2.8 Hz oscillation (steps) is rejected.
 * Then it stays quiet for 120 s.
 */
export class ShakeDetector {
  private buf: Rec[] = [];
  private g: [number, number, number] | null = null;
  private lastT = -1;
  private cooldownUntil = 0;
  private lockUntil = 0;
  private cand: { t0: number; startedAt: number; lta: number } | null = null;

  push(s: QuakeSample): QuakeTrigger | null {
    const { t, x, y, z } = s;
    if (![t, x, y, z].every(Number.isFinite)) return null;
    if (this.lastT >= 0 && (t - this.lastT > QUAKE.maxGapMs || t <= this.lastT)) {
      if (t > this.lastT) this.clearHistory();
      else return null; // out of order
    }
    const dt = this.lastT >= 0 ? t - this.lastT : 0;
    this.lastT = t;

    if (!this.g) this.g = [x, y, z];
    else {
      const a = 1 - Math.exp(-dt / QUAKE.gravityTauMs);
      this.g[0] += a * (x - this.g[0]);
      this.g[1] += a * (y - this.g[1]);
      this.g[2] += a * (z - this.g[2]);
    }
    const rx = x - this.g[0];
    const ry = y - this.g[1];
    const rz = z - this.g[2];
    this.buf.push({ t, rx, ry, rz, r: Math.hypot(rx, ry, rz) });
    while (this.buf.length && this.buf[0].t < t - QUAKE.bufferMs) this.buf.shift();

    if (t < this.cooldownUntil || t < this.lockUntil) {
      this.cand = null;
      return null;
    }

    if (!this.cand) {
      this.tryStart(t);
      return null;
    }
    if (t - this.cand.t0 < QUAKE.sustainMs) return null;

    const c = this.cand;
    this.cand = null;
    const out = this.evaluate(c, t);
    if (out) {
      this.cooldownUntil = t + QUAKE.cooldownMs;
      return out;
    }
    this.lockUntil = t + QUAKE.retryLockMs;
    return null;
  }

  reset(): void {
    this.cooldownUntil = 0;
    this.lockUntil = 0;
    this.clearHistory();
    this.lastT = -1;
  }

  private clearHistory(): void {
    this.buf = [];
    this.g = null;
    this.cand = null;
  }

  private window(from: number, to: number): Rec[] {
    return this.buf.filter((r) => r.t >= from && r.t <= to);
  }

  private tryStart(t: number): void {
    // Need enough history to know the phone was still.
    if (this.buf[0].t > t - QUAKE.quietMs - QUAKE.staMs - 200) return;
    const sta = this.window(t - QUAKE.staMs, t);
    if (sta.length < 3) return;
    const staG = mean(sta.map((r) => r.r));
    if (staG < QUAKE.minStaG) return;
    const lta = Math.max(QUAKE.ltaFloorG, mean(this.window(t - QUAKE.ltaMs, t - QUAKE.ltaSkipMs).map((r) => r.r)));
    if (staG / lta < QUAKE.triggerRatio) return;
    const quiet = this.window(t - QUAKE.quietMs - QUAKE.staMs, t - QUAKE.staMs);
    if (quiet.length < 5 || mean(quiet.map((r) => r.r)) >= QUAKE.quietG) return;
    const first = sta.find((r) => r.r >= QUAKE.minStaG) ?? sta[0];
    this.cand = { t0: t, startedAt: first.t, lta };
  }

  private evaluate(c: { t0: number; startedAt: number; lta: number }, t: number): QuakeTrigger | null {
    const w = this.window(c.t0 - QUAKE.staMs, t);
    if (w.length < 8) return null;

    // Sustained: every half second since onset is strong and well above the quiet baseline.
    const segs = Math.floor(QUAKE.sustainMs / QUAKE.segmentMs);
    for (let i = 0; i < segs; i++) {
      const from = c.t0 + i * QUAKE.segmentMs - (i === 0 ? QUAKE.staMs : 0);
      const seg = this.window(from, c.t0 + (i + 1) * QUAKE.segmentMs);
      const m = mean(seg.map((r) => r.r));
      if (seg.length < 2 || m < QUAKE.segmentMinG || m < 2 * c.lta) return null;
    }

    const peak = Math.max(...w.map((r) => r.r));
    if (peak < QUAKE.peakG) return null;

    // Oscillation on the busiest axis.
    const times = w.map((r) => r.t);
    const axes = [w.map((r) => r.rx), w.map((r) => r.ry), w.map((r) => r.rz)];
    let best = { count: 0, intervals: [] as number[] };
    let bestRms = -1;
    let rmsAll = 0;
    for (const a of axes) {
      const rms = Math.sqrt(mean(a.map((v) => v * v)));
      rmsAll += rms * rms;
      if (rms > bestRms) {
        bestRms = rms;
        best = crossings(a, times, Math.max(0.25 * rms, QUAKE.crossHystG));
      }
    }
    // One impact dominates its window; real shaking does not.
    const rmsVec = Math.sqrt(rmsAll);
    if (rmsVec > 0 && peak / rmsVec > QUAKE.maxPeakToRms) return null;
    if (best.count < QUAKE.minCrossings) return null;

    // Rhythmic steps: regular crossings at walking pace.
    const spanS = (w[w.length - 1].t - w[0].t) / 1000;
    const hz = best.count / 2 / Math.max(0.1, spanS);
    if (hz >= QUAKE.walkHzMin && hz <= QUAKE.walkHzMax && best.intervals.length >= 3) {
      const mi = mean(best.intervals);
      const sd = Math.sqrt(mean(best.intervals.map((v) => (v - mi) ** 2)));
      if (mi > 0 && sd / mi < QUAKE.walkRegularCv) return null;
    }

    return { peakMg: Math.round(peak * 1000), startedAt: c.startedAt };
  }
}

// ---------------------------------------------------------------- consensus

export type QuakeLevel = 'none' | 'possible' | 'confirmed';

export interface QuakeVerdict extends ShakeVerdict {
  level: QuakeLevel;
  /** distinct phones other than this one in the group */
  others: number;
}

export interface ConsensusOpts {
  /** Votes must start within this window of each other. */
  windowMs: number;
  /** All phones in a group must be within this distance of each other. */
  radiusKm: number;
  minPhones: number;
  minPeakMg: number;
  /** Only votes seen in the last freshMs count. */
  freshMs: number;
  /** This phone's mesh id, so an echo of its own vote is not counted twice. */
  selfId?: string;
}

export const CONSENSUS_DEFAULTS: ConsensusOpts = {
  windowMs: 12_000,
  radiusKm: 3,
  minPhones: 3,
  minPeakMg: 60,
  freshMs: 30_000,
};

const OWN = '__own__';

export function validCoord(lat: unknown, lon: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0)
  );
}

export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

interface Voter {
  who: string;
  t: number;
  lat: number;
  lon: number;
  peakMg: number;
}

/**
 * Decide what the votes mean. Own vote (if any) counts as one phone. Duplicate senders count once,
 * malformed votes are ignored. 'confirmed' needs 3 distinct phones within 12 s and 3 km of each other and
 * a strongest peak of at least 60 mg. One or two phones is only 'possible' and must stay quiet.
 */
export function consensus(
  events: readonly ShakeEvent[],
  own: ShakeVote | null,
  now: number,
  opts: Partial<ConsensusOpts> = {},
): QuakeVerdict {
  const o = { ...CONSENSUS_DEFAULTS, ...opts };
  const byWho = new Map<string, Voter>();
  const add = (v: Voter) => {
    const prev = byWho.get(v.who);
    // A sender is one phone: keep its strongest vote.
    if (!prev || v.peakMg > prev.peakMg) byWho.set(v.who, v);
  };

  for (const e of events ?? []) {
    const v = e?.vote;
    if (!v || typeof e.from !== 'string' || !e.from) continue;
    if (!validCoord(v.lat, v.lon) || !Number.isFinite(v.peakMg) || v.peakMg <= 0) continue;
    const t = Number.isFinite(e.receivedAt) ? e.receivedAt : v.startedAt;
    if (!Number.isFinite(t)) continue;
    add({ who: o.selfId && e.from === o.selfId ? OWN : e.from, t, lat: v.lat, lon: v.lon, peakMg: v.peakMg });
  }
  if (own && validCoord(own.lat, own.lon) && Number.isFinite(own.peakMg) && own.peakMg > 0 && Number.isFinite(own.startedAt)) {
    add({ who: OWN, t: own.startedAt, lat: own.lat, lon: own.lon, peakMg: own.peakMg });
  }

  const voters = [...byWho.values()].filter((v) => v.t <= now + 5000 && v.t >= now - o.freshMs).sort((a, b) => a.t - b.t);
  let best: Voter[] = [];
  for (const anchor of voters) {
    const group: Voter[] = [];
    for (const v of voters) {
      if (v.t < anchor.t || v.t > anchor.t + o.windowMs) continue;
      if (group.every((g) => distanceKm(g.lat, g.lon, v.lat, v.lon) <= o.radiusKm)) group.push(v);
    }
    const better = group.length > best.length || (group.length === best.length && Math.max(...group.map((g) => g.peakMg)) > Math.max(0, ...best.map((g) => g.peakMg)));
    if (better) best = group;
  }

  const phones = best.length;
  const peakMg = best.reduce((m, v) => Math.max(m, v.peakMg), 0);
  const firstAt = best.length ? best[0].t : 0;
  const confirmed = phones >= o.minPhones && peakMg >= o.minPeakMg;
  const level: QuakeLevel = confirmed ? 'confirmed' : phones > 0 ? 'possible' : 'none';
  return { confirmed, phones, peakMg, firstAt, level, others: best.filter((v) => v.who !== OWN).length };
}
