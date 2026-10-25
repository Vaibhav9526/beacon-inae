import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { PersonRecord, PersonStatus } from '../services/pfif';

export type DamageSeverity = 0 | 1 | 2 | 3;

export interface DamageReport {
  photos?: number;
  note: string;
  severity: DamageSeverity;
}

export interface Recovery {
  people: PersonRecord[];
  /** ids of finished checklist items from kb/recovery.ts */
  done: string[];
  damage: DamageReport | null;
  /** Records that I am safe, under my own name. */
  markSafe: (name: string, note?: string) => void;
  /** Adds a person I am looking for. */
  lookingFor: (name: string, note?: string) => void;
  /** Marks a person as found. */
  setFound: (id: string) => void;
  /** Removes a record, for example one added by mistake. */
  removePerson: (id: string) => void;
  toggleItem: (id: string) => void;
  setDamage: (d: DamageReport | null) => void;
}

const SELF_ID = 'self';

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const upsertSelf = (people: PersonRecord[], name: string, status: PersonStatus, note: string | undefined, now: number): PersonRecord[] => {
  const rec: PersonRecord = { id: SELF_ID, fullName: name, status, note, at: now, source: 'Self' };
  return [rec, ...people.filter((p) => p.id !== SELF_ID)];
};

export const useRecovery = create<Recovery>()(
  persist(
    (set) => ({
      people: [],
      done: [],
      damage: null,
      markSafe: (name, note) =>
        set((s) => ({ people: upsertSelf(s.people, name.trim() || 'Me', 'safe', note?.trim() || undefined, Date.now()) })),
      lookingFor: (name, note) =>
        set((s) => ({
          people: [
            { id: newId(), fullName: name.trim(), status: 'looking', note: note?.trim() || undefined, at: Date.now(), source: 'Self' },
            ...s.people,
          ],
        })),
      setFound: (id) =>
        set((s) => ({
          people: s.people.map((p) => (p.id === id ? { ...p, status: 'found', at: Date.now() } : p)),
        })),
      removePerson: (id) => set((s) => ({ people: s.people.filter((p) => p.id !== id) })),
      toggleItem: (id) =>
        set((s) => ({ done: s.done.includes(id) ? s.done.filter((x) => x !== id) : [...s.done, id] })),
      setDamage: (d) => set({ damage: d }),
    }),
    {
      name: 'beacon.recovery.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ people: s.people, done: s.done, damage: s.damage }),
    },
  ),
);
