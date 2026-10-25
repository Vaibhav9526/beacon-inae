import * as FS from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import jpeg from 'jpeg-js';
import { NativeModules, Platform } from 'react-native';
import { create } from 'zustand';
import { fromBase64 } from '../mesh/bytes';
import { type Ort, type OrtSession, type Sessions, describe } from '../vision/smolvlm';
import { Tokenizer } from '../vision/tokenizer';

// The on-device photo helper: Hugging Face SmolVLM-256M-Instruct (int8 ONNX, about 260 MB). It is downloaded once
// (the app works without it) and then runs entirely on the phone. The photo never leaves the device.

const BASE = 'https://huggingface.co/HuggingFaceTB/SmolVLM-256M-Instruct/resolve/main';
const DIR = `${FS.documentDirectory ?? ''}vlm/`;

export const VLM_FILES = [
  { name: 'tokenizer.json', url: `${BASE}/tokenizer.json`, bytes: 3548256 },
  { name: 'embed_tokens_int8.onnx', url: `${BASE}/onnx/embed_tokens_int8.onnx`, bytes: 28385824 },
  { name: 'vision_encoder_int8.onnx', url: `${BASE}/onnx/vision_encoder_int8.onnx`, bytes: 94247927 },
  { name: 'decoder_model_merged_int8.onnx', url: `${BASE}/onnx/decoder_model_merged_int8.onnx`, bytes: 137221530 },
] as const;
export const VLM_TOTAL = VLM_FILES.reduce((a, f) => a + f.bytes, 0);

interface VlmState {
  status: 'unknown' | 'missing' | 'downloading' | 'ready' | 'error';
  progress: number;
  error: string | null;
  check(): Promise<void>;
  download(): Promise<void>;
  remove(): Promise<void>;
}

async function present(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  for (const f of VLM_FILES) {
    const i = await FS.getInfoAsync(DIR + f.name);
    if (!i.exists || (i as { size?: number }).size !== f.bytes) return false;
  }
  return true;
}

// ---- cancellation ----
// The running DownloadResumable, the temp file it writes and a flag the download loop checks between files.
// Cancellation keeps every finished file (they are skipped on the next run) and drops the partial one.

let activeJobs: FS.DownloadResumable[] = [];
let cancelRequested = false;
let inflightTmp: string | null = null;

/** Stop the running model download. Status settles back to 'missing' (or 'ready' if all files were already done). */
export function cancelVlmDownload() {
  if (useVlm.getState().status !== 'downloading') return;
  cancelRequested = true;
  const jobs = activeJobs;
  activeJobs = [];
  for (const j of jobs) void j.cancelAsync().catch(() => {});
  // cancelled between files: nothing in flight would reject on its own, so settle the state here
  if (jobs.length === 0 && !inflightTmp) void reflectCancel();
}

async function reflectCancel(): Promise<void> {
  const tmp = inflightTmp;
  inflightTmp = null;
  activeJobs = [];
  if (tmp) void FS.deleteAsync(tmp, { idempotent: true }).catch(() => {});
  if (await present()) {
    useVlm.setState({ status: 'ready', progress: 1, error: null });
    return;
  }
  let done = 0;
  for (const f of VLM_FILES) {
    const i = await FS.getInfoAsync(DIR + f.name);
    if (i.exists && (i as { size?: number }).size === f.bytes) done += f.bytes;
  }
  useVlm.setState({ status: 'missing', progress: done / VLM_TOTAL, error: null });
}

