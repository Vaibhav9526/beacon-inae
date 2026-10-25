import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomBytes } from '@noble/hashes/utils.js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { toBase64 } from '../mesh/bytes';
import { decodeKey, KEY_BYTES } from '../services/breadcrumbs';

const KEY = 'beacon.familykey.v1';
const ON_KEY = 'beacon.breadcrumbs.on.v1';

// Same storage rule as the identity key: Android keystore via SecureStore, AsyncStorage only for web previews.
const read = () => (Platform.OS === 'web' ? AsyncStorage.getItem(KEY) : SecureStore.getItemAsync(KEY));
const write = (v: string) => (Platform.OS === 'web' ? AsyncStorage.setItem(KEY, v) : SecureStore.setItemAsync(KEY, v));
const erase = () => (Platform.OS === 'web' ? AsyncStorage.removeItem(KEY) : SecureStore.deleteItemAsync(KEY));

interface FamilyKeyState {
  /** the 32-byte key (in-memory cache), or null when this phone has none */
  key: Uint8Array | null;
  loaded: boolean;
  /** opt-in: leave breadcrumbs only when true */
  breadcrumbsOn: boolean;
}

export const useFamilyKey = create<FamilyKeyState>(() => ({ key: null, loaded: false, breadcrumbsOn: false }));

let loading: Promise<void> | null = null;

/** Read the key and the opt-in flag from storage once. Safe to call often. */
export function loadFamilyKey(): Promise<void> {
  loading ??= (async () => {
    let key: Uint8Array | null = null;
    let on = false;
    try {
      const raw = await read();
      if (raw) key = decodeKey(raw);
    } catch {
      /* no key yet */
    }
    try {
      on = (await AsyncStorage.getItem(ON_KEY)) === '1';
    } catch {
      /* default off */
    }
    useFamilyKey.setState({ key, loaded: true, breadcrumbsOn: on && key != null });
  })();
  return loading;
}

/** Synchronous view of the cached key (call loadFamilyKey first). */
export const getFamilyKey = () => useFamilyKey.getState().key;

/** The family key, creating 32 random bytes on first use. */
export async function ensureKey(): Promise<Uint8Array> {
  await loadFamilyKey();
  const have = useFamilyKey.getState().key;
  if (have) return have;
  return replaceKey(randomBytes(KEY_BYTES));
}

async function replaceKey(k: Uint8Array): Promise<Uint8Array> {
  await write(toBase64(k));
  useFamilyKey.setState({ key: k, loaded: true });
  return k;
}

/** Make a new key. Notes sealed with the old key become unreadable. */
export async function makeNewKey(): Promise<Uint8Array> {
  await loadFamilyKey();
  return replaceKey(randomBytes(KEY_BYTES));
}

/** Import a key from base64 or 'BCNKEY1:<base64>'. Returns false when it is not a valid key. */
export async function importKey(text: string): Promise<boolean> {
  const k = decodeKey(text);
  if (!k) return false;
  await loadFamilyKey();
  await replaceKey(k);
  return true;
}

/** Base64 of the key (null when none yet). */
export async function exportKey(): Promise<string | null> {
  await loadFamilyKey();
  const k = useFamilyKey.getState().key;
  return k ? toBase64(k) : null;
}

export async function removeKey(): Promise<void> {
  await erase().catch(() => {});
  await AsyncStorage.removeItem(ON_KEY).catch(() => {});
  useFamilyKey.setState({ key: null, breadcrumbsOn: false });
}

export async function setBreadcrumbsOn(on: boolean): Promise<void> {
  await loadFamilyKey();
  const next = on && useFamilyKey.getState().key != null;
  useFamilyKey.setState({ breadcrumbsOn: next });
  await AsyncStorage.setItem(ON_KEY, next ? '1' : '0').catch(() => {});
}
