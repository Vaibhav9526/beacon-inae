import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AuditLog, Outbox } from './outbox.ts';
import type { Sender } from './outbox.ts';
import type { Alert, Channel } from './types.ts';

const alert = (channels: Channel[], id = 'a1'): Alert => ({
  id,
  severity: 'warning',
  title: 'Heatwave',
  body: 'Heat index 44 C in Delhi',
  channels,
  signals: [],
  at: Date.now(),
  status: 'pending-approval',
});

function setup(answer: 'once' | 'always' | 'no') {
  const dir = mkdtempSync(join(tmpdir(), 'outbox-'));
  const audit = new AuditLog(join(dir, 'audit.jsonl'));
  const sent: string[] = [];
  const failures = new Set<Channel>();
  const sender = (channel: Channel): Sender => ({
    channel,
    send: async (t) => {
      if (failures.has(channel)) throw new Error(`${channel} is unreachable`);
      sent.push(`${channel}:${t}`);
    },
  });
  const asked: string[] = [];
  const onAllowed: Channel[] = [];
  const outbox = new Outbox({
    senders: [sender('telegram'), sender('beacon')],
    audit,
    ask: async (_a, t) => (asked.push(t), answer),
    onAllowed: (c) => onAllowed.push(c),
  });
  return { outbox, audit, sent, asked, failures, onAllowed };
}

test('first send asks and goes out once; "once" asks again next time', async () => {
  const { outbox, audit, sent, asked } = setup('once');
  const first = await outbox.deliver(alert(['telegram']), 'Warning: Heat index 44 C in Delhi');
  assert.equal(first.status, 'sent');
  assert.deepEqual(sent, ['telegram:Warning: Heat index 44 C in Delhi']);
  assert.deepEqual(asked, ['Warning: Heat index 44 C in Delhi']);
  const second = await outbox.deliver(alert(['telegram'], 'a2'), 'Warning: Heat index 45 C in Delhi');
  assert.equal(second.status, 'sent');
  assert.equal(asked.length, 2, '"once" does not remember the channel');
  assert.ok(audit.read().some((l) => l.event === 'approved' && l.channel === 'gate'));
});

test('"always" remembers each channel separately', async () => {
  const { outbox, audit, asked, onAllowed } = setup('always');
  await outbox.deliver(alert(['telegram']), 'Warning: one');
  assert.equal(asked.length, 1);
  assert.deepEqual(onAllowed, ['telegram']);
  const second = await outbox.deliver(alert(['telegram'], 'a2'), 'Warning: two');
  assert.equal(second.status, 'sent');
  assert.equal(asked.length, 1, 'telegram is remembered');
  const lines = audit.read();
  assert.ok(lines.some((l) => l.event === 'auto-approved' && l.alertId === 'a2'));
  const again = await outbox.deliver(alert(['beacon'], 'a3'), 'Warning: three');
  assert.equal(again.status, 'sent');
  assert.equal(asked.length, 2, 'beacon still needs its own yes');
  assert.ok(onAllowed.includes('beacon'));
});

test('"no" suppresses the alert and nothing leaves', async () => {
  const { outbox, audit, sent, asked } = setup('no');
  const r = await outbox.deliver(alert(['telegram', 'beacon']), 'Warning: Heat index 44 C in Delhi');
  assert.equal(r.status, 'suppressed');
  assert.equal(r.note, 'Declined by you');
  assert.equal(sent.length, 0, 'no sender was ever called');
  assert.equal(asked.length, 1);
  const lines = audit.read();
  assert.ok(lines.some((l) => l.event === 'queued' && l.channel === 'gate'));
  assert.ok(lines.some((l) => l.event === 'declined' && l.channel === 'gate'));
  assert.ok(!lines.some((l) => l.event === 'sent'), 'nothing is logged as sent');
});

test('failed sender marks the alert failed and the audit log carries the error', async () => {
  const { outbox, audit, failures } = setup('always');
  failures.add('telegram');
  const both = await outbox.deliver(alert(['telegram', 'beacon']), 'Warning: Heat index 44 C in Delhi');
  assert.equal(both.status, 'sent', 'one working channel is enough');
  assert.equal(both.note, '1 of 2 channels failed');
  const all = await outbox.deliver(alert(['telegram'], 'a2'), 'Warning: Heat index 45 C in Delhi');
  assert.equal(all.status, 'failed');
  const lines = audit.read().filter((l) => l.alertId === 'a2');
  const failedLine = lines.find((l) => l.event === 'failed');
  assert.ok(failedLine);
  assert.equal(failedLine!.error, 'telegram is unreachable');
  assert.ok(lines.some((l) => l.event === 'queued'));
});

test('an alert with no matching sender fails without asking', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'outbox-'));
  const audit = new AuditLog(join(dir, 'audit.jsonl'));
  const outbox = new Outbox({
    senders: [{ channel: 'telegram', send: async () => undefined }],
    audit,
    ask: async () => {
      throw new Error('must not be asked');
    },
  });
  const r = await outbox.deliver(alert(['beacon']), 'Warning: Heat index 44 C in Delhi');
  assert.equal(r.status, 'failed');
  assert.match(r.note ?? '', /No connected channel/);
  assert.equal(audit.read().length, 0, 'nothing was queued, so nothing is logged');
});

test('the audit log records the full happy-path journey', async () => {
  const { outbox, audit } = setup('always');
  await outbox.deliver(alert(['telegram']), 'Warning: Heat index 44 C in Delhi');
  const lines = audit.read();
  const events = lines.map((l) => l.event);
  assert.deepEqual(events, ['queued', 'approved', 'sent']);
  for (const l of lines) {
    assert.equal(l.alertId, 'a1');
    assert.equal(l.text, 'Warning: Heat index 44 C in Delhi');
    assert.ok(typeof l.at === 'number');
  }
  assert.equal(lines.at(-1)!.channel, 'telegram');
});
