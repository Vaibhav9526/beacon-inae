import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Lifeboat mode: one switch that trades polling speed and screen time for battery life.
 * `active`, `since`, `autoBelowPercent` and `auto` are saved. `battery`, `charging` and `notice` are live only.
 */
export interface LifeboatState {
  active: boolean;
  /** ms timestamp when lifeboat mode was turned on */
  since: number | null;
  /** when `auto` is on, lifeboat turns itself on at or below this battery percentage */
  autoBelowPercent: number;
  /** the person has opted in to automatic activation. Off by default. */
  auto: boolean;
  /** last battery reading, 0 to 100, or null when the battery module is not in this build */
  battery: number | null;
  charging: boolean;
  /** one-line message shown in the banner after an automatic change, cleared by the person */
  notice: string | null;
  set: (p: Partial<Omit<LifeboatState, 'set'>>) => void;
}

const initial = {
  active: false,
  since: null,
  autoBelowPercent: 15,
  auto: false,
  battery: null,
  charging: false,
  notice: null,
};

export const useLifeboat = create<LifeboatState>()(
  persist(
    (set) => ({
      ...initial,
      set: (p) => set(p),
    }),
    {
      name: 'beacon.lifeboat.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ active: s.active, since: s.since, autoBelowPercent: s.autoBelowPercent, auto: s.auto }),
    },
  ),
);
