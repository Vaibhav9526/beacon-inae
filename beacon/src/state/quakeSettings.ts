import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** Shake warning switch. Off until the person turns it on. */
export interface QuakeSettings {
  enabled: boolean;
  set: (enabled: boolean) => void;
}

export const useQuakeSettings = create<QuakeSettings>()(
  persist(
    (set) => ({
      enabled: false,
      set: (enabled) => set({ enabled }),
    }),
    {
      name: 'beacon.quake.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ enabled: s.enabled }),
    },
  ),
);
