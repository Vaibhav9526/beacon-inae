// "Locate me": pure logic for an acoustic beacon (a trapped phone repeats a loud SOS rhythm) and a listener that
// scores how well the microphone LOUDNESS over time (recorder metering, about every 100 ms) matches that rhythm.
// It only sees loudness, never the tone or the direction. No react-native imports, so it is testable in node.
import { sosPattern, strobeSchedule, type TimedStep } from './signals';

export const BEACON_UNIT_MS = 150;
export const BEACON_GAP_MS = 2000;
export const BEACON_TONE_HZ = 3000;
/** Metering is sampled on a 100 ms grid. */
export const SAMPLE_MS = 100;
/** About two repetitions of the pattern (6.05 s each) so "found" needs the rhythm to repeat. */
export const WINDOW_SAMPLES = 125;

const RES_MS = 10; // resolution of the expected-envelope table
const SCALES = [0.85, 0.88, 0.91, 0.94, 0.97, 1, 1.03, 1.06, 1.09, 1.12, 1.15]; // +-15 percent tempo drift

/** The expected on/off timeline of one repetition: SOS at `unitMs`, then a silent gap. */
export function sosEnvelope(unitMs = BEACON_UNIT_MS, gapMs = BEACON_GAP_MS): TimedStep[] {
  return [...strobeSchedule(sosPattern(), unitMs), { on: false, ms: gapMs }];
}

/** What to play and when, for the screen: the steps, the full period and the tone to use. */
export function beaconSchedule(unitMs = BEACON_UNIT_MS, gapMs = BEACON_GAP_MS) {
  const steps = sosEnvelope(unitMs, gapMs);
  return { steps, periodMs: steps.reduce((a, s) => a + s.ms, 0), toneHz: BEACON_TONE_HZ, unitMs, gapMs };
}

/** Whether the beacon should be sounding `tMs` after the pattern started (it loops forever). */
export function isOnAt(steps: TimedStep[], tMs: number): boolean {
  const period = steps.reduce((a, s) => a + s.ms, 0);
  let t = ((tMs % period) + period) % period;
  for (const s of steps) {
    if (t < s.ms) return s.on;
    t -= s.ms;
  }
  return false;
}

// ---- matching ----

interface Templates {
  /** Centred templates and their norms, one per (tempo, phase). */
  list: { t: Float32Array; norm: number }[];
}
const cache = new Map<string, Templates>();

