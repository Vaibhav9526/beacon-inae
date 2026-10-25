import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { toBase64 } from '../mesh/bytes';
import { type Identity, type KeyStore, loadOrCreateIdentity } from '../mesh/identity';

const KEY = 'beacon.identity.v1';

// Keys live in the Android keystore (SecureStore). Web has none, so it falls back to AsyncStorage for dev previews only.
const store: KeyStore = {
  get: () => (Platform.OS === 'web' ? AsyncStorage.getItem(KEY) : SecureStore.getItemAsync(KEY)),
  set: (v) => (Platform.OS === 'web' ? AsyncStorage.setItem(KEY, v) : SecureStore.setItemAsync(KEY, v)),
};

let cached: Promise<Identity> | null = null;

/** Forget the in-memory identity (after a wipe) so the next call creates a fresh one. */
export const resetIdentityCache = () => {
  cached = null;
};

export function getIdentity(): Promise<Identity> {
  cached ??= loadOrCreateIdentity(store);
  return cached;
}

/** The id the server knows this phone by: its Ed25519 public key. */
export async function deviceId(): Promise<string> {
  return toBase64((await getIdentity()).signing.publicKey);
}
