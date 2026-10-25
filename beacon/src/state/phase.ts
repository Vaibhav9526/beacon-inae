import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useAlerts } from '../services/alerts';
import { useMesh } from '../services/mesh';
import { type Phase, type PhaseResult, computePhase, hazardInForce } from './phaseLogic';

export type { Phase, PhaseResult } from './phaseLogic';

interface PhaseMemory {
  /** last time a warning or severe hazard was in force here; survives restarts so "recover" lasts 72 hours */
  lastHazardAt: number | null;
  safeAt: number | null;
  override: Phase | null;
  noteHazard(at: number): void;
  markSafe(at?: number): void;
  setOverride(p: Phase | null): void;
}

export const usePhaseMemory = create<PhaseMemory>()(
  persist(
    (set) => ({
      lastHazardAt: null,
      safeAt: null,
      override: null,
      noteHazard: (at) => set({ lastHazardAt: at }),
      markSafe: (at = Date.now()) => set({ safeAt: at }),
      setOverride: (override) => set({ override }),
    }),
    { name: 'beacon.phase.v1', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

/**
 * The current phase for the Home screen and anything else that should change shape: prepare, alert or recover.
 * Re-evaluates when alerts, the mesh SOS list or the person's own choices change, and once a minute so expiry is noticed.
 */
export function usePhase(): PhaseResult & { override: Phase | null; setOverride(p: Phase | null): void } {
  const alerts = useAlerts((s) => s.items);
  const sos = useMesh((s) => s.sos);
  const sosActive = useMesh((s) => s.sosActive);
  const { lastHazardAt, safeAt, override, noteHazard, setOverride } = usePhaseMemory();
  const tick = useClock(60_000);

  const result = useMemo(
    () =>
      computePhase({
        now: Date.now(),
        alerts: alerts.map((a) => ({ severity: a.severity, title: a.title, seenAt: a.seenAt, expires: a.expires })),
        sosHeard: sos.map((m) => ({ timestamp: m.timestamp, verified: m.verified })),
        mySosActive: sosActive,
        lastHazardAt,
        safeAt,
        override,
      }),
    // `tick` makes expiry take effect without any other change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alerts, sos, sosActive, lastHazardAt, safeAt, override, tick],
  );

  // while a hazard is in force, keep stamping it so the recover window starts when it ends
  useEffect(() => {
    if (!override && hazardInForce(result)) noteHazard(Date.now());
  }, [result, override, noteHazard]);

  return { ...result, override, setOverride };
}

function useClock(ms: number): number {
  const [n, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return n;
}
