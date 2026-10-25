import { create } from 'zustand';

export interface FallSample {
  /** Milliseconds. */
  t: number;
  x: number;
  y: number;
  z: number;
}

const FREE_FALL_G = 0.4;
const FREE_FALL_MS = 80;
const IMPACT_G = 2.6;
const IMPACT_WINDOW_MS = 1000;
const STILL_MIN_G = 0.9;
const STILL_MAX_G = 1.1;
const STILL_MS = 6000;
const STILL_VARIANCE = 0.004;
const STILL_WINDOW = 40; // about 2 s at 20 Hz
const COOLDOWN_MS = 60000;
const MAX_GAP_MS = 500;

/**
 * Pure fall state machine. Feed it accelerometer samples at about 20 Hz.
 *
 * A fall is a free-fall dip below 0.4 g for at least 80 ms, an impact above 2.6 g within one second,
 * and then six seconds of stillness (0.9-1.1 g with low variance). Any movement outside that band
 * after the impact cancels the fall, so walking or shaking after a bump never completes one.
 * After a fall it stays quiet for 60 s.
 */
export class FallDetector {
  private stage: 'idle' | 'impact' | 'still' = 'idle';
  private freeFallStart: number | null = null;
  private impactBy = 0;
  private stillStart: number | null = null;
  private stillMags: number[] = [];
  private stillSum = 0;
  private stillSumSq = 0;
  private cooldownUntil = 0;
  private lastT = -1;

  push(sample: FallSample): 'fall' | null {
    const mag = Math.hypot(sample.x, sample.y, sample.z);
    const t = sample.t;
    if (!Number.isFinite(mag) || !Number.isFinite(t)) return null;

    if (this.lastT >= 0 && t - this.lastT > MAX_GAP_MS) this.resetStages();
    this.lastT = t;

    if (t < this.cooldownUntil) return null;

    if (this.stage === 'idle') {
      if (mag < FREE_FALL_G) {
        if (this.freeFallStart === null) this.freeFallStart = t;
        return null;
      }

      if (this.freeFallStart !== null) {
        const dip = t - this.freeFallStart;
        this.freeFallStart = null;
        if (dip >= FREE_FALL_MS) {
          this.stage = 'impact';
          this.impactBy = t + IMPACT_WINDOW_MS;
        }
      }

      if (this.stage === 'impact' && mag > IMPACT_G) this.enterStill();
      return null;
    }

    if (this.stage === 'impact') {
      if (t > this.impactBy) {
        this.resetStages();
        return null;
      }
      if (mag > IMPACT_G) this.enterStill();
      return null;
    }

    // stage === 'still': the person has to lie (nearly) motionless for six seconds
    if (mag < STILL_MIN_G || mag > STILL_MAX_G) {
      this.resetStages();
      return null;
    }

    if (this.stillStart === null) this.stillStart = t;
    this.stillMags.push(mag);
    this.stillSum += mag;
    this.stillSumSq += mag * mag;

    if (this.stillMags.length > STILL_WINDOW) {
      const old = this.stillMags.shift() as number;
      this.stillSum -= old;
      this.stillSumSq -= old * old;
    }

    const n = this.stillMags.length;
    const variance = n > 1 ? Math.max(0, this.stillSumSq / n - (this.stillSum / n) ** 2) : 0;

    if (variance > STILL_VARIANCE) {
      this.stillStart = t;
      this.stillMags = [mag];
      this.stillSum = mag;
      this.stillSumSq = mag * mag;
      return null;
    }

    if (t - this.stillStart >= STILL_MS) {
      this.cooldownUntil = t + COOLDOWN_MS;
      this.resetStages();
      return 'fall';
    }

    return null;
  }

  reset(): void {
    this.cooldownUntil = 0;
    this.lastT = -1;
    this.resetStages();
  }

  private enterStill(): void {
    this.stage = 'still';
    this.stillStart = null;
    this.stillMags = [];
    this.stillSum = 0;
    this.stillSumSq = 0;
  }

  private resetStages(): void {
    this.stage = 'idle';
    this.freeFallStart = null;
    this.impactBy = 0;
    this.stillStart = null;
    this.stillMags = [];
    this.stillSum = 0;
    this.stillSumSq = 0;
  }
}

/**
 * Shared alert state. `at` is the time of the detected fall while the check-in is pending, or null.
 * A second fall while one is pending is ignored, so the prompt is never shown twice.
 */
export const useFallAlert = create<{ at: number | null; raise: (at: number) => void; clear: () => void }>((set, get) => ({
  at: null,
  raise: (at) => {
    if (get().at === null) set({ at });
  },
  clear: () => set({ at: null }),
}));

type Subscription = { remove: () => void };
let stopActive: (() => void) | null = null;

/**
 * Start the accelerometer fall watch. Returns a stop function. Calling it again replaces the previous watch.
 * The sensor module is required lazily, and a missing or failing sensor just leaves the watch silent.
 */
export function startFallWatch(): () => void {
  stopActive?.();

  let stopped = false;
  let sub: Subscription | null = null;
  const detector = new FallDetector();

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Accelerometer } = require('expo-sensors') as typeof import('expo-sensors');
    Accelerometer.setUpdateInterval(50);
    sub = Accelerometer.addListener(({ x, y, z }) => {
      if (stopped) return;
      try {
        if (detector.push({ t: Date.now(), x, y, z }) === 'fall') useFallAlert.getState().raise(Date.now());
      } catch {
        /* a bad sample must not stop the watch */
      }
    });
  } catch {
    /* no accelerometer in this build or on this device */
  }

  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      sub?.remove();
    } catch {
      /* already gone */
    }
    sub = null;
    if (stopActive === stop) stopActive = null;
  };

  stopActive = stop;
  return stop;
}

/** Stop the running watch (if any) and drop any pending check-in. */
export function stopFallWatch(): void {
  stopActive?.();
  useFallAlert.getState().clear();
}
