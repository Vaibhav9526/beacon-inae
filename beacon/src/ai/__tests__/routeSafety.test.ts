import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_GUIDES, getGuide } from '../../kb';
import { reply, type Block } from '../persona';
import { type NeedleEngine, route } from '../router';

const steps = (bs: Block[]) => bs.filter((b): b is Extract<Block, { type: 'steps' }> => b.type === 'steps');
const chips = (bs: Block[]) => bs.flatMap((b) => (b.type === 'chips' ? b.items : []));

test('a negated symptom never routes to that topic', async () => {
  assert.equal((await route('not bleeding')).action.type, 'none');
  assert.equal((await route("I'm not bleeding, my hand is fine")).action.type, 'none');
  const r = await reply('asha', 'not bleeding', 'en');
  assert.equal(r.source, 'none');
  assert.equal(steps(r.blocks).length, 0);
});

test('a negation in one clause does not hide a real injury in the next', async () => {
  const r = await route('no fire, but my hand has a burn');
  const burns = r.action.type === 'guide' && r.action.id === 'burns';
  assert.ok(burns || r.ask?.includes('burns'), 'burn is still found');
});

test('not breathing and unconscious go straight to the life-saving guide, never a question', async () => {
  assert.deepEqual((await route('he is not breathing')).action, { type: 'guide', id: 'cpr-adult' });
  assert.deepEqual((await route('she is unconscious')).action, { type: 'guide', id: 'recovery-position' });
  assert.deepEqual((await route('he stopped breathing')).action, { type: 'guide', id: 'cpr-adult' });
});

test('trouble breathing asks which cause, and gives no steps by itself', async () => {
  const r = await route("I can't breathe");
  assert.equal(r.action.type, 'none');
  assert.deepEqual(r.ask, ['choking-adult', 'asthma']);
});

test('burning smell and cutting a bandage are not first-aid topics on their own', async () => {
  const smell = await route('there is a burning smell');
  assert.equal(smell.action.type, 'none');
  assert.ok(smell.ask?.includes('smoke-fire'));
  assert.ok(!smell.ask?.includes('minor-wound'));

  const bandage = await route('I need to cut a bandage');
  assert.equal(bandage.action.type, 'none');
  assert.ok(bandage.ask?.includes('cloth-bandage'));
});

test('sting operation is not a sting injury', async () => {
  const r = await route('sting operation on the news');
  assert.equal(r.action.type, 'none');
  assert.equal(r.ask?.length ?? 0, 0);
});

test('an unsure match asks a question with the candidates and gives no steps', async () => {
  const r = await reply('asha', 'burns', 'en');
  assert.equal(steps(r.blocks).length, 0, 'no steps for a guess');
  const ids = chips(r.blocks).map((c) => c.guideId);
  assert.ok(ids.includes('burns'));
  assert.ok(r.blocks.some((b) => b.type === 'text' && /112/.test(b.text)), 'the question also says call 112 when in danger');
});

test('every guide can be opened from its clarifying chip, so a tap never loops back to a question', async () => {
  for (const g of ALL_GUIDES) {
    const r = await reply('asha', g.title[0], 'en', null, g.id);
    const s = steps(r.blocks);
    assert.equal(s.length, 1, `${g.id} gives its steps`);
    assert.equal(s[0].steps.length, g.steps.length, `${g.id} steps are the curated ones`);
  }
});

test('a low-confidence engine pick is turned into a question, not steps', async () => {
  const shaky: NeedleEngine = { complete: async () => ({ calls: [{ name: 'show_first_aid', arguments: { topic: 'burn' } }], confidence: 0.4 }) };
  const r = await route('something hot', shaky);
  assert.equal(r.action.type, 'none');
  assert.ok(r.ask?.includes('burns'));
});

test('an engine is never asked about a negated-only message', async () => {
  let called = false;
  const engine: NeedleEngine = {
    complete: async () => {
      called = true;
      return { calls: [{ name: 'show_first_aid', arguments: { topic: 'bleeding' } }], confidence: 0.99 };
    },
  };
  const r = await route('I am not bleeding', engine);
  assert.equal(r.action.type, 'none');
  assert.equal(called, false);
});

test('clear phrases still give steps directly', async () => {
  assert.deepEqual((await route('my friend is bleeding from a deep cut')).action, { type: 'guide', id: 'severe-bleeding' });
  assert.deepEqual((await route('snake bite')).action, { type: 'guide', id: 'snake-bite' });
  assert.equal(getGuide('severe-bleeding')?.id, 'severe-bleeding');
});
