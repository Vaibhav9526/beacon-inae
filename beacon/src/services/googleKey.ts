import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { googleCurrentUrl } from './googleWeather';

// Google Maps Platform key (optional). Kept only in this phone's secure storage, never in settings, logs or the server.
// On web, SecureStore does not exist, so AsyncStorage is used, as the ElevenLabs key does.

const KEY_NAME = 'beacon.google.maps.key';
const CHECK_POINT = { lat: 28.61, lon: 77.21 }; // one free-tier lookup to confirm a new key works

const secure = {
  get: () => (Platform.OS === 'web' ? AsyncStorage.getItem(KEY_NAME) : SecureStore.getItemAsync(KEY_NAME)),
  set: (v: string) => (Platform.OS === 'web' ? AsyncStorage.setItem(KEY_NAME, v) : SecureStore.setItemAsync(KEY_NAME, v)),
  del: () => (Platform.OS === 'web' ? AsyncStorage.removeItem(KEY_NAME) : SecureStore.deleteItemAsync(KEY_NAME)),
};

let cachedKey: string | null | undefined;

/** The saved key, or null when none is saved or storage is unavailable. */
export async function getGoogleKey(): Promise<string | null> {
  if (cachedKey === undefined) {
    try {
      cachedKey = (await secure.get()) || null;
    } catch {
      cachedKey = null;
    }
  }
  return cachedKey;
}

interface GoogleKeyState {
  has: boolean;
  checked: boolean;
  load(): Promise<void>;
  save(k: string): Promise<{ ok: boolean; error?: string }>;
  clear(): Promise<void>;
}

export const useGoogleKey = create<GoogleKeyState>((set) => ({
  has: false,
  checked: false,

  async load() {
    const k = await getGoogleKey();
    set({ has: !!k, checked: true });
  },

  async save(key) {
    const k = key.trim();
    if (!k) return { ok: false, error: 'Enter a key first' };
    try {
      const res = await fetch(googleCurrentUrl(k, CHECK_POINT.lat, CHECK_POINT.lon));
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { ok: false, error: 'Google rejected this key. Check it and that the Weather API is enabled.' };
      }
      if (!res.ok) return { ok: false, error: `Google could not be reached (${res.status}). Try again later.` };
      cachedKey = k;
      await secure.set(k);
      set({ has: true, checked: true });
      return { ok: true };
    } catch {
      return { ok: false, error: 'Could not reach Google. Check the connection and try again.' };
    }
  },

  async clear() {
    cachedKey = null;
    await secure.del().catch(() => {});
    set({ has: false, checked: true });
  },
}));
