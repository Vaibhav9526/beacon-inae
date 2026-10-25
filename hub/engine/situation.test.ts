import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSituation } from './situation.ts';
import type { Agent, Alert, RunLogEntry, Signal } from './types.ts';

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;

const agent = (enabled = true): Agent => ({
  id: 'ag1', name: 'Heat watch', avatar: 'sentinel', enabled, watch: ['weather'], everyMin: 5, rules: [], channels: ['beacon'], createdAt: NOW,
});

const sig = (over: Partial<Signal> = {}): Signal => ({
  agentId: 'ag1', agentName: 'Heat watch', ruleId: 'r1', severity: 'watch', title: 'Heat', body: 'Hot.', metrics: {},
  fingerprint: 'heat:delhi', tags: ['heat'], at: NOW, ...over,
});

const alert = (over: Partial<Alert> = {}): Alert => ({
  id: 'a1', severity: 'watch', title: 'Heat building', body: 'Hot afternoon.', channels: ['beacon'], signals: [sig()], at: NOW - 30 * MIN,
  status: 'sent', ...over,
});

const run = (over: Partial<RunLogEntry> = {}): RunLogEntry => ({ at: NOW - 10 * MIN, agentId: 'ag1', ok: true, message: 'ok', ...over });

const calmInput = { alerts: [] as Alert[], runs: [] as RunLogEntry[], now: NOW, agents: [agent()] };

test('no alerts is calm at level 0 with a headline and actions', () => {
  const s = computeSituation(calmInput);
  assert.equal(s.phase, 'calm');
  assert.equal(s.level, 0);
  assert.equal(s.since, 0);
  assert.match(s.headline, /^[^.!?]+[.!?]$/);
  assert.ok(s.actions.length >= 1 && s.actions.length <= 3);
});

test('a severe alert in the last 3 hours is alert', () => {
  const s = computeSituation({ ...calmInput, alerts: [alert({ severity: 'severe', title: 'Heat and heart rate are high', at: NOW - HOUR })] });
  assert.equal(s.phase, 'alert');
  assert.equal(s.level, 3);
  assert.equal(s.since, NOW - HOUR);
  assert.equal(s.headline, 'Act now: Heat and heart rate are high.');
});

test('pending approval counts, failed and suppressed alerts do not', () => {
  const pending = computeSituation({ ...calmInput, alerts: [alert({ severity: 'severe', status: 'pending-approval' })] });
  assert.equal(pending.phase, 'alert');
  const failed = computeSituation({ ...calmInput, alerts: [alert({ severity: 'severe', status: 'failed' })] });
  assert.equal(failed.phase, 'calm');
  const suppressed = computeSituation({ ...calmInput, alerts: [alert({ severity: 'severe', status: 'suppressed' })] });
  assert.equal(suppressed.phase, 'calm');
});

test('a severe alert older than 3 hours does not make it alert', () => {
  const s = computeSituation({ ...calmInput, alerts: [alert({ severity: 'severe', at: NOW - 4 * HOUR })] });
  assert.notEqual(s.phase, 'alert');
});

test('two distinct warning fingerprints make alert, one does not', () => {
  const w1 = alert({ id: 'w1', severity: 'warning', signals: [sig({ severity: 'warning', fingerprint: 'flood:kochi' })] });
  const w2 = alert({ id: 'w2', severity: 'warning', at: NOW - 20 * MIN, signals: [sig({ severity: 'warning', fingerprint: 'quake:kochi', tags: ['quake'] })] });
  const two = computeSituation({ ...calmInput, alerts: [w1, w2] });
  assert.equal(two.phase, 'alert');
  assert.equal(two.level, 3);
  assert.ok(two.reasons.some((r) => /2 separate warnings/.test(r)));
  const one = computeSituation({ ...calmInput, alerts: [w1] });
  assert.equal(one.phase, 'watch');
  assert.equal(one.level, 2);
});

