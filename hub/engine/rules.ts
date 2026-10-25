import type { Agent, Condition, Metrics, Op, RuleSet, Signal } from './types.ts';

const HEAT_INDEX_MIN_C = 27;
const DEFAULT_COOLDOWN_MIN = 360;

/**
 * Heat index via the Rothfusz regression (NWS). Input and output are Celsius, rounded to 1 dp.
 * Below 27 C the heat index is not meaningful, so the air temperature is returned unchanged.
 */
export function heatIndexC(tempC: number, humidityPct: number): number {
  if (tempC < HEAT_INDEX_MIN_C) return tempC;
  const T = tempC * 9 / 5 + 32;
  const R = humidityPct;
  let hi =
    -42.379 +
    2.04901523 * T +
    10.14333127 * R -
    0.22475541 * T * R -
    0.00683783 * T * T -
    0.05481717 * R * R +
    0.00122874 * T * T * R +
    0.00085282 * T * R * R -
    0.00000199 * T * T * R * R;
  // NWS adjustments for very dry and very humid conditions.
  if (R < 13 && T >= 80 && T <= 112) {
    hi -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
  } else if (R > 85 && T >= 80 && T <= 87) {
    hi += ((R - 85) / 10) * ((87 - T) / 5);
  }
  const c = ((hi - 32) * 5) / 9;
  return Math.round(c * 10) / 10;
}

const OPS: Record<Op, (a: number, b: number) => boolean> = {
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};

/** True/false when the metric is present; null when it is missing (or not a finite number). */
export function evalCondition(c: Condition, m: Metrics): boolean | null {
  if (!Object.hasOwn(m, c.metric)) return null;
  const v = m[c.metric];
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return OPS[c.op](v, c.value);
}

/** A missing metric counts as false. An empty rule set never matches. */
export function evalRuleSet(rs: RuleSet, m: Metrics): boolean {
  if (rs.conditions.length === 0) return false;
  const results = rs.conditions.map((c) => evalCondition(c, m) === true);
  return rs.mode === 'any' ? results.some(Boolean) : results.every(Boolean);
}

function fmtNum(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/**
 * Replaces `{name}` placeholders. `extra` wins over metrics. Unknown or missing names become blank,
 * and the leftover spacing is tidied.
 */
export function renderMessage(tpl: string, m: Metrics, extra: Record<string, string> = {}): string {
  const out = tpl.replace(/\{([^{}]+)\}/g, (_whole, raw: string) => {
    const key = raw.trim();
    if (Object.hasOwn(extra, key)) return extra[key] ?? '';
    if (Object.hasOwn(m, key)) {
      const v = m[key];
      if (typeof v === 'number' && Number.isFinite(v)) return fmtNum(v);
    }
    return '';
  });
  return out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}

/**
 * Returns a Signal for each rule that matches and is out of cooldown.
 * Does not mutate `lastFired`; the caller records the fingerprints it sends.
 */
export function evaluateAgent(
  agent: Agent,
  m: Metrics,
  now: number,
  lastFired: Record<string, number>,
): Signal[] {
  if (!agent.enabled) return [];
  const place = agent.place?.name ?? 'home';
  const signals: Signal[] = [];

  for (const rule of agent.rules) {
    if (!evalRuleSet(rule.when, m)) continue;

    const fingerprint = `${rule.id}:${place}`;
    const cooldownMin = rule.cooldownMin ?? DEFAULT_COOLDOWN_MIN;
    const last = Object.hasOwn(lastFired, fingerprint) ? lastFired[fingerprint] : undefined;
    if (last !== undefined && now - last < cooldownMin * 60_000) continue;

    const metrics: Metrics = {};
    for (const name of new Set(rule.when.conditions.map((c) => c.metric))) {
      if (Object.hasOwn(m, name)) metrics[name] = m[name];
    }

    signals.push({
      agentId: agent.id,
      agentName: agent.name,
      ruleId: rule.id,
      severity: rule.severity,
      title: rule.name,
      body: renderMessage(rule.message, m),
      metrics,
      fingerprint,
      tags: [...agent.watch],
      at: now,
    });
  }

  return signals;
}
