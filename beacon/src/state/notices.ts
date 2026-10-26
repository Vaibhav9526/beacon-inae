// Which notices the person has read, and which ones already produced a notification.
// Persisted under 'beacon.notices.v1'. Only ids are kept, so a notice never notifies twice.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const NOTICES_KEY = 'beacon.notices.v1';
export const MAX_READ = 500;
export const MAX_NOTIFIED = 300;

/** Appends ids that are not in the list yet, keeping the newest `cap`. Returns the same array when nothing changes. */
export function appendCapped(list: string[], ids: string[], cap: number): string[] {
  const have = new Set(list);
  const fresh = [...new Set(ids)].filter((id) => !have.has(id));
  if (fresh.length === 0) return list;
  return [...list, ...fresh].slice(-cap);
}

interface NoticesState {
  hydrated: boolean;
  /** ids the person has opened or marked read, oldest first */
  readIds: string[];
  /** ids that already produced a local notification, oldest first */
  notifiedIds: string[];
  set: (p: Partial<NoticesState>) => void;
  markRead: (ids: string[]) => void;
  markNotified: (id: string) => void;
}

export const useNotices = create<NoticesState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      readIds: [],
      notifiedIds: [],
      set: (p) => set(p),
      markRead: (ids) => {
        const next = appendCapped(get().readIds, ids, MAX_READ);
        if (next !== get().readIds) set({ readIds: next });
      },
      markNotified: (id) => {
        const next = appendCapped(get().notifiedIds, [id], MAX_NOTIFIED);
        if (next !== get().notifiedIds) set({ notifiedIds: next });
      },
    }),
    {
      name: NOTICES_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ readIds: s.readIds, notifiedIds: s.notifiedIds }),
      onRehydrateStorage: () => (state) => {
        state?.set({ hydrated: true });
      },
    },
  ),
);

export const isRead = (readIds: string[], id: string) => readIds.includes(id);