export const useVlm = create<VlmState>((set, get) => ({
  status: 'unknown',
  progress: 0,
  error: null,

  async check() {
    set({ status: (await present()) ? 'ready' : 'missing' });
  },

  async download() {
    if (get().status === 'downloading') return;
    set({ status: 'downloading', progress: 0, error: null });
    try {
      await FS.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
      let done = 0;
      for (const f of VLM_FILES) {
        if (cancelRequested) break;
        const dest = DIR + f.name;
        const info = await FS.getInfoAsync(dest);
        if (info.exists && (info as { size?: number }).size === f.bytes) {
          done += f.bytes;
          set({ progress: done / VLM_TOTAL });
          continue;
        }
        if (cancelRequested) break;
        const tmp = dest + '.part';
        const job = FS.createDownloadResumable(f.url, tmp, {}, (p) => set({ progress: (done + p.totalBytesWritten) / VLM_TOTAL }));
        activeJobs.push(job);
        inflightTmp = tmp;
        try {
          const res = await job.downloadAsync();
          if (!res || res.status >= 400) throw new Error(`download failed (${res?.status ?? 'no response'}) for ${f.name}`);
        } finally {
          inflightTmp = null;
          activeJobs = activeJobs.filter((j) => j !== job);
        }
        if (cancelRequested) break;
        await FS.moveAsync({ from: tmp, to: dest });
        done += f.bytes;
      }
      if (cancelRequested) {
        cancelRequested = false;
        await reflectCancel();
        return;
      }
      set({ status: (await present()) ? 'ready' : 'error', progress: 1, error: (await present()) ? null : 'downloaded files look incomplete' });
    } catch (e) {
      if (cancelRequested) {
        cancelRequested = false;
        await reflectCancel();
        return;
      }
      set({ status: 'error', error: String((e as Error).message ?? e) });
    }
  },

  async remove() {
    release();
    await FS.deleteAsync(DIR, { idempotent: true }).catch(() => {});
    set({ status: 'missing', progress: 0 });
  },
}));

// ---- inference ----

// ONNX Runtime has native code. Load it lazily so a build without it (or Expo Go, or web) still runs everything else.
let ortMod: typeof import('onnxruntime-react-native') | null | undefined;
function ort(): typeof import('onnxruntime-react-native') | null {
  if (ortMod !== undefined) return ortMod;
  // the package throws at import when its native half is missing, so look for that half first
  if (!NativeModules.Onnxruntime) {
    console.warn('[vlm] NativeModules.Onnxruntime is missing; keys:', Object.keys(NativeModules).filter((k) => /onnx|ort/i.test(k)).join(',') || 'none');
    return (ortMod = null);
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ortMod = require('onnxruntime-react-native');
  } catch (e) {
    console.warn('[vlm] onnxruntime failed to load:', e instanceof Error ? e.message : String(e));
    ortMod = null;
  }
  return ortMod ?? null;
}

export const ortAvailable = () => Platform.OS !== 'web' && ort() !== null;

interface Loaded {
  sessions: Sessions;
  tok: Tokenizer;
}
let loaded: Loaded | null = null;
let loading: Promise<Loaded> | null = null;
let idle: ReturnType<typeof setTimeout> | null = null;

const strip = (p: string) => p.replace(/^file:\/\//, '');

async function load(): Promise<Loaded> {
  if (loaded) return loaded;
  const rt = ort();
  if (!rt) throw new Error('ONNX Runtime is not in this build');
  loading ??= (async () => {
    const make = (n: string) => rt.InferenceSession.create(strip(DIR + n), { executionProviders: ['cpu'], graphOptimizationLevel: 'all' }) as unknown as Promise<OrtSession>;
    const [vision, embed, decoder] = await Promise.all([make('vision_encoder_int8.onnx'), make('embed_tokens_int8.onnx'), make('decoder_model_merged_int8.onnx')]);
    const tok = new Tokenizer(JSON.parse(await FS.readAsStringAsync(DIR + 'tokenizer.json')));
    loaded = { sessions: { vision, embed, decoder }, tok };
    return loaded;
  })().finally(() => (loading = null));
  return loading as Promise<Loaded>;
}

/** Free the ~300 MB the model holds in memory. Called after a few idle minutes and when removing the files. */
export function release() {
  const l = loaded;
  loaded = null;
  if (idle) clearTimeout(idle);
  idle = null;
  if (l) for (const s of Object.values(l.sessions)) (s as unknown as { release?: () => Promise<void> }).release?.().catch(() => {});
}

export async function describePhoto(uri: string, question?: string): Promise<string | null> {
  if (Platform.OS === 'web' || !(await present())) return null;
  try {
    if (idle) clearTimeout(idle);
    const { sessions, tok } = await load();
    // decode the camera JPEG at a small size: 512 px is all the model sees
    const small = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 512 } }], { format: ImageManipulator.SaveFormat.JPEG, compress: 0.9, base64: true });
    if (!small.base64) return null;
    const img = jpeg.decode(fromBase64(small.base64), { useTArray: true, formatAsRGBA: true });
    const text = await describe({ Tensor: ort()!.Tensor } as unknown as Ort, sessions, tok, img.data as unknown as Uint8Array, img.width, img.height, { question, maxNewTokens: 40 });
    idle = setTimeout(release, 3 * 60_000);
    return text || null;
  } catch {
    return null;
  }
}
