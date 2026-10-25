// Downloads what the tests and local builds need but the repo does not hold:
//   ../vendor/needle   Needle weights + Android engine (bundled into the APK by modules/beacon-ai)
//   ../vendor/smolvlm  SmolVLM-256M int8 ONNX + tokenizer (only for `npm test` vision test; the app downloads its own copy)
// Usage: node scripts/fetch-models.mjs [needle] [smolvlm]
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = join(process.cwd(), '..', 'vendor');
const HF = 'https://huggingface.co';
const sets = {
  needle: [
    [`${HF}/Cactus-Compute/needle3/resolve/main/needle3.cact`, 'needle/needle3.cact'],
    [`${HF}/Cactus-Compute/needle3/resolve/main/android-arm64/libneedle.a`, 'needle/android-arm64/libneedle.a'],
    [`${HF}/Cactus-Compute/needle3/resolve/main/android-arm64/needle.h`, 'needle/android-arm64/needle.h'],
  ],
  smolvlm: [
    ...['tokenizer.json'].map((f) => [`${HF}/HuggingFaceTB/SmolVLM-256M-Instruct/resolve/main/${f}`, `smolvlm/${f}`]),
    ...['vision_encoder_int8', 'embed_tokens_int8', 'decoder_model_merged_int8'].map((f) => [`${HF}/HuggingFaceTB/SmolVLM-256M-Instruct/resolve/main/onnx/${f}.onnx`, `smolvlm/onnx/${f}.onnx`]),
    [`${HF}/datasets/Narsil/image_dummy/resolve/main/parrots.png`, 'samples/parrots.png'],
  ],
};

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(sets);
for (const name of wanted) {
  for (const [url, rel] of sets[name] ?? []) {
    const dest = join(root, rel);
    if (existsSync(dest) && statSync(dest).size > 0) {
      console.log('have', rel);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    process.stdout.write(`get  ${rel} ... `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
    console.log(`${(statSync(dest).size / 1e6).toFixed(1)} MB`);
  }
}
console.log('done. For Needle, copy vendor/needle/* into modules/beacon-ai/android/src/main/{assets,cpp/lib/arm64-v8a,cpp/include} (already done in this checkout).');
