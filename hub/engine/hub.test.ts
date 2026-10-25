import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { haikuWriter } from './brains.ts';
import { Hub } from './hub.ts';
import { newKey, HealthStore } from './healthStore.ts';
import { Outbox, AuditLog } from './outbox.ts';
import type { Sender } from './outbox.ts';
import { instantiate, templateById } from './templates.ts';
import type { Alert } from './types.ts';

function setup(answer: 'once' | 'always' | 'no' = 'once') {
  const dir = mkdtempSync(join(tmpdir(), 'hub-'));
  const sent: string[] = [];
  const sender = (channel: 'telegram' | 'beacon'): Sender => ({ channel, send: async (t) => void sent.push(`${channel}:${t}`) });
  const asked: string[] = [];
  const health = new HealthStore(join(dir, 'h.bin'), newKey());
  health.add({ member: 'Maa', at: Date.now(), hr: 112, spo2: 91 });
  const audit = new AuditLog(join(dir, 'audit.jsonl'));
  const outbox = new Outbox({ senders: [sender('telegram'), sender('beacon')], audit, ask: async (_a, t) => (asked.push(t), answer) });
  const hub = new Hub({ dir, health, outbox, source: { offline: true } });
  return { hub, sent, asked, audit };
}

test('heatwave + Maa vitals make one approved, logged alert; the second run stays quiet', async () => {
  const { hub, sent, asked, audit } = setup('always');
  hub.upsert(instantiate(templateById('heatwave-guardian')!, { members: ['Maa'] }));
  const first = await hub.tick(true);
  assert.equal(first.length, 1);
  assert.equal(first[0].status, 'sent');
  assert.ok(sent.some((s) => s.startsWith('telegram:')) && sent.some((s) => s.startsWith('beacon:')));
  assert.equal(asked.length, 1);
  assert.match(sent[0], /Maa|heart rate/i);
  assert.ok(audit.read().some((l) => l.event === 'sent'));
  const second = await hub.tick(true);
  assert.equal(second.length, 0, 'same situation is not repeated');
});

test('declining the first send suppresses it and nothing leaves', async () => {
  const { hub, sent } = setup('no');
  hub.upsert(instantiate(templateById('heatwave-guardian')!, { members: ['Maa'] }));
  const r = await hub.tick(true);
  assert.equal(r[0].status, 'suppressed');
  assert.equal(sent.length, 0);
});

test('haiku wording is dropped when it invents a number', async () => {
  const alert = { severity: 'severe' } as Alert;
  const w = haikuWriter(async () => 'Maa heart rate 150, move to a cooler room');
  assert.equal(await w(alert, 'Urgent: Maa heart rate 112, heatwave at 43 C.'), null);
  const ok = haikuWriter(async () => 'Maa heart rate 112 in a 43 C heatwave. Move to a cooler room.');
  assert.match((await ok(alert, 'Urgent: Maa heart rate 112, heatwave at 43 C.')) ?? '', /112/);
});
