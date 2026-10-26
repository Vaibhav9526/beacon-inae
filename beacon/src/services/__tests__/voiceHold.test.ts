import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MIN_HOLD_MS, pressEnd, slidFarAway, SLIDE_CANCEL_PX, transcriptOnRelease } from '../voiceHold';

test('a press shorter than 300 ms is a tap, not speech', () => {
  assert.equal(MIN_HOLD_MS, 300);
  assert.equal(pressEnd(0, false), 'short');
  assert.equal(pressEnd(120, false), 'short');
  assert.equal(pressEnd(299, false), 'short');
});

test('a hold of 300 ms or more is sent on release', () => {
  assert.equal(pressEnd(300, false), 'send');
  assert.equal(pressEnd(2500, false), 'send');
});

test('sliding away cancels, however long the hold was', () => {
  assert.equal(pressEnd(2500, true), 'cancel');
  assert.equal(pressEnd(50, true), 'cancel');
});

test('slide threshold is a distance from the press point', () => {
  assert.equal(slidFarAway(0, 0), false);
  assert.equal(slidFarAway(SLIDE_CANCEL_PX, 0), false);
  assert.equal(slidFarAway(SLIDE_CANCEL_PX + 1, 0), true);
  assert.equal(slidFarAway(0, -200), true);
  assert.equal(slidFarAway(60, 60), false); // diagonal: about 85 px, under the limit
  assert.equal(slidFarAway(90, 90), true); // diagonal: about 127 px, over the limit
});

test('release submits the final words, else the last partial, else nothing', () => {
  assert.equal(transcriptOnRelease('open weather', 'open wea'), 'open weather');
  assert.equal(transcriptOnRelease(null, '  first aid for burns '), 'first aid for burns');
  assert.equal(transcriptOnRelease('   ', ''), null);
  assert.equal(transcriptOnRelease(undefined, ''), null);
});
