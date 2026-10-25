import type { LifeboatState } from '../state/lifeboat';

/**
 * Lifeboat mode helpers. Pure functions here are unit tested; the store and native modules are
 * loaded lazily so this file stays cheap to import from polling services and from tests.
 */

/** Every poll interval is multiplied by this while lifeboat mode is on: 4x slower. */
export const LIFEBOAT_FACTOR = 4;

/**
 * Conservative drain estimates, in percent of a full battery per hour.
 * - Normal: screen on for a while, Bluetooth mesh listening, hub and gateway polling every minute. 10 %/h is a
 *   deliberately pessimistic budget for a disaster day; real use is often lower.
 * - Lifeboat: screen mostly off, mesh still listening, polling about 4x slower. 3 %/h assumes the radio, not the
 *   screen, is the main load. These are estimates, not measurements; re-measure on a real phone before trusting them.
 */
export const DRAIN_PER_HOUR = { normal: 10, lifeboat: 3 } as const;

export const factorFor = (active: boolean): number => (active ? LIFEBOAT_FACTOR : 1);

/** Multiplier for poll intervals right now. Falls back to 1 if the store cannot be read. */
export function lifeboatFactor(): number {
  try {
    const { useLifeboat } = require('../state/lifeboat') as typeof import('../state/lifeboat');
    return factorFor(useLifeboat.getState().active);
  } catch {
    return 1;
  }
}

/** Whole hours left at the conservative drain rate. Battery is 0 to 100. */
export function estimateHoursLeft(batteryPct: number, active: boolean): number {
  const pct = Math.min(100, Math.max(0, batteryPct));
  const rate = active ? DRAIN_PER_HOUR.lifeboat : DRAIN_PER_HOUR.normal;
  return Math.floor(pct / rate);
}

/** True when automatic activation should fire for this reading. Never true unless the person opted in. */
export function shouldAutoActivate(
  batteryPct: number,
  s: Pick<LifeboatState, 'auto' | 'autoBelowPercent' | 'active'>,
  charging: boolean,
): boolean {
  return s.auto && !s.active && !charging && batteryPct <= s.autoBelowPercent;
}

/** A base interval (ms) stretched by the lifeboat factor. */
export const pollMs = (baseMs: number): number => baseMs * lifeboatFactor();

/** Turns lifeboat mode on or off and pauses wake-word listening while it is on (SOS and shake stay on). */
export function setLifeboat(on: boolean, notice: string | null = null) {
  const { useLifeboat } = require('../state/lifeboat') as typeof import('../state/lifeboat');
  useLifeboat.getState().set({ active: on, since: on ? Date.now() : null, notice });
  if (on) {
    try {
      const { stopWake } = require('./voice') as typeof import('./voice');
      stopWake();
    } catch {
      /* no voice module in this build */
    }
  }
}

/** Called with each battery reading. Turns lifeboat on by itself only when the person has turned auto on. */
export function onBatteryReading(pct: number, charging: boolean) {
  const { useLifeboat } = require('../state/lifeboat') as typeof import('../state/lifeboat');
  const s = useLifeboat.getState();
  s.set({ battery: pct, charging });
  if (shouldAutoActivate(pct, s, charging)) {
    setLifeboat(true, `Battery at ${pct}%, so Lifeboat mode came on. Turn it off any time.`);
  }
}

/** The part of expo-battery we use. Typed here so this compiles when the package is not installed. */
interface BatteryLike {
  getBatteryLevelAsync(): Promise<number>;
  getBatteryStateAsync(): Promise<number>;
  addBatteryLevelListener(cb: () => void): { remove: () => void };
}

/**
 * Reads the battery through expo-battery when it is installed. Without it (not in the native build) this
 * does nothing and returns a no-op stop function.
 */
export function startLifeboatWatch(): () => void {
  let battery: BatteryLike | null = null;
  try {
    battery = require('expo-battery') as BatteryLike;
  } catch {
    return () => {};
  }
  let sub: { remove: () => void } | null = null;
  const read = async () => {
    try {
      const [level, state] = await Promise.all([battery!.getBatteryLevelAsync(), battery!.getBatteryStateAsync()]);
      if (level < 0) return; // unknown
      // expo-battery reports 0 to 1; BatteryState 2 = charging, 3 = full
      onBatteryReading(Math.round(level * 100), state === 2 || state === 3);
    } catch {
      /* battery unavailable on this device */
    }
  };
  void read();
  try {
    sub = battery!.addBatteryLevelListener(() => void read());
  } catch {
    sub = null;
  }
  return () => sub?.remove();
}
