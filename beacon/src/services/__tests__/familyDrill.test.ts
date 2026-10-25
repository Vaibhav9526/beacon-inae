import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BEST_POINTS,
  MAX_CHARS,
  OK_POINTS,
  PREFIX,
  SCENARIO_IDS,
  type DrillMsg,
  type ScenarioId,
  bestChoice,
  isDrillText,
  leaderboard,
  locateChoice,
  newDrillId,
  parseDrillMessage,
  reduce,
  replay,
  scenarioById,
  scenarioList,
  scoreAnswer,
  serialiseDrillMessage,
  speedBonus,
  EMPTY_DRILLS,
} from '../familyDrill';

const start = (id = 'abc123', scenario: ScenarioId = 'earthquake'): DrillMsg => ({ t: 'start', id, scenario, startedAt: 1_700_000_000_000, by: 'Asha' });
const answer = (choiceId: string, who = 'Ravi', atMs = 1000, id = 'abc123'): DrillMsg => ({ t: 'answer', id, who, choiceId, atMs });
const end = (id = 'abc123'): DrillMsg => ({ t: 'end', id });

// ---- wire format ----

test('serialise then parse round-trips every message kind', () => {
  for (const m of [start(), answer('0a', 'Meera', 4321), end()]) {
    const text = serialiseDrillMessage(m);
    assert.ok(text && text.startsWith(PREFIX));
    assert.ok(text.length <= MAX_CHARS);
    assert.deepEqual(parseDrillMessage(text), m);
  }
});

test('serialise refuses malformed input', () => {
  assert.equal(serialiseDrillMessage({ ...start(), scenario: 'tsunami' as ScenarioId }), null);
  assert.equal(serialiseDrillMessage({ ...start(), id: 'A!' }), null);
  assert.equal(serialiseDrillMessage(answer('zz')), null);
  assert.equal(serialiseDrillMessage(answer('0a', '')), null);
  assert.equal(serialiseDrillMessage(answer('0a', 'x'.repeat(33))), null);
  assert.equal(serialiseDrillMessage(answer('0a', 'Ravi', 60_001)), null);
  assert.equal(serialiseDrillMessage(answer('0a', 'Ravi', -1)), null);
  assert.equal(serialiseDrillMessage(answer('0a', 'Ravi', 1.5)), null);
});

test('malformed and foreign chat text is ignored', () => {
  const bad = [
    'hello there',
    PREFIX,
    PREFIX + '{not json',
    PREFIX + '[]',
    PREFIX + 'null',
    PREFIX + '{"t":"nope","id":"abc123"}',
    PREFIX + '{"t":"end"}',
    PREFIX + '{"t":"end","id":"AB"}',
    PREFIX + '{"t":"start","id":"abc123","scenario":"flood","startedAt":"now","by":"A"}',
    PREFIX + '{"t":"start","id":"abc123","scenario":"flood","startedAt":-5,"by":"A"}',
    PREFIX + '{"t":"answer","id":"abc123","who":"A","choiceId":"0z","atMs":1}',
    PREFIX + '{"t":"answer","id":"abc123","who":"A","choiceId":"00a","atMs":1}',
    PREFIX + '{"t":"answer","id":"abc123","who":"A","choiceId":"0a","atMs":1e9}',
    PREFIX + '{"t":"answer","id":"abc123","who":"","choiceId":"0a","atMs":1}',
    PREFIX + '{"t":"answer","id":"abc123","who":"A","choiceId":"0a"}',
    'BCN-DRILL2:' + JSON.stringify(end()),
    ' ' + serialiseDrillMessage(end()),
  ];
  for (const text of bad) assert.equal(parseDrillMessage(text), null, text);
  assert.equal(parseDrillMessage(42), null);
  assert.equal(parseDrillMessage(undefined), null);
});