test('the same warning fingerprint twice is still one warning', () => {
  const a = alert({ id: 'x1', severity: 'warning', signals: [sig({ severity: 'warning', fingerprint: 'flood:kochi' })] });
  const b = alert({ id: 'x2', severity: 'warning', at: NOW - 5 * MIN, signals: [sig({ severity: 'warning', fingerprint: 'flood:kochi' })] });
  assert.equal(computeSituation({ ...calmInput, alerts: [a, b] }).phase, 'watch');
});

test('a watch alert in the last 3 hours is watch at level 1', () => {
  const s = computeSituation({ ...calmInput, alerts: [alert({ severity: 'watch' })] });
  assert.equal(s.phase, 'watch');
  assert.equal(s.level, 1);
  assert.equal(s.since, NOW - 30 * MIN);
  assert.equal(s.headline, 'Heads up: Heat building.');
});

test('recovering for 72 hours after the last severe or warning alert with nothing new in 3 hours', () => {
  const old = alert({ id: 'old', severity: 'severe', at: NOW - 10 * HOUR });
  const s = computeSituation({ ...calmInput, alerts: [old] });
  assert.equal(s.phase, 'recovering');
  assert.equal(s.level, 1);
  assert.equal(s.since, NOW - 10 * HOUR);
  assert.ok(s.actions.length >= 1);
});

test('recovery ends after 72 hours', () => {
  const s = computeSituation({ ...calmInput, alerts: [alert({ severity: 'warning', at: NOW - 73 * HOUR })] });
  assert.equal(s.phase, 'calm');
});

test('a fresh info alert blocks recovery', () => {
  const s = computeSituation({
    ...calmInput,
    alerts: [alert({ id: 'old', severity: 'severe', at: NOW - 10 * HOUR }), alert({ id: 'new', severity: 'info', at: NOW - 40 * MIN })],
  });
  assert.equal(s.phase, 'calm');
});

test('actions come from the loudest signal tag', () => {
  const quake = alert({
    severity: 'severe',
    signals: [sig({ severity: 'severe', tags: ['quake'], fingerprint: 'quake:kochi' }), sig({ severity: 'watch', tags: ['heat'] })],
  });
  const s = computeSituation({ ...calmInput, alerts: [quake] });
  assert.equal(s.phase, 'alert');
  assert.match(s.actions[0], /Drop, cover and hold on/);
  assert.ok(s.actions.length <= 3);
});

test('health tag gives health actions in alert', () => {
  const a = alert({ severity: 'severe', signals: [sig({ severity: 'severe', tags: ['health'], fingerprint: 'health:maa' })] });
  const s = computeSituation({ ...calmInput, alerts: [a] });
  assert.match(s.actions[0], /112/);
});

test('failed agent checks and no awake agent are reported as reasons', () => {
  const s = computeSituation({
    alerts: [],
    runs: [run({ ok: false, message: 'boom' }), run({ ok: false, at: NOW - 4 * HOUR }), run({ ok: true })],
    now: NOW,
    agents: [agent(false)],
  });
  assert.equal(s.phase, 'calm');
  assert.ok(s.reasons.some((r) => /1 agent check failed/.test(r)));
  assert.ok(s.reasons.some((r) => /No agent is awake/.test(r)));
});

test('headlines are one sentence and never empty', () => {
  for (const input of [
    calmInput,
    { ...calmInput, alerts: [alert({ severity: 'severe', title: '' })] },
    { ...calmInput, alerts: [alert({ severity: 'severe', title: 'First part. Second part.' })] },
    { ...calmInput, alerts: [alert({ severity: 'watch', title: '' })] },
  ]) {
    const s = computeSituation(input);
    assert.ok(s.headline.trim().length > 0);
    assert.equal(s.headline.split(/(?<=[.!?])\s/).length, 1, s.headline);
  }
});

test('alerts with missing signals do not throw', () => {
  const bare = { ...alert({ severity: 'warning' }), signals: undefined as unknown as Signal[] };
  assert.doesNotThrow(() => computeSituation({ ...calmInput, alerts: [bare] }));
});
