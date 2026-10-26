import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** Devices (8-hex tags) this person muted in the global chat. Saved on the phone only. */
export interface ChatSafetyState {
  muted: string[];
  mute: (device: string) => void;
  unmute: (device: string) => void;
  clear: () => void;
}

export const useChatSafety = create<ChatSafetyState>()(
  persist(
    (set) => ({
      muted: [],
      mute: (device) => set((s) => (s.muted.includes(device) ? s : { muted: [...s.muted, device].slice(-500) })),
      unmute: (device) => set((s) => ({ muted: s.muted.filter((d) => d !== device) })),
      clear: () => set({ muted: [] }),
    }),
    { name: 'beacon.chatSafety.v1', storage: createJSONStorage(() => AsyncStorage), partialize: (s) => ({ muted: s.muted }) },
  ),
);