test('oversize text is rejected even when the JSON itself is valid', () => {
  const padded = PREFIX + JSON.stringify(end()) + ' '.repeat(MAX_CHARS);
  assert.ok(padded.length > MAX_CHARS);
  assert.equal(parseDrillMessage(padded), null);
});

test('parse drops unknown keys', () => {
  const text = PREFIX + JSON.stringify({ t: 'end', id: 'abc123', extra: 'x' });
  assert.deepEqual(parseDrillMessage(text), end());
});

test('isDrillText and newDrillId', () => {
  assert.equal(isDrillText(PREFIX + 'x'), true);
  assert.equal(isDrillText('hi'), false);
  const id = newDrillId(() => 0.5);
  assert.match(id, /^[a-z0-9]{8}$/);
  assert.equal(parseDrillMessage(serialiseDrillMessage(start(id)))?.id, id);
});

// ---- scoring ----

test('scoring: wrong is always 0, best and ok add the speed bonus', () => {
  assert.equal(scoreAnswer('wrong', 0), 0);
  assert.equal(scoreAnswer('wrong', 1), 0);
  assert.equal(scoreAnswer('best', 0), BEST_POINTS + 50);
  assert.equal(scoreAnswer('ok', 0), OK_POINTS + 50);
});

test('scoring boundaries of the speed bonus', () => {
  assert.equal(speedBonus(0), 50);
  assert.equal(speedBonus(5000), 50);
  assert.equal(speedBonus(5001), 49);
  assert.equal(speedBonus(12500), 25);
  assert.equal(speedBonus(19999), 0);
  assert.equal(speedBonus(20000), 0);
  assert.equal(speedBonus(60000), 0);
  assert.equal(speedBonus(-100), 50);
  assert.equal(speedBonus(Number.NaN), 0);
  assert.equal(scoreAnswer('best', 5000), 150);
  assert.equal(scoreAnswer('best', 20000), 100);
  assert.equal(scoreAnswer('ok', 5001), 99);
  assert.equal(scoreAnswer('ok', 20000), 50);
});

test('speed bonus never increases with reaction time', () => {
  let prev = Infinity;
  for (let ms = 0; ms <= 25_000; ms += 250) {
    const b = speedBonus(ms);
    assert.ok(b <= prev, `bonus rose at ${ms}`);
    prev = b;
  }
});

// ---- reducer ----

test('answers before end are counted; after end they are ignored; end is idempotent', () => {
  let s = reduce(EMPTY_DRILLS, start());
  s = reduce(s, answer('0a', 'Ravi', 2000));
  assert.equal(leaderboard(s, 'abc123')[0].score, 150);
  const ended = reduce(s, end());
  assert.equal(reduce(ended, end()), ended);
  const after = reduce(ended, answer('1a', 'Meera', 100));
  assert.equal(after, ended);
  assert.equal(leaderboard(after, 'abc123').length, 1);
});

test('duplicate answer for the same (who, prompt) is ignored, first wins', () => {
  let s = reduce(EMPTY_DRILLS, start());
  s = reduce(s, answer('0c', 'Ravi', 1000));
  const again = reduce(s, answer('0a', 'Ravi', 100));
  assert.equal(again, s);
  const rows = leaderboard(again, 'abc123');
  assert.deepEqual(rows, [{ who: 'Ravi', score: 0, answered: 1, avgMs: 1000 }]);
  // a different prompt from the same person is fine
  const next = reduce(s, answer('1a', 'Ravi', 1000));
  assert.equal(leaderboard(next, 'abc123')[0].answered, 2);
});

test('a second start for a known id is ignored; unknown drill answers are ignored', () => {
  const s = reduce(EMPTY_DRILLS, start());
  assert.equal(reduce(s, { ...start(), by: 'Someone else' }), s);
  assert.equal(reduce(EMPTY_DRILLS, answer('0a')), EMPTY_DRILLS);
  assert.equal(reduce(EMPTY_DRILLS, end()), EMPTY_DRILLS);
});

