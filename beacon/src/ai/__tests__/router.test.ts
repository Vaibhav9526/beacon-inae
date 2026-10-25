import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getGuide } from '../../kb';
import { type NeedleEngine, route } from '../router';
import { FIRST_AID_TOPICS, HAZARDS, REMEDY_ITEMS, TOOLS, toAction } from '../tools';

test('every tool argument maps to a real guide', () => {
  for (const id of Object.values(FIRST_AID_TOPICS)) assert.ok(getGuide(id), `missing ${id}`);
  for (const id of Object.values(REMEDY_ITEMS)) assert.ok(getGuide(id), `missing ${id}`);
  assert.equal(HAZARDS.length, 7);
  assert.ok(TOOLS.every((t) => t.name && t.description && t.parameters.type === 'object'));
});

test('keyword router: intents', async () => {
  assert.deepEqual((await route('Hey Beacon, find the nearest shelter')).action, { type: 'map', place: 'shelter' });
  assert.deepEqual((await route('where is the nearest hospital')).action, { type: 'map', place: 'hospital' });
  assert.deepEqual((await route('मुझे बचाओ')).action, { type: 'sos' });
  assert.deepEqual((await route('mark me safe')).action, { type: 'safe' });
  assert.deepEqual((await route('show me the alerts')).action, { type: 'alerts' });
  assert.deepEqual((await route('पास का अस्पताल कहाँ है')).action, { type: 'map', place: 'hospital' });
  assert.deepEqual((await route('switch to hindi')).action, { type: 'settings', setting: 'hindi' });
});

test('keyword router: first aid, remedies, disasters', async () => {
  assert.deepEqual((await route('my brother is bleeding from the leg')).action, { type: 'guide', id: 'severe-bleeding' });
  assert.deepEqual((await route('how do I make ors at home')).action, { type: 'guide', id: 'homemade-ors' });
  assert.deepEqual((await route('earthquake what to do')).action, { type: 'disaster', id: 'earthquake' });
  assert.deepEqual((await route('')).action, { type: 'none' });
  assert.deepEqual((await route('asdf qwerty')).action, { type: 'none' });
});

test('needle result is used when confident, keywords when it declines or fails', async () => {
  const needle: NeedleEngine = {
    complete: async () => ({ calls: [{ name: 'show_first_aid', arguments: { topic: 'snake_bite' } }], confidence: 0.93 }),
  };
  const r = await route('something crawled and bit him', needle);
  assert.equal(r.source, 'needle');
  assert.deepEqual(r.action, { type: 'guide', id: 'snake-bite' });

  const refuses: NeedleEngine = { complete: async () => ({ calls: [], confidence: null }) };
  const r2 = await route('he is bleeding', refuses);
  assert.equal(r2.source, 'keywords');
  assert.deepEqual(r2.action, { type: 'guide', id: 'severe-bleeding' });

  const crashes: NeedleEngine = { complete: async () => { throw new Error('native crash'); } };
  assert.equal((await route('he is bleeding', crashes)).source, 'keywords');
});

test('a hallucinated tool or argument becomes no action instead of a wrong one', () => {
  assert.deepEqual(toAction({ name: 'launch_missiles', arguments: {} }), { type: 'none' });
  assert.deepEqual(toAction({ name: 'show_first_aid', arguments: { topic: 'make_up_a_cure' } }), { type: 'none' });
  assert.deepEqual(toAction({ name: 'find_nearest', arguments: { place: 'moon' } }), { type: 'none' });
});
