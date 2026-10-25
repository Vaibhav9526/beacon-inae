import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Lang } from '../kb/types';
import type { Mode } from '../theme';

export interface EmergencyContact {
  name: string;
  phone: string;
}

export interface MedicalId {
  fullName: string;
  bloodGroup: string;
  allergies: string;
  conditions: string;
  medicines: string;
  notes: string;
}

export interface Zone {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radius: number;
}

export interface PairedChild {
  code: string;
  name: string;
}

export interface Settings {
  hydrated: boolean;
  mode: Mode | null;
  lang: Lang;
  nickname: string;
  largeText: boolean;
  highContrast: boolean;
  /** light, dark, or follow the phone */
  appearance: 'system' | 'light' | 'dark';
  readAloud: boolean;
  haptics: boolean;
  voiceControl: boolean;
  shakeSos: boolean;
  /** Family pairing code. The child shares it with a parent. */
  familyCode: string;
  kidName: string;
  kidAvatar: number;
  contacts: EmergencyContact[];
  medical: MedicalId;
  serverUrl: string;
  /** Base64 Ed25519 public key of the Beacon server whose alerts we trust. */
  serverKey: string;
  /** Parent mode: children paired by their family code, and the safe zones the parent drew. */
  children: PairedChild[];
  zones: Zone[];
  stars: Record<string, number>;
  checklist: Record<string, boolean>;
  onboarded: boolean;
}

interface Actions {
  set: (p: Partial<Settings>) => void;
  setStars: (id: string, n: number) => void;
  toggleCheck: (id: string) => void;
  reset: () => void;
}

const randomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};

const initial: Settings = {
  hydrated: false,
  mode: null,
  lang: 'en',
  nickname: '',
  largeText: false,
  highContrast: false,
  appearance: 'system',
  readAloud: false,
  haptics: true,
  voiceControl: false,
  shakeSos: true,
  familyCode: randomCode(),
  kidName: '',
  kidAvatar: 0,
  contacts: [],
  medical: { fullName: '', bloodGroup: '', allergies: '', conditions: '', medicines: '', notes: '' },
  serverUrl: process.env.EXPO_PUBLIC_BEACON_SERVER ?? '',
  serverKey: process.env.EXPO_PUBLIC_BEACON_SERVER_KEY ?? '',
  children: [],
  zones: [],
  stars: {},
  checklist: {},
  onboarded: false,
};

export const useSettings = create<Settings & Actions>()(
  persist(
    (set) => ({
      ...initial,
      set: (p) => set(p),
      setStars: (id, n) => set((s) => ({ stars: { ...s.stars, [id]: Math.max(s.stars[id] ?? 0, n) } })),
      toggleCheck: (id) => set((s) => ({ checklist: { ...s.checklist, [id]: !s.checklist[id] } })),
      reset: () => set({ ...initial, hydrated: true, familyCode: randomCode() }),
    }),
    {
      name: 'beacon.settings.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => {
        const { hydrated: _h, set: _set, setStars: _ss, toggleCheck: _tc, reset: _r, ...rest } = s as Settings & Actions;
        return rest;
      },
      onRehydrateStorage: () => (state) => {
        state?.set({ hydrated: true });
      },
    },
  ),
);

/** Text scale used everywhere so one switch makes the whole app larger. */
export const useScale = () => useSettings((s) => (s.largeText ? 1.3 : 1));
