import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedEdits, editDistance } from '../fuzzy';
import { guessScreens, interpret } from '../navigate';

test('edit distance', () => {
  assert.equal(editDistance('weather', 'weather'), 0);
  assert.equal(editDistance('whether', 'weather'), 2);
  assert.equal(editDistance('', 'abc'), 3);
  assert.equal(editDistance('map', 'mop'), 1);
});

test('short words must be exact, long ones may be off by two', () => {
  assert.equal(allowedEdits(4), 0);
  assert.equal(allowedEdits(6), 1);
  assert.equal(allowedEdits(7), 2);
});

test('mis-heard screen names still find the screen', () => {
  assert.equal(guessScreens('open whether')[0], 'weather');
  assert.equal(guessScreens('open shelther')[0], 'shelters');
  assert.equal(guessScreens('open settins')[0], 'settings');
  assert.equal(guessScreens('hospitel')[0], 'hospitals');
});

test('fuzzy does not invent screens from unrelated words', () => {
  assert.deepEqual(guessScreens('what is for lunch'), []);
  assert.deepEqual(guessScreens('mop'), []);
});

test('interpret asks "did you mean" for a mis-heard name instead of failing', async () => {
  const d = await interpret('open whether', null, { log: false });
  assert.equal(d.kind, 'confirm');
  if (d.kind === 'confirm') assert.match(JSON.stringify(d.primary.action), /weather/);
});
