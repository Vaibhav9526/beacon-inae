import { useEffect } from 'react';
import { create } from 'zustand';
import type { ShakeVote } from '../mesh/appTypes';
import { useQuakeSettings } from '../state/quakeSettings';
import { lastKnownFix } from './location';
import { useMesh } from './mesh';
import { type QuakeLevel, type QuakeVerdict, ShakeDetector, consensus } from './quake';

/**
 * Shake warning service. One accelerometer subscription, only while the switch is on and the mesh is running.
 * It never replaces official alerts: it only shows what nearby phones agree they felt.
 */

const WARNING_MS = 90_000;
const SUPPRESS_AFTER_DISMISS_MS = 120_000;
const EVAL_MS = 2000;
const SAMPLE_MS = 50; // same as fall detection: expo-sensors keeps one shared interval per sensor

export interface QuakeState {
  level: QuakeLevel;
  phones: number;
  peakMg: number;
  /** When a confirmed warning started, or null. */
  warningAt: number | null;
  /** The warning is a local test: never sent over the mesh. */
  testing: boolean;
  /** Another phone felt something (possible), for the small chip. */
  nearbyFelt: boolean;
  suppressUntil: number;
  dismiss: () => void;
  startTest: () => void;
}

export const useQuake = create<QuakeState>((set) => ({
  level: 'none',
  phones: 0,
  peakMg: 0,
  warningAt: null,
  testing: false,
  nearbyFelt: false,
  suppressUntil: 0,
  dismiss: () => set({ warningAt: null, testing: false, suppressUntil: Date.now() + SUPPRESS_AFTER_DISMISS_MS }),
  startTest: () => set({ warningAt: Date.now(), testing: true, level: 'confirmed', phones: 3, peakMg: 120 }),
}));

let own: ShakeVote | null = null;

function evaluate(now = Date.now()): QuakeVerdict {
  const m = useMesh.getState();
  const v = consensus(m.shakes, own && now - own.startedAt < 30_000 ? own : null, now, { selfId: m.myId });
  const s = useQuake.getState();
  const patch: Partial<QuakeState> = { level: v.level, phones: v.phones, peakMg: v.peakMg, nearbyFelt: v.level === 'possible' && v.others > 0 };
  if (v.level === 'confirmed' && s.warningAt === null && now >= s.suppressUntil) {
    patch.warningAt = now;
    patch.testing = false;
  }
  // Keep the test overlay's fake numbers; otherwise follow the real verdict.
  if (s.testing) return v;
  useQuake.setState(patch);
  return v;
}

const randomId = () =>
  Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

async function onTrigger(peakMg: number, startedAt: number): Promise<void> {
  const fix = await lastKnownFix().catch(() => null);
  if (!fix) return; // no position, no vote: a vote without a place cannot be compared
  const vote: ShakeVote = { id: randomId(), lat: fix.lat, lon: fix.lon, peakMg, startedAt };
  own = vote;
  try {
    useMesh.getState().sendShake(vote);
  } catch {
    /* mesh not ready; the local vote still counts */
  }
  evaluate();
}

function lifeboatOn(): boolean {
  try {
    const { useLifeboat } = require('../state/lifeboat') as typeof import('../state/lifeboat');
    return useLifeboat.getState().active;
  } catch {
    return false;
  }
}

let stopActive: (() => void) | null = null;

/** Start watching. Returns a stop function. Calling again replaces the previous watch. */
export function startQuake(): () => void {
  stopActive?.();
  let stopped = false;
  let sub: { remove: () => void } | null = null;
  const detector = new ShakeDetector();
  let slow = lifeboatOn();
  let skip = 0;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Accelerometer } = require('expo-sensors') as typeof import('expo-sensors');
    Accelerometer.setUpdateInterval(SAMPLE_MS);
    sub = Accelerometer.addListener(({ x, y, z }) => {
      if (stopped) return;
      // Lifeboat mode: use every second sample (about 10 Hz) without changing the sensor rate other features rely on.
      if (slow && skip++ % 2 === 1) return;
      try {
        const hit = detector.push({ t: Date.now(), x, y, z });
        if (hit) void onTrigger(hit.peakMg, hit.startedAt);
      } catch {
        /* a bad sample must not stop the watch */
      }
    });
  } catch {
    /* no accelerometer in this build */
  }

  const unsubMesh = useMesh.subscribe((s, prev) => {
    if (s.shakes !== prev.shakes) evaluate();
  });
  const timer = setInterval(() => {
    slow = lifeboatOn();
    evaluate();
    const st = useQuake.getState();
    if (st.warningAt !== null && Date.now() - st.warningAt > WARNING_MS) st.dismiss();
  }, EVAL_MS);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      sub?.remove();
    } catch {
      /* already gone */
    }
    unsubMesh();
    clearInterval(timer);
    if (stopActive === stop) stopActive = null;
  };
  stopActive = stop;
  return stop;
}

export function stopQuake(): void {
  stopActive?.();
  if (!useQuake.getState().testing) useQuake.setState({ level: 'none', phones: 0, peakMg: 0, warningAt: null, nearbyFelt: false });
}

/** Mount once in the app root: runs the service while the switch is on and the mesh is running. */
export function useQuakeService(): void {
  const enabled = useQuakeSettings((s) => s.enabled);
  const running = useMesh((s) => s.running);
  useEffect(() => {
    if (!enabled || !running) return;
    const stop = startQuake();
    return () => {
      stop();
      stopQuake();
    };
  }, [enabled, running]);
}
