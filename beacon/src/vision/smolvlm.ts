// SmolVLM-256M (Hugging Face) image -> short text, on top of ONNX Runtime. Written against a tiny `Ort` interface so
// the same code runs under onnxruntime-node (tests) and onnxruntime-react-native (the phone).
import { Tokenizer } from './tokenizer';

export interface OrtTensor {
  readonly data: unknown;
  readonly dims: readonly number[];
}
export interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
}
export interface Ort {
  Tensor: new (type: string, data: ArrayLike<number> | ArrayLike<bigint>, dims: number[]) => OrtTensor;
}

export interface Sessions {
  vision: OrtSession;
  embed: OrtSession;
  decoder: OrtSession;
}

const IMAGE_SIZE = 512;
const IMAGE_TOKENS = 64; // (512/16)^2 / 4^2
const LAYERS = 30;
const KV_HEADS = 3;
const HEAD_DIM = 64;
const HIDDEN = 576;
const IMAGE_TOKEN = '<image>';

/**
 * RGBA pixels -> the two tensors the vision encoder wants: the picture scaled to fit 512x512 (aspect kept,
 * bilinear), normalised to [-1, 1] as planar RGB, plus a mask that marks the real (non-padding) pixels.
 */
export function preprocess(rgba: Uint8Array, w: number, h: number) {
  const scale = IMAGE_SIZE / Math.max(w, h);
  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));
  const plane = IMAGE_SIZE * IMAGE_SIZE;
  const pix = new Float32Array(3 * plane); // zeros = padding (after normalising, 0 is mid-grey)
  const mask = new Uint8Array(plane);
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(h - 1, Math.max(0, (y + 0.5) / scale - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(h - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(w - 1, Math.max(0, (x + 0.5) / scale - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(w - 1, x0 + 1);
      const fx = sx - x0;
      for (let c = 0; c < 3; c++) {
        const p00 = rgba[(y0 * w + x0) * 4 + c];
        const p01 = rgba[(y0 * w + x1) * 4 + c];
        const p10 = rgba[(y1 * w + x0) * 4 + c];
        const p11 = rgba[(y1 * w + x1) * 4 + c];
        const v = (p00 * (1 - fx) + p01 * fx) * (1 - fy) + (p10 * (1 - fx) + p11 * fx) * fy;
        pix[c * plane + y * IMAGE_SIZE + x] = (v / 255 - 0.5) / 0.5;
      }
      mask[y * IMAGE_SIZE + x] = 1;
    }
  }
  return { pixels: pix, mask };
}

/** `<|im_start|>User:<image>{question}<end_of_utterance>\nAssistant:` with the image expanded to its 64 slots. */
export function buildPrompt(tok: Tokenizer, question: string): number[] {
  return [
    tok.id('<|im_start|>'),
    ...tok.encode('User:'),
    tok.id('<fake_token_around_image>'),
    tok.id('<global-img>'),
    ...Array<number>(IMAGE_TOKENS).fill(tok.id(IMAGE_TOKEN)),
    tok.id('<fake_token_around_image>'),
    ...tok.encode(question),
    tok.id('<end_of_utterance>'),
    ...tok.encode('\nAssistant:'),
  ];
}

const i64 = (a: number[]) => BigInt64Array.from(a.map((x) => BigInt(x)));

function argmaxLast(logits: OrtTensor): number {
  const d = logits.data as Float32Array;
  const vocab = logits.dims[2];
  const off = (logits.dims[1] - 1) * vocab;
  let best = 0;
  let bv = -Infinity;
  for (let i = 0; i < vocab; i++) {
    const v = d[off + i];
    if (v > bv) {
      bv = v;
      best = i;
    }
  }
  return best;
}

export interface DescribeOptions {
  question?: string;
  maxNewTokens?: number;
  onToken?: (partial: string) => void;
}

export const DEFAULT_QUESTION = 'Describe what you see in one or two short sentences. Mention any injury, wound, burn, bite, fire, smoke, flood water, damage or person in danger.';

export async function describe(ort: Ort, s: Sessions, tok: Tokenizer, rgba: Uint8Array, w: number, h: number, opts: DescribeOptions = {}): Promise<string> {
  const maxNew = opts.maxNewTokens ?? 48;
  const eos = tok.id('<end_of_utterance>');
  const imageId = tok.id(IMAGE_TOKEN);
  const ids = buildPrompt(tok, opts.question ?? DEFAULT_QUESTION);

  // 1. picture -> 64 feature vectors
  const { pixels, mask } = preprocess(rgba, w, h);
  const vis = await s.vision.run({
    pixel_values: new ort.Tensor('float32', pixels, [1, 1, 3, IMAGE_SIZE, IMAGE_SIZE]),
    pixel_attention_mask: new ort.Tensor('bool', mask, [1, 1, IMAGE_SIZE, IMAGE_SIZE]),
  });
  const feats = vis[s.vision.outputNames[0]].data as Float32Array;

  // 2. prompt ids -> embeddings, with the <image> slots replaced by the picture features
  const emb = (await s.embed.run({ input_ids: new ort.Tensor('int64', i64(ids), [1, ids.length]) }))[s.embed.outputNames[0]].data as Float32Array;
  const inputs = Float32Array.from(emb);
  let slot = 0;
  ids.forEach((id, i) => {
    if (id === imageId) inputs.set(feats.subarray(slot * HIDDEN, (slot + 1) * HIDDEN), i * HIDDEN), slot++;
  });
  if (slot !== IMAGE_TOKENS) throw new Error(`expected ${IMAGE_TOKENS} image slots, filled ${slot}`);

  // 3. greedy decoding with a KV cache
  let past: Record<string, OrtTensor> = {};
  for (let l = 0; l < LAYERS; l++)
    for (const kv of ['key', 'value']) past[`past_key_values.${l}.${kv}`] = new ort.Tensor('float32', new Float32Array(0), [1, KV_HEADS, 0, HEAD_DIM]);

  const out: number[] = [];
  let step: Float32Array = inputs;
  let stepLen = ids.length;
  let total = ids.length;
  for (let n = 0; n < maxNew; n++) {
    const positions = Array.from({ length: stepLen }, (_, k) => total - stepLen + k);
    const res = await s.decoder.run({
      inputs_embeds: new ort.Tensor('float32', step, [1, stepLen, HIDDEN]),
      attention_mask: new ort.Tensor('int64', i64(Array<number>(total).fill(1)), [1, total]),
      position_ids: new ort.Tensor('int64', i64(positions), [1, stepLen]),
      ...past,
    });
    const next = argmaxLast(res.logits);
    if (next === eos) break;
    out.push(next);
    opts.onToken?.(tok.decode(out));
    past = {};
    for (let l = 0; l < LAYERS; l++) {
      past[`past_key_values.${l}.key`] = res[`present.${l}.key`];
      past[`past_key_values.${l}.value`] = res[`present.${l}.value`];
    }
    const e = (await s.embed.run({ input_ids: new ort.Tensor('int64', i64([next]), [1, 1]) }))[s.embed.outputNames[0]].data as Float32Array;
    step = Float32Array.from(e);
    stepLen = 1;
    total += 1;
  }
  return tok.decode(out).trim();
}
