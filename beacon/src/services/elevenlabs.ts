import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FS from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { toBase64, toHex, utf8 } from '../mesh/bytes';
import { sha256 } from '@noble/hashes/sha2.js';
import { FALLBACK_VOICES, cleanKey, errorFromResponse, lacksPermissionOnly, pickVoices, type Voice, type VoiceRole, type Voices } from './elevenlabsCore';

// ElevenLabs: speech-to-text (Scribe) and text-to-speech. The API key lives only in the Android keystore (SecureStore),
// never in settings, logs or the server. Every call is made straight from the phone to ElevenLabs.

export { ElevenError, cleanKey, pickVoices, FALLBACK_VOICES } from './elevenlabsCore';
export type { Voice, VoiceRole, Voices } from './elevenlabsCore';

const API = 'https://api.elevenlabs.io';
const KEY_NAME = 'beacon.elevenlabs.key';
const VOICES_KEY = 'beacon.elevenlabs.voices.v1';
const DIR = `${FS.cacheDirectory ?? ''}tts/`;

export const TTS_MODEL = 'eleven_flash_v2_5'; // low latency, covers Hindi and English
export const TTS_FALLBACK_MODEL = 'eleven_multilingual_v2';
export const STT_MODEL = 'scribe_v2';

interface KeyState {
  has: boolean;
  checked: boolean;
  /** false when the key cannot list voices (no voices_read): the built-in default voices are used. */
  voicesListed: boolean;
  voices: Voices;
  load(): Promise<void>;
  save(key: string): Promise<{ ok: boolean; error?: string; voicesListed?: boolean }>;
  clear(): Promise<void>;
  setVoice(role: VoiceRole, v: Voice): Promise<void>;
}

const secure = {
  get: () => (Platform.OS === 'web' ? AsyncStorage.getItem(KEY_NAME) : SecureStore.getItemAsync(KEY_NAME)),
  set: (v: string) => (Platform.OS === 'web' ? AsyncStorage.setItem(KEY_NAME, v) : SecureStore.setItemAsync(KEY_NAME, v)),
  del: () => (Platform.OS === 'web' ? AsyncStorage.removeItem(KEY_NAME) : SecureStore.deleteItemAsync(KEY_NAME)),
};

let cachedKey: string | null | undefined;
export async function getKey(): Promise<string | null> {
  if (cachedKey === undefined) cachedKey = (await secure.get().catch(() => null)) ?? null;
  return cachedKey;
}

const persistVoices = (voices: Voices, listed: boolean) =>
  AsyncStorage.setItem(VOICES_KEY, JSON.stringify({ listed, voices })).catch(() => {});

