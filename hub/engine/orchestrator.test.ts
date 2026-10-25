import assert from 'node:assert/strict';
import { test } from 'node:test';
import { combine, emptyState } from './orchestrator.ts';
import type { Channel, Severity, Signal } from './types.ts';

const HOURS = 60 * 60 * 1000;
const NOW = 1_700_000_000_000;
const channels: Channel[] = ['telegram'];

let n = 0;
const sig = (over: Partial<Signal> = {}): Signal => ({
  agentId: 'a1',
  agentName: 'Weather watch',
  ruleId: 'r1',
  severity: 'watch' as Severity,
  title: 'Heatwave',
  body: 'Heat index 44 C',
  metrics: {},
  fingerprint: 'heat:delhi',
  tags: ['hazard'],
  at: NOW,
  ...over,
});

test('the same fingerprint stays quiet for 3 hours, then can fire again', () => {
  const first = combine([sig()], emptyState(), channels, NOW);
  assert.equal(first.alerts.length, 1);
  const quiet = combine([sig()], first.state, channels, NOW + 2 * HOURS);
  assert.equal(quiet.alerts.length, 0, 'still inside the quiet window');
  const exactly3h = combine([sig()], first.state, channels, NOW + 3 * HOURS);
  assert.equal(exactly3h.alerts.length, 0, 'the window needs to be strictly passed');
  const again = combine([sig()], first.state, channels, NOW + 3 * HOURS + 1);
  assert.equal(again.alerts.length, 1, 'after 3 hours the same situation may be told again');
});

test('a rise in severity breaks the quiet period', () => {
  const first = combine([sig({ severity: 'watch' })], emptyState(), channels, NOW);
  assert.equal(first.alerts[0].severity, 'watch');
  const worse = combine([sig({ severity: 'severe', title: 'Heatwave worse', body: 'Heat index 46 C' })], first.state, channels, NOW + 1 * HOURS);
  assert.equal(worse.alerts.length, 1);
  assert.equal(worse.alerts[0].severity, 'severe');
  assert.equal(worse.alerts[0].body, 'Heat index 46 C');
  const same = combine([sig({ severity: 'severe' })], worse.state, channels, NOW + 2 * HOURS);
  assert.equal(same.alerts.length, 0, 'same severity stays quiet');
});

test('identical bodies from different agents merge into one line', () => {
  const a = sig({ fingerprint: 'heat:delhi', agentId: 'w1' });
  const b = sig({ fingerprint: 'heat2:delhi', agentId: 'w2', ruleId: 'r2' });
  const r = combine([a, b], emptyState(), channels, NOW);
  assert.equal(r.alerts.length, 1, 'same place and family is one story');
  assert.equal(r.alerts[0].body, 'Heat index 44 C', 'no duplicate line');
  assert.equal(r.alerts[0].signals.length, 2);
  assert.ok(r.alerts[0].signals.map((s) => s.fingerprint).includes('heat2:delhi'), 'subsequent quiet periods track every fingerprint');
  assert.ok(Object.hasOwn(r.state.sent, 'heat2:delhi'));
});

test('different bodies in one cluster are joined and truncated to 320 chars', () => {
  const a = sig({ fingerprint: 'heat:delhi', body: 'Heat index 44 C' });
  const b = sig({ fingerprint: 'heat2:delhi', agentId: 'w2', body: 'AQI 410 very poor' });
  const r = combine([a, b], emptyState(), channels, NOW);
  assert.equal(r.alerts.length, 1);
  assert.equal(r.alerts[0].body, 'Heat index 44 C AQI 410 very poor');
  const long = sig({ fingerprint: 'heat:delhi', body: 'x'.repeat(400) });
  const t = combine([long], emptyState(), channels, NOW + 5 * HOURS);
  assert.equal(t.alerts[0].body.length, 320);
});

test('alerts come out worst first', () => {
  const r = combine(
    [
      sig({ fingerprint: 'heat:kerala', severity: 'info', title: 'Warm', body: 'It is warm' }),
      sig({ fingerprint: 'flood:delhi', severity: 'severe', title: 'Flood', body: 'Water level rising', tags: ['hazard'] }),
    ],
    emptyState(),
    channels,
    NOW,
  );
  assert.equal(r.alerts.length, 2, 'different places are separate stories');
  assert.equal(r.alerts[0].severity, 'severe');
  assert.equal(r.alerts[1].severity, 'info');
  assert.deepEqual(r.alerts.map((a) => a.status), ['pending-approval', 'pending-approval']);
});