test('an answer with a choice that does not exist in the scenario is ignored', () => {
  const s = reduce(EMPTY_DRILLS, start('abc123', 'fire'));
  assert.equal(reduce(s, answer('9a')), s);
});

test('leaderboard order: score, then faster average, then name', () => {
  let s = reduce(EMPTY_DRILLS, start());
  const best0 = bestChoice('earthquake', 0)!.id;
  const ok1 = locateChoice('earthquake', '1b')!.choice.id;
  // Asha: best fast (150) + ok fast (100) = 250
  s = reduce(s, answer(best0, 'Asha', 1000));
  s = reduce(s, answer(ok1, 'Asha', 1000));
  // Bina and Chetan: identical score (136 + 86 = 222) and speed, so the name decides
  s = reduce(s, answer(best0, 'Chetan', 9000));
  s = reduce(s, answer(ok1, 'Chetan', 9000));
  s = reduce(s, answer(best0, 'Bina', 9000));
  s = reduce(s, answer(ok1, 'Bina', 9000));
  // Dev: wrong only
  s = reduce(s, answer('0c', 'Dev', 500));
  const rows = leaderboard(s, 'abc123');
  assert.deepEqual(
    rows.map((r) => r.who),
    ['Asha', 'Bina', 'Chetan', 'Dev'],
  );
  assert.equal(rows[0].score, 250);
  assert.equal(rows[0].avgMs, 1000);
  assert.equal(rows[1].score, rows[2].score);
  assert.equal(rows[3].score, 0);
  assert.deepEqual(leaderboard(s, 'nope'), []);
});

test('replay sorts by time, so a late-arriving start still comes first', () => {
  const items = [
    { msg: answer('0a', 'Ravi', 800), ts: 30 },
    { msg: start(), ts: 10 },
    { msg: end(), ts: 60 },
    { msg: answer('1a', 'Ravi', 900), ts: 70 },
  ];
  const s = replay(items);
  assert.equal(s.drills.abc123.ended, true);
  assert.equal(s.drills.abc123.answers.length, 1);
  assert.deepEqual(replay([...items].reverse()), s);
});

// ---- content ----

test('scenarios: 3 to 4 prompts, 3 choices, one best and at least one ok, Hindi and English everywhere', () => {
  assert.equal(scenarioList().length, SCENARIO_IDS.length);
  const devanagari = /[ऀ-ॿ]/;
  for (const id of SCENARIO_IDS) {
    const sc = scenarioById(id);
    assert.ok(sc.title[0].length > 0 && sc.title[1].length > 0, `${id} title`);
    assert.ok(devanagari.test(sc.title[1]), `${id} title is not Hindi`);
    assert.ok(sc.prompts.length >= 3 && sc.prompts.length <= 4, `${id} prompt count`);
    const ids = new Set<string>();
    sc.prompts.forEach((p, k) => {
      assert.equal(p.choices.length, 3, `${id}[${k}] choices`);
      assert.equal(p.choices.filter((c) => c.grade === 'best').length, 1, `${id}[${k}] best`);
      assert.ok(p.choices.some((c) => c.grade === 'ok'), `${id}[${k}] ok`);
      for (const part of [p.question, p.why, ...p.choices.map((c) => c.label)]) {
        assert.ok(part[0].trim().length > 0, `${id}[${k}] english empty`);
        assert.ok(part[1].trim().length > 0, `${id}[${k}] hindi empty`);
        assert.ok(devanagari.test(part[1]), `${id}[${k}] hindi not Devanagari: ${part[1]}`);
      }
      for (const c of p.choices) {
        assert.ok(c.id.startsWith(`${k}`), `${id} choice id ${c.id} does not encode prompt ${k}`);
        assert.ok(!ids.has(c.id), `${id} duplicate choice id ${c.id}`);
        ids.add(c.id);
        assert.ok(serialiseDrillMessage(answer(c.id)) !== null, `${c.id} serialises`);
      }
    });
  }
});
