import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { checkForUpdate, type LatestRelease } from '../services/updates';

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'current' | 'offline' | 'rate-limited' | 'error';

export interface UpdatesState {
  lastCheckedAt: number | null;
  /** the version the person chose "Later" for */
  dismissedVersion: string | null;
  /** the person turned on 'Include test versions' */
  includeBeta: boolean;
  latest: LatestRelease | null;
  /** transient: not persisted */
  status: UpdateStatus;
  setIncludeBeta: (on: boolean) => void;
  dismiss: (version: string) => void;
  /** checks GitHub; unless forced, the 6 hour interval applies */
  refresh: (force?: boolean) => Promise<void>;
}

let inFlight: Promise<void> | null = null;

export const useUpdates = create<UpdatesState>()(
  persist(
    (set, get) => ({
      lastCheckedAt: null,
      dismissedVersion: null,
      includeBeta: false,
      latest: null,
      status: 'idle',
      setIncludeBeta: (includeBeta) => set({ includeBeta }),
      dismiss: (dismissedVersion) => set({ dismissedVersion }),
      refresh: (force = false) => {
        if (inFlight) return inFlight;
        inFlight = (async () => {
          // wait for the saved state so an old lastCheckedAt cannot overwrite a fresh one
          if (!useUpdates.persist.hasHydrated()) {
            await new Promise<void>((resolve) => {
              const off = useUpdates.persist.onFinishHydration(() => {
                off();
                resolve();
              });
            });
          }
          if (force) set({ status: 'checking' });
          const s = get();
          const r = await checkForUpdate({ force, includeBeta: s.includeBeta, lastCheckedAt: s.lastCheckedAt });
          switch (r.status) {
            case 'available':
              set({ latest: r.latest, status: 'available', lastCheckedAt: r.checkedAt });
              break;
            case 'current':
              set({ latest: null, status: 'current', lastCheckedAt: r.checkedAt });
              break;
            case 'rate-limited':
              // keep the last known release; stamp the time so we do not retry on every foreground
              set({ status: 'rate-limited', lastCheckedAt: r.checkedAt });
              break;
            case 'offline':
              set({ status: 'offline' });
              break;
            case 'error':
              set({ status: 'error' });
              break;
            case 'throttled':
              break;
          }
        })().finally(() => {
          inFlight = null;
        });
        return inFlight;
      },
    }),
    {
      name: 'beacon.updates.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ lastCheckedAt: s.lastCheckedAt, dismissedVersion: s.dismissedVersion, includeBeta: s.includeBeta, latest: s.latest }),
    },
  ),
);

/**
 * Checks on mount and whenever the app comes back to the foreground.
 * The 6 hour interval and offline handling live in checkForUpdate, so this is cheap to call often.
 */
export function useUpdateCheck() {
  const latest = useUpdates((s) => s.latest);
  const status = useUpdates((s) => s.status);
  const check = useCallback((force = false) => useUpdates.getState().refresh(force), []);

  useEffect(() => {
    void check(false);
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') void check(false);
    });
    return () => sub.remove();
  }, [check]);

  return { latest, status, check };
}
