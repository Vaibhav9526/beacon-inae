import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, instantiate, templateById } from './templates.ts';

// Metric names documented in types.ts. Health and schedule metrics carry a name after the colon.
const KNOWN_METRIC = [
  /^(temp_c|feels_like_c|humidity_pct|heat_index_c|wind_kmh|wind_gust_kmh|rain_mm_24h|rain_mm_now|uv_index|aqi|pm25)$/,
  /^quake_[a-z_]+$/,
  /^official_alert_[a-z_]+$/,
  /^(water_days|food_days|medicine_days)$/,
  /^(hr|spo2|steps|sleep_h|health_status):[^:]+$/,
  /^minutes_to_dose:.+$/,
];

const AVATARS = ['sentinel', 'medic', 'rescue', 'guardian', 'scout', 'coach'];
const GROUPS = ['disaster', 'help', 'medicine', 'child', 'prepare'];
const LEVELS = ['starter', 'guardian', 'expert'];
const NEEDS = ['health', 'telegram', 'phone'];

test('there are 29 vault agents', () => {
  assert.equal(TEMPLATES.length, 29);
});

test('every template has non-empty vault text', () => {
  for (const t of TEMPLATES) {
    assert.ok(t.about && t.about.trim().length > 0, `${t.id} about`);
    assert.ok(t.example && t.example.trim().length > 0, `${t.id} example`);
    assert.ok(t.who && t.who.trim().length > 0, `${t.id} who`);
    assert.ok(Array.isArray(t.watches) && t.watches.length > 0, `${t.id} watches`);
    assert.ok(Array.isArray(t.sources) && t.sources.length > 0, `${t.id} sources`);
    assert.ok(t.level, `${t.id} level`);
    assert.ok(Array.isArray(t.needs) && t.needs.length > 0, `${t.id} needs`);
  }
});

test('every template has a genre', () => {
  for (const t of TEMPLATES) assert.ok(t.agent.genre, `${t.id} genre`);
});

test('about is two sentences and examples have no emojis', () => {
  for (const t of TEMPLATES) {
    const sentences = (t.about ?? '').split(/(?<=[.!?])\s+/).filter(Boolean);
    assert.equal(sentences.length, 2, `${t.id} about should be 2 sentences`);
    assert.doesNotMatch(t.example ?? '', /\p{Extended_Pictographic}/u, `${t.id} example has an emoji`);
  }
});

test('vault fields use known values', () => {
  for (const t of TEMPLATES) {
    assert.ok(GROUPS.includes(t.group), `${t.id} group`);
    assert.ok(AVATARS.includes(t.avatar), `${t.id} avatar`);
    assert.ok(LEVELS.includes(t.level ?? ''), `${t.id} level`);
    for (const n of t.needs ?? []) assert.ok(NEEDS.includes(n), `${t.id} need ${n}`);
  }
});

test('template ids are unique', () => {
  const ids = TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every template has 1 to 3 rules with known metrics (news only may have none)', () => {
  for (const t of TEMPLATES) {
    const rules = t.agent.rules;
    const min = t.agent.genre === 'news' ? 0 : 1;
    assert.ok(rules.length >= min && rules.length <= 3, `${t.id} rule count ${rules.length}`);
    for (const r of rules) {
      assert.ok(r.when.conditions.length > 0, `${t.id}/${r.id} has no conditions`);
      for (const c of r.when.conditions) {
        const ok = KNOWN_METRIC.some((re) => re.test(c.metric));
        assert.ok(ok, `${t.id}/${r.id} unknown metric "${c.metric}"`);
      }
    }
  }
});

test('rule ids are unique within each template', () => {
  for (const t of TEMPLATES) {
    const ids = t.agent.rules.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, `${t.id} rule ids`);
  }
});

test('templateById finds templates and misses unknown ids', () => {
  assert.equal(templateById('flood-watcher')?.name, 'Flood Watcher');
  assert.equal(templateById('nope'), undefined);
});

test('instantiate builds a fresh agent from a template', () => {
  const t = TEMPLATES[0];
  const a = instantiate(t);
  const b = instantiate(t);
  assert.equal(a.templateId, t.id);
  assert.equal(a.name, t.agent.name);
  assert.equal(a.enabled, true);
  assert.ok(a.id && b.id && a.id !== b.id, 'each agent gets its own id');
  assert.notEqual(a.rules, t.agent.rules, 'rules are copied, not shared');
  const c = instantiate(t, { name: 'Mine' });
  assert.equal(c.name, 'Mine');
});
