import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { EMPTY_HOME, type HomeInfo, type Household, type Person } from '../services/guidance';

export type { AgeBand, BuildingType, ConditionId, FloorLevel, HomeInfo, Household, HouseholdMedicine, Person } from '../services/guidance';

interface State {
  people: Person[];
  home: HomeInfo;
  addPerson: (p: Omit<Person, 'id'>) => string;
  updatePerson: (id: string, patch: Partial<Omit<Person, 'id'>>) => void;
  removePerson: (id: string) => void;
  setHome: (patch: Partial<HomeInfo>) => void;
  clear: () => void;
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const useHousehold = create<State>()(
  persist(
    (set) => ({
      people: [],
      home: EMPTY_HOME,
      addPerson: (p) => {
        const id = newId();
        set((s) => ({ people: [...s.people, { ...p, id }] }));
        return id;
      },
      updatePerson: (id, patch) => set((s) => ({ people: s.people.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      removePerson: (id) => set((s) => ({ people: s.people.filter((x) => x.id !== id) })),
      setHome: (patch) => set((s) => ({ home: { ...s.home, ...patch } })),
      clear: () => set({ people: [], home: EMPTY_HOME }),
    }),
    {
      name: 'beacon.household.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ people: s.people, home: s.home }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Household>;
        return { ...current, people: p.people ?? [], home: { ...EMPTY_HOME, ...(p.home ?? {}) } };
      },
    },
  ),
);
