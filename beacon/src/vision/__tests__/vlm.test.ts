import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import { buildPrompt, describe, preprocess } from '../smolvlm';
import { Tokenizer } from '../tokenizer';

// The model files are not in the repo (260 MB). Fetch them once into ../vendor/smolvlm (see README), then these run.
const DIR = join(process.cwd(), '..', 'vendor', 'smolvlm');
const SAMPLE = join(process.cwd(), '..', 'vendor', 'samples', 'parrots.png');
const haveTok = existsSync(join(DIR, 'tokenizer.json'));
const haveModels = haveTok && existsSync(join(DIR, 'onnx', 'decoder_model_merged_int8.onnx')) && existsSync(SAMPLE);

test('tokenizer round-trips text, digits and newlines', { skip: !haveTok }, () => {
  const tok = new Tokenizer(JSON.parse(readFileSync(join(DIR, 'tokenizer.json'), 'utf8')));
  for (const t of ['Hello, world!', 'Call 112 now', 'café déjà vu', 'a\nb', 'हिन्दी text']) assert.equal(tok.decode(tok.encode(t)), t);
  assert.equal(tok.encode('112').length, 3, 'digits are split one by one');
  assert.equal(tok.id('<end_of_utterance>'), 49279);
});

test('prompt layout has exactly 64 image slots between the image markers', { skip: !haveTok }, () => {
  const tok = new Tokenizer(JSON.parse(readFileSync(join(DIR, 'tokenizer.json'), 'utf8')));
  const ids = buildPrompt(tok, 'What is this?');
  assert.equal(ids[0], tok.id('<|im_start|>'));
  assert.equal(ids.filter((i) => i === tok.id('<image>')).length, 64);
  assert.equal(ids.at(-1), tok.encode('\nAssistant:').at(-1));
});

test('preprocess keeps aspect, pads, and normalises to [-1, 1]', () => {
  const w = 200;
  const h = 100;
  const rgba = new Uint8Array(w * h * 4).fill(255);
  const { pixels, mask } = preprocess(rgba, w, h);
  assert.equal(pixels.length, 3 * 512 * 512);
  assert.equal(mask[0], 1);
  assert.equal(mask[(255 * 512) + 10], 1, 'inside the scaled picture (512x256)');
  assert.equal(mask[(300 * 512) + 10], 0, 'padding below it');
  assert.ok(Math.abs(pixels[0] - 1) < 1e-6, 'white maps to +1');
  assert.equal(pixels[300 * 512 + 10], 0, 'padding is zero');
});

test('SmolVLM describes a real photo', { skip: !haveModels, timeout: 300_000 }, async () => {
  const ort = await import('onnxruntime-node');
  const tok = new Tokenizer(JSON.parse(readFileSync(join(DIR, 'tokenizer.json'), 'utf8')));
  const s = {
    vision: await ort.InferenceSession.create(join(DIR, 'onnx', 'vision_encoder_int8.onnx')),
    embed: await ort.InferenceSession.create(join(DIR, 'onnx', 'embed_tokens_int8.onnx')),
    decoder: await ort.InferenceSession.create(join(DIR, 'onnx', 'decoder_model_merged_int8.onnx')),
  };
  const png = PNG.sync.read(readFileSync(SAMPLE));
  const text = await describe(ort as never, s as never, tok, new Uint8Array(png.data), png.width, png.height, { question: 'What is in this image?', maxNewTokens: 30 });
  assert.match(text.toLowerCase(), /parrot|bird/);
});
