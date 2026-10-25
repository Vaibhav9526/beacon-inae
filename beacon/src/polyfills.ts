// Hermes has no WebCrypto. The mesh crypto (noble) needs a secure random source.
import * as Crypto from 'expo-crypto';

const g = globalThis as unknown as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
if (!g.crypto) g.crypto = {};
if (!g.crypto.getRandomValues) {
  g.crypto.getRandomValues = (arr: Uint8Array) => {
    const bytes = Crypto.getRandomBytes(arr.length);
    arr.set(bytes);
    return arr;
  };
}