export const useEleven = create<KeyState>((set, get) => ({
  has: false,
  checked: false,
  voicesListed: true,
  voices: {},

  async load() {
    const k = await getKey();
    let voices: Voices = {};
    let listed = true;
    try {
      const raw = JSON.parse((await AsyncStorage.getItem(VOICES_KEY)) ?? '{}');
      if (raw && typeof raw === 'object' && 'voices' in raw) {
        voices = raw.voices ?? {};
        listed = raw.listed !== false;
      } else {
        voices = raw ?? {}; // saved before the listed flag existed
      }
    } catch {
      /* none yet */
    }
    set({ has: !!k, checked: true, voices, voicesListed: listed });
  },

  async save(key) {
    const k = cleanKey(key);
    if (!k) return { ok: false, error: 'empty key' };
    try {
      // validate with a free call; a key without voices_read still works for speech, so it falls back to default voices
      let list: Voice[] = [];
      try {
        list = await fetchVoices(k);
      } catch (e) {
        if (!lacksPermissionOnly(e)) throw e;
      }
      const listed = list.length > 0;
      const voices: Voices = listed ? pickVoices(list) : { ...FALLBACK_VOICES };
      cachedKey = k;
      await secure.set(k);
      await persistVoices(voices, listed);
      set({ has: true, checked: true, voices, voicesListed: listed });
      return { ok: true, voicesListed: listed };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async clear() {
    cachedKey = null;
    await secure.del().catch(() => {});
    await AsyncStorage.removeItem(VOICES_KEY).catch(() => {});
    await FS.deleteAsync(DIR, { idempotent: true }).catch(() => {});
    set({ has: false, voices: {}, voicesListed: true });
  },

  async setVoice(role, v) {
    const voices = { ...get().voices, [role]: v };
    set({ voices });
    await persistVoices(voices, get().voicesListed);
  },
}));

async function api(path: string, key: string, init: RequestInit = {}, timeoutMs = 20000): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(API + path, { ...init, headers: { 'xi-api-key': key, ...(init.headers ?? {}) }, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Throws an ElevenError with the readable reason from the response body and the HTTP status. */
async function fail(res: Response): Promise<never> {
  const text = await res.text().catch(() => '');
  throw errorFromResponse(res.status, text);
}

export async function fetchVoices(key: string): Promise<Voice[]> {
  const res = await api('/v1/voices', key);
  if (!res.ok) return fail(res);
  const j = (await res.json()) as { voices?: { voice_id: string; name: string; category?: string; labels?: Record<string, string> }[] };
  return (j.voices ?? []).filter((v) => !v.category || v.category === 'premade' || v.category === 'professional').map((v) => ({ id: v.voice_id, name: v.name, gender: v.labels?.gender }));
}

// ---- text to speech ----

const hash = (s: string) => toHex(sha256(utf8(s))).slice(0, 24);

export interface TtsStatus {
  ok: boolean;
  reason?: string;
}
let lastTts: TtsStatus | null = null;
/** Outcome of the last synthesize call (null before any call). Used by the Test voice button. */
export const ttsStatus = (): TtsStatus | null => lastTts;
export const resetTtsStatus = () => {
  lastTts = null;
};

/**
 * Returns a local mp3 for the text, from cache when this exact phrase was spoken before. Never throws: on any failure
 * it logs a short reason, records it in ttsStatus() and returns null, so speak() falls back to the phone's voice.
 */
export async function synthesize(text: string, voiceId: string, lang: 'en' | 'hi'): Promise<string | null> {
  try {
    const key = await getKey();
    if (!key || Platform.OS === 'web') return null;
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 2400);
    if (!clean) return null;
    await FS.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
    const file = `${DIR}${hash(`${TTS_MODEL}|${voiceId}|${lang}|${clean}`)}.mp3`;
    const info = await FS.getInfoAsync(file);
    if (info.exists) {
      lastTts = { ok: true };
      return file;
    }

    let reason = 'no audio returned';
    for (const model of [TTS_MODEL, TTS_FALLBACK_MODEL]) {
      const res = await api(
        `/v1/text-to-speech/${voiceId}?output_format=mp3_22050_32`,
        key,
        { method: 'POST', headers: { 'content-type': 'application/json', accept: 'audio/mpeg' }, body: JSON.stringify({ text: clean, model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1.0 } }) },
        30000,
      );
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        await FS.writeAsStringAsync(file, toBase64(bytes), { encoding: FS.EncodingType.Base64 });
        lastTts = { ok: true };
        return file;
      }
      const err = errorFromResponse(res.status, await res.text().catch(() => ''));
      reason = err.message;
      // a key or quota problem will not change with another model: stop here
      if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) break;
      // a 4xx about the model or voice (not on this plan, not found): try the fallback model
    }
    lastTts = { ok: false, reason };
    console.warn(`ElevenLabs speech skipped, using the phone voice: ${reason}`);
    return null;
  } catch (e) {
    const reason = (e as Error)?.message ?? 'unknown error';
    lastTts = { ok: false, reason };
    console.warn(`ElevenLabs speech skipped, using the phone voice: ${reason}`);
    return null;
  }
}

// ---- speech to text ----

/** Transcribes a recording. `lang` is a hint (Scribe also detects it); Hindi and English both work. Throws an ElevenError with the reason. */
export async function transcribe(uri: string, lang?: 'en' | 'hi'): Promise<string | null> {
  const key = await getKey();
  if (!key) return null;
  const form = new FormData();
  form.append('model_id', STT_MODEL);
  if (lang) form.append('language_code', lang);
  form.append('tag_audio_events', 'false');
  // React Native's FormData takes a { uri, name, type } descriptor for files
  form.append('file', { uri, name: 'speech.m4a', type: 'audio/m4a' } as unknown as Blob);
  const res = await api('/v1/speech-to-text', key, { method: 'POST', body: form }, 40000);
  if (!res.ok) return fail(res);
  const j = (await res.json()) as { text?: string };
  return j.text?.trim() || null;
}
