import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, Rule } from './types.ts';
import { evalCondition, evalRuleSet, evaluateAgent, heatIndexC, renderMessage } from './rules.ts';
import { parseRule } from './parseRule.ts';

const MIN = 60_000;

function agentWith(rule: Rule, extra: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'Test agent',
    avatar: 'sentinel',
    enabled: true,
    watch: ['weather', 'health'],
    everyMin: 15,
    rules: [rule],
    channels: ['telegram'],
    createdAt: 0,
    ...extra,
  };
}

function parsedRule(text: string): Rule {
  const r = parseRule(text);
  assert.ok(r, `expected a rule for: ${text}`);
  return r.rule;
}

test('heatIndexC returns air temperature below 27 C', () => {
  assert.equal(heatIndexC(20, 50), 20);
  assert.equal(heatIndexC(26.9, 90), 26.9);
});

test('heatIndexC follows the Rothfusz regression above 27 C', () => {
  // 35 C (95 F) at 60% humidity is about 113 F, which is about 45 C.
  const hi = heatIndexC(35, 60);
  assert.ok(Math.abs(hi - 45) < 0.3, `got ${hi}`);
  assert.ok(heatIndexC(35, 80) > heatIndexC(35, 40), 'more humidity feels hotter');
  assert.equal(hi, Math.round(hi * 10) / 10, 'rounded to 1 dp');
});

test('the Maa example fires only when both conditions hold', () => {
  const rule = parsedRule('if heat index > 41 and Maa\'s heart rate > 110 alert me');
  const agent = agentWith(rule);

  const hot = evaluateAgent(agent, { heat_index_c: 46, 'hr:Maa': 112 }, 1_000 * MIN, {});
  assert.equal(hot.length, 1);
  assert.equal(hot[0]!.fingerprint, `${rule.id}:home`);
  assert.equal(hot[0]!.severity, 'warning');
  assert.deepEqual(hot[0]!.metrics, { heat_index_c: 46, 'hr:Maa': 112 });

  const calm = evaluateAgent(agent, { heat_index_c: 46, 'hr:Maa': 90 }, 1_000 * MIN, {});
  assert.equal(calm.length, 0);
});

test('cooldown suppresses repeats and does not mutate lastFired', () => {
  const rule = parsedRule('if rain over 100 mm in a day warn me');
  const agent = agentWith(rule, { place: { name: 'Kochi', lat: 9.9, lon: 76.3 } });
  const m = { rain_mm_24h: 150 };
  const now = 10_000 * MIN;
  const fp = `${rule.id}:Kochi`;

  const recent = { [fp]: now - 60 * MIN };
  const before = structuredClone(recent);
  assert.equal(evaluateAgent(agent, m, now, recent).length, 0);
  assert.deepEqual(recent, before, 'lastFired must not change');

  const old = { [fp]: now - 361 * MIN };
  const fired = evaluateAgent(agent, m, now, old);
  assert.equal(fired.length, 1);
  assert.equal(fired[0]!.fingerprint, fp);
});

test('missing metrics count as false', () => {
  const c = { metric: 'aqi', op: '>' as const, value: 300 };
  assert.equal(evalCondition(c, {}), null);
  assert.equal(evalCondition(c, { aqi: 400 }), true);

  const allRs = { mode: 'all' as const, conditions: [c, { metric: 'pm25', op: '>' as const, value: 1 }] };
  assert.equal(evalRuleSet(allRs, { aqi: 400 }), false);

  const anyRs = { mode: 'any' as const, conditions: [c, { metric: 'pm25', op: '>' as const, value: 1 }] };
  assert.equal(evalRuleSet(anyRs, { aqi: 400 }), true);

  assert.equal(evalRuleSet({ mode: 'all', conditions: [] }, { aqi: 400 }), false);

  const agent = agentWith(parsedRule('when AQI is above 300 tell me'));
  assert.equal(evaluateAgent(agent, {}, 0, {}).length, 0);
});

test('renderMessage formats numbers and blanks unknown placeholders', () => {
  const out = renderMessage('Heat {heat_index_c} C, HR {hr:Maa}, n {count} {nope}', {
    heat_index_c: 46.26,
    'hr:Maa': 112,
    count: 3,
  });
  assert.equal(out, 'Heat 46.3 C, HR 112, n 3');
  assert.equal(renderMessage('Hi {name}', {}, { name: 'Maa' }), 'Hi Maa');
});

test('parses: heat index and heart rate with alert', () => {
  const r = parseRule('if heat index > 41 and Maa\'s heart rate > 110 alert me');
  assert.ok(r);
  assert.deepEqual(r.rule.when, {
    mode: 'all',
    conditions: [
      { metric: 'heat_index_c', op: '>', value: 41 },
      { metric: 'hr:Maa', op: '>', value: 110 },
    ],
  });
  assert.equal(r.rule.severity, 'warning');
  assert.equal(r.confidence, 1);
});

test('parses: rain with warn and "over"', () => {
  const r = parseRule('if rain over 100 mm in a day warn me');
  assert.ok(r);
  assert.deepEqual(r.rule.when.conditions, [{ metric: 'rain_mm_24h', op: '>', value: 100 }]);
  assert.equal(r.rule.severity, 'warning');
});

test('parses: AQI above with tell', () => {
  const r = parseRule('when AQI is above 300 tell me');
  assert.ok(r);
  assert.deepEqual(r.rule.when.conditions, [{ metric: 'aqi', op: '>', value: 300 }]);
  assert.equal(r.rule.severity, 'warning');
});

test('parses: earthquake magnitude at least 5 within 200 km', () => {
  const r = parseRule('if earthquake magnitude is at least 5 within 200 km');
  assert.ok(r);
  assert.deepEqual(r.rule.when.conditions, [
    { metric: 'quake_max_mag', op: '>=', value: 5 },
    { metric: 'quake_nearest_km', op: '<=', value: 200 },
  ]);
  assert.equal(r.rule.severity, 'watch');
});

test('parses: oxygen drops below for a member, with urgent severity', () => {
  const r = parseRule('urgent: if Maa\'s oxygen drops below 92');
  assert.ok(r);
  assert.deepEqual(r.rule.when.conditions, [{ metric: 'spo2:Maa', op: '<', value: 92 }]);
  assert.equal(r.rule.severity, 'severe');
});

test('parseRule returns null when no condition is found', () => {
  assert.equal(parseRule('hello there friend'), null);
  assert.equal(parseRule('   '), null);
});
