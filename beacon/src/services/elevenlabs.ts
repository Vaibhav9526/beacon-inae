import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FS from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { toBase64, toHex, utf8 } from '../mesh/bytes';
import { sha256 } from '@noble/hashes/sha2.js';

// ElevenLabs: speech-to-text (Scribe) and text-to-speech. The API key lives only in the Android keystore (SecureStore),
// never in settings, logs or the server. Every call is made straight from the phone to ElevenLabs.

const API = 'https://api.elevenlabs.io';
const KEY_NAME = 'beacon.elevenlabs.key';
const VOICES_KEY = 'beacon.elevenlabs.voices.v1';
const DIR = `${FS.cacheDirectory ?? ''}tts/`;

export const TTS_MODEL = 'eleven_flash_v2_5'; // low latency, covers Hindi and English
export const TTS_FALLBACK_MODEL = 'eleven_multilingual_v2';
export const STT_MODEL = 'scribe_v2';

export type VoiceRole = 'didi' | 'asha' | 'veer' | 'default';
export interface Voice {
  id: string;
  name: string;
  gender?: string;
}

interface KeyState {
  has: boolean;
  checked: boolean;
  voices: Partial<Record<VoiceRole, Voice>>;
  load(): Promise<void>;
  save(key: string): Promise<{ ok: boolean; error?: string }>;
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

export const useEleven = create<KeyState>((set, get) => ({
  has: false,
  checked: false,
  voices: {},

  async load() {
    const k = await getKey();
    let voices: KeyState['voices'] = {};
    try {
      voices = JSON.parse((await AsyncStorage.getItem(VOICES_KEY)) ?? '{}');
    } catch {
      /* none yet */
    }
    set({ has: !!k, checked: true, voices });
  },

  async save(key) {
    const k = key.trim();
    if (!k) return { ok: false, error: 'empty key' };
    // validate with a free call and pick voices in the same go
    try {
      const list = await fetchVoices(k);
      cachedKey = k;
      await secure.set(k);
      const voices = pickVoices(list);
      await AsyncStorage.setItem(VOICES_KEY, JSON.stringify(voices));
      set({ has: true, voices });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async clear() {
    cachedKey = null;
    await secure.del().catch(() => {});
    await AsyncStorage.removeItem(VOICES_KEY).catch(() => {});
    await FS.deleteAsync(DIR, { idempotent: true }).catch(() => {});
    set({ has: false, voices: {} });
  },

  async setVoice(role, v) {
    const voices = { ...get().voices, [role]: v };
    set({ voices });
    await AsyncStorage.setItem(VOICES_KEY, JSON.stringify(voices)).catch(() => {});
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

async function fail(res: Response): Promise<never> {
  let detail = '';
  try {
    const j = (await res.json()) as { detail?: { message?: string } | string };
    detail = typeof j.detail === 'string' ? j.detail : (j.detail?.message ?? '');
  } catch {
    /* no JSON body */
  }
  throw new Error(res.status === 401 ? 'ElevenLabs rejected the key' : `ElevenLabs error ${res.status}${detail ? `: ${detail}` : ''}`);
}

export async function fetchVoices(key: string): Promise<Voice[]> {
  const res = await api('/v1/voices', key);
  if (!res.ok) return fail(res);
  const j = (await res.json()) as { voices: { voice_id: string; name: string; category?: string; labels?: Record<string, string> }[] };
  return j.voices.filter((v) => !v.category || v.category === 'premade' || v.category === 'professional').map((v) => ({ id: v.voice_id, name: v.name, gender: v.labels?.gender }));
}

/** Give each character a fitting voice: two different women for Didi and Dr. Asha, a man for Captain Veer. */
export function pickVoices(list: Voice[]): KeyState['voices'] {
  const women = list.filter((v) => v.gender === 'female');
  const men = list.filter((v) => v.gender === 'male');
  const any = list[0];
  return {
    didi: women[0] ?? any,
    asha: women[1] ?? women[0] ?? any,
    veer: men[0] ?? any,
    default: women[0] ?? any,
  };
}

// ---- text to speech ----

const hash = (s: string) => toHex(sha256(utf8(s))).slice(0, 24);

/** Returns a local mp3 for the text, from cache when this exact phrase was spoken before. */
export async function synthesize(text: string, voiceId: string, lang: 'en' | 'hi'): Promise<string | null> {
  const key = await getKey();
  if (!key || Platform.OS === 'web') return null;
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 2400);
  if (!clean) return null;
  await FS.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  const file = `${DIR}${hash(`${TTS_MODEL}|${voiceId}|${lang}|${clean}`)}.mp3`;
  const info = await FS.getInfoAsync(file);
  if (info.exists) return file;

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
      return file;
    }
    if (res.status === 401 || res.status === 429 || res.status >= 500) await fail(res);
    // a 4xx about the model (not available on this plan): try the fallback model
  }
  return null;
}

// ---- speech to text ----

/** Transcribes a recording. `lang` is a hint (Scribe also detects it); Hindi and English both work. */
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