function templates(sampleMs: number, len: number): Templates {
  const key = `${sampleMs}:${len}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const steps = sosEnvelope();
  const period = steps.reduce((a, s) => a + s.ms, 0);
  const n = Math.round(period / RES_MS);
  const pre = new Float64Array(n + 1);
  let k = 0;
  for (const s of steps) {
    const c = Math.round(s.ms / RES_MS);
    for (let j = 0; j < c && k < n; j++, k++) pre[k + 1] = pre[k] + (s.on ? 1 : 0);
  }
  while (k < n) {
    pre[k + 1] = pre[k];
    k++;
  }
  const total = pre[n];
  const cum = (ms: number) => {
    const bins = ms / RES_MS;
    const whole = Math.floor(bins / n);
    const rem = bins - whole * n;
    const i = Math.floor(rem);
    return whole * total + pre[i] + (pre[Math.min(n, i + 1)] - pre[i]) * (rem - i);
  };
  const list: Templates['list'] = [];
  for (const s of SCALES) {
    const phases = Math.max(1, Math.round((period * s) / sampleMs));
    for (let ph = 0; ph < phases; ph++) {
      const t = new Float32Array(len);
      let mean = 0;
      for (let i = 0; i < len; i++) {
        const a = ((i + ph) * sampleMs) / s;
        const v = (cum(a + sampleMs / s) - cum(a)) / (sampleMs / s / RES_MS);
        t[i] = v;
        mean += v;
      }
      mean /= len;
      let ss = 0;
      for (let i = 0; i < len; i++) {
        t[i] -= mean;
        ss += t[i] * t[i];
      }
      if (ss > 1e-6) list.push({ t, norm: Math.sqrt(ss) });
    }
  }
  const out = { list };
  cache.set(key, out);
  return out;
}

/**
 * How well `samples` (an on/off envelope, 1 = loud, 0 = quiet, soft values allowed) match the repeating SOS rhythm,
 * 0..1. It is a normalised cross-correlation, maximised over every start offset and over +-15 percent tempo drift.
 * Constant input (silence or steady machinery) scores 0.
 */
export function matchScore(samples: number[], sampleMs = SAMPLE_MS): number {
  const len = samples.length;
  if (len < 8) return 0;
  let mean = 0;
  for (const v of samples) mean += v;
  mean /= len;
  const x = new Float32Array(len);
  let ss = 0;
  for (let i = 0; i < len; i++) {
    x[i] = samples[i] - mean;
    ss += x[i] * x[i];
  }
  if (ss < 1e-6) return 0;
  const xn = Math.sqrt(ss);
  let best = 0;
  for (const { t, norm } of templates(sampleMs, len).list) {
    let d = 0;
    for (let i = 0; i < len; i++) d += x[i] * t[i];
    const r = d / (xn * norm);
    if (r > best) best = r;
  }
  return Math.max(0, Math.min(1, best));
}

// ---- tracker ----

export type LocatorState = 'searching' | 'maybe' | 'found';
export interface TrackerOut {
  strength: number;
  state: LocatorState;
  noiseFloorDb: number;
  matchScore: number;
}

const HISTORY = 300; // 30 s for the noise floor
const EVAL_EVERY = 5; // score every 500 ms
const FOUND_ON = 0.72;
const FOUND_OFF = 0.55;
const MAYBE_ON = 0.5;
const FOUND_HOLD = 4; // consecutive strong scores (2 s) before "found"

function percentile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
}

/** Feed it metering dB samples as they arrive; it keeps a rolling window and reports strength and state. */
export class SignalTracker {
  private db: number[] = [];
  private lastBin: number | null = null;
  private since = 0;
  private strength = 0;
  private streak = 0;
  private state: LocatorState = 'searching';
  private last: TrackerOut = { strength: 0, state: 'searching', noiseFloorDb: -160, matchScore: 0 };

  reset() {
    this.db = [];
    this.lastBin = null;
    this.since = 0;
    this.strength = 0;
    this.streak = 0;
    this.state = 'searching';
    this.last = { strength: 0, state: 'searching', noiseFloorDb: -160, matchScore: 0 };
  }

  push(dbSample: number, nowMs: number): TrackerOut {
    const bin = Math.floor(nowMs / SAMPLE_MS);
    const v = Number.isFinite(dbSample) ? dbSample : -160;
    if (this.lastBin === null) {
      this.db.push(v);
      this.lastBin = bin;
    } else if (bin <= this.lastBin) {
      this.db[this.db.length - 1] = Math.max(this.db[this.db.length - 1], v); // two readings in one slot: keep the louder
      return this.last;
    } else {
      const gap = Math.min(bin - this.lastBin - 1, 20); // repeat the last value over missing slots
      for (let i = 0; i < gap; i++) this.db.push(this.db[this.db.length - 1]);
      this.db.push(v);
      this.lastBin = bin;
    }
    if (this.db.length > HISTORY) this.db.splice(0, this.db.length - HISTORY);
    if (++this.since >= EVAL_EVERY) {
      this.since = 0;
      this.last = this.evaluate();
    }
    return this.last;
  }

  private evaluate(): TrackerOut {
    const n = this.db.length;
    const sorted = [...this.db].sort((a, b) => a - b);
    const floor = percentile(sorted, 0.2);
    const hi = percentile(sorted, 0.95);
    const margin = Math.max(5, 0.4 * (hi - floor));
    const thr = floor + margin;
    const win = this.db.slice(-WINDOW_SAMPLES);
    const env = win.map((d) => (d > thr ? 1 : 0));
    const full = win.length >= WINDOW_SAMPLES - 5;
    const score = n >= 80 ? matchScore(env) : 0;

    if (score >= FOUND_ON && full) this.streak++;
    else if (!(this.state === 'found' && score >= FOUND_OFF)) this.streak = 0;
    if (this.streak >= FOUND_HOLD) this.state = 'found';
    else if (this.state === 'found' && score >= FOUND_OFF) this.state = 'found';
    else this.state = score >= MAYBE_ON ? 'maybe' : 'searching';

    const recent = this.db.slice(-30);
    const loud = Math.max(0, Math.min(1, (Math.max(...recent) - floor) / 30));
    const m = Math.max(0, Math.min(1, (score - 0.3) / 0.5));
    const raw = 100 * m * (0.4 + 0.6 * loud);
    this.strength += (raw - this.strength) * (raw > this.strength ? 0.45 : 0.2);
    if (this.strength < 1) this.strength = 0;
    return { strength: Math.round(this.strength), state: this.state, noiseFloorDb: floor, matchScore: score };
  }
}

// ---- beacon audio ----

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}

/**
 * One whole repetition (SOS then the gap) as a mono 16-bit WAV in base64, to be played in a loop so the rhythm
 * stays exact. A 3 kHz tone, driven into soft clipping for extra loudness, with 4 ms edges to avoid clicks.
 */
export function beaconWav(sampleRate = 16000): string {
  const { steps, periodMs, toneHz } = beaconSchedule();
  const total = Math.round((sampleRate * periodMs) / 1000);
  const buf = new Uint8Array(44 + total * 2);
  const view = new DataView(buf.buffer);
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + total * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, total * 2, true);
  const edge = Math.round(sampleRate * 0.004);
  let pos = 0;
  for (const s of steps) {
    const n = Math.round((sampleRate * s.ms) / 1000);
    for (let i = 0; i < n && pos < total; i++, pos++) {
      let v = 0;
      if (s.on) {
        const env = Math.min(1, i / edge, (n - 1 - i) / edge);
        v = Math.tanh(2 * Math.sin((2 * Math.PI * toneHz * pos) / sampleRate)) * 0.95 * Math.max(0, env);
      }
      view.setInt16(44 + pos * 2, Math.round(v * 32767), true);
    }
  }
  return b64(buf);
}
