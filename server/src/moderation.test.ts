import assert from 'node:assert/strict';
import { test } from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import { ClaudeScreener, clip60 } from './moderation.ts';

const base = { caption: 'water in the street', lat: 28.6, lon: 77.2, capturedAt: Date.now(), delayed: false, kind: 'photo' as const, image: { data: Buffer.from('x'.repeat(200)), mime: 'image/jpeg' } };

const verdict = (v: Partial<Record<string, unknown>> = {}) =>
  JSON.stringify({ relevant: true, authenticity: 'likely', category: 'flood', concerns: [], safe_to_publish: true, summary: 'Knee-deep water on a market street.', ...v });

const fake = (create: (req: any) => unknown) => ({ beta: { messages: { create: async (req: any) => create(req) } } }) as never;
const reply = (text: string, stop_reason = 'end_turn') => ({ stop_reason, content: [{ type: 'text', text }] });

test('a relevant, likely-authentic, safe photo is approved and sent with the right request shape', async () => {
  let seen: any;
  const s = new ClaudeScreener('k', fake((req) => ((seen = req), reply(verdict()))));
  const r = await s.screen(base);
  assert.equal(r.decision, 'approve');
  assert.equal(r.category, 'flood');
  assert.equal(r.source, 'ai');
  assert.equal(seen.model, 'claude-opus-5-5');
  assert.deepEqual(seen.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(seen.fallbacks, 'default');
  assert.equal(seen.output_config.format.type, 'json_schema');
  assert.equal(seen.output_config.effort, 'low');
  assert.ok(!('temperature' in seen) && !('thinking' in seen) && !('tool_choice' in seen), 'no parameters that Opus 5.5 rejects');
  assert.equal(seen.messages[0].content[0].type, 'image');
  assert.match(seen.messages[0].content[1].text, /water in the street/);
});

test('anything doubtful goes to human moderators instead of being auto-approved', async () => {
  for (const v of [{ authenticity: 'suspicious' }, { authenticity: 'uncertain' }, { relevant: false }, { safe_to_publish: false }]) {
    const r = await new ClaudeScreener('k', fake(() => reply(verdict(v)))).screen(base);
    assert.equal(r.decision, 'review', JSON.stringify(v));
  }
});

test('videos are never auto-approved, even with a clean poster frame', async () => {
  const r = await new ClaudeScreener('k', fake(() => reply(verdict()))).screen({ ...base, kind: 'video' });
  assert.equal(r.decision, 'review');
});

test('a refusal, a broken reply and an API outage all fail safe to review', async () => {
  const refusal = await new ClaudeScreener('k', fake(() => reply('', 'refusal'))).screen(base);
  assert.equal(refusal.decision, 'review');
  const junk = await new ClaudeScreener('k', fake(() => reply('not json'))).screen(base);
  assert.equal(junk.decision, 'review');
  const down = await new ClaudeScreener('k', fake(() => { throw new Anthropic.APIError(529, undefined, 'overloaded', undefined); })).screen(base);
  assert.equal(down.decision, 'review');
  assert.match(down.concerns[0], /529/);
  const noImage = await new ClaudeScreener('k', fake(() => reply(verdict()))).screen({ ...base, image: undefined });
  assert.equal(noImage.decision, 'review');
});

test('summaries are capped near 60 words', () => {
  const long = Array.from({ length: 200 }, (_, i) => `w${i}`).join(' ');
  assert.ok(clip60(long).split(' ').length <= 59);
  assert.equal(clip60('short text'), 'short text');
});
