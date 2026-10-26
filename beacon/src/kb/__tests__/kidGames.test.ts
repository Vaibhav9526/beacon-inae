import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BAG_ITEMS, SAFE_CARDS } from '../kidDrills';
import {
  BAG_BAD_PER_ROUND,
  BAG_GOOD_PER_ROUND,
  BAG_LIVES,
  DCH_MOVES,
  DCH_ROUNDS,
  bagIsOver,
  bagStars,
  dchStars,
  dchTap,
  dchTick,
  dchTimeLimit,
  isSafeAnswerRight,
  pickBagRound,
  pickSafeRound,
  safeStars,
  shuffle,
} from '../kidGames';

// deterministic "random" so the tests do not flake
const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

test('shuffle keeps every item exactly once and does not mutate the input', () => {
  const input = [1, 2, 3, 4, 5, 6, 7];
  const out = shuffle(input, seeded(42));
  assert.deepEqual([...out].sort((a, b) => a - b), input);
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7]);
});

test('bag content has enough needed and unneeded items for a round', () => {
  assert.ok(BAG_ITEMS.filter((i) => i.good).length >= BAG_GOOD_PER_ROUND);
  assert.ok(BAG_ITEMS.filter((i) => !i.good).length >= BAG_BAD_PER_ROUND);
});

test('pickBagRound gives 6 needed and 5 unneeded items with no duplicates', () => {
  for (let s = 1; s <= 20; s++) {
    const round = pickBagRound(BAG_ITEMS, BAG_GOOD_PER_ROUND, BAG_BAD_PER_ROUND, seeded(s));
    assert.equal(round.length, BAG_GOOD_PER_ROUND + BAG_BAD_PER_ROUND);
    assert.equal(round.filter((i) => i.good).length, BAG_GOOD_PER_ROUND);
    assert.equal(new Set(round.map((i) => i.name[0])).size, round.length);
  }
});

test('bag is over on the third mistake or when every needed item is packed', () => {
  assert.equal(bagIsOver(BAG_LIVES - 1, 0, 6), false);
  assert.equal(bagIsOver(BAG_LIVES, 0, 6), true);
  assert.equal(bagIsOver(0, 6, 6), true);
  assert.equal(bagIsOver(1, 5, 6), false);
});

test('bag stars: 3 for a clean pack, 2 for one mistake, 1 otherwise', () => {
  assert.equal(bagStars(0, true), 3);
  assert.equal(bagStars(1, true), 2);
  assert.equal(bagStars(2, true), 1);
  assert.equal(bagStars(0, false), 1);
  assert.equal(bagStars(BAG_LIVES, true), 1);
});

test('safe round picks 8 distinct cards and the content has at least 8', () => {
  assert.ok(SAFE_CARDS.length >= 8);
  const round = pickSafeRound(SAFE_CARDS, 8, seeded(7));
  assert.equal(round.length, 8);
  assert.equal(new Set(round).size, 8);
});

test('pickSafeRound never returns more cards than exist', () => {
  assert.equal(pickSafeRound([{ safe: true }, { safe: false }], 8).length, 2);
});

test('isSafeAnswerRight compares the child answer to the card', () => {
  assert.equal(isSafeAnswerRight({ safe: true }, true), true);
  assert.equal(isSafeAnswerRight({ safe: true }, false), false);
  assert.equal(isSafeAnswerRight({ safe: false }, false), true);
});

test('safe stars: all right is 3, within two of the total is 2, else 1', () => {
  assert.equal(safeStars(8, 8), 3);
  assert.equal(safeStars(6, 8), 2);
  assert.equal(safeStars(5, 8), 1);
  assert.equal(safeStars(0, 0), 1);
});

test('drop-cover-hold accepts only the right move at each position', () => {
  assert.deepEqual(DCH_MOVES, ['drop', 'cover', 'hold']);
  assert.equal(dchTap(0, 1), 'fail');
  assert.equal(dchTap(0, 0), 'advance');
  assert.equal(dchTap(1, 1), 'advance');
  assert.equal(dchTap(2, 2), 'complete');
  assert.equal(dchTap(2, 0), 'fail');
});

test('drop-cover-hold time limit gets shorter each round', () => {
  assert.equal(dchTimeLimit(0), 4);
  assert.equal(dchTimeLimit(1), 3);
  assert.equal(dchTimeLimit(2), 2.4);
  assert.equal(dchTimeLimit(9), 2.4);
});

test('the timer counts down in tenths and stops at exactly zero', () => {
  let left = 0.3;
  left = dchTick(left);
  assert.equal(left, 0.2);
  left = dchTick(left);
  assert.equal(left, 0.1);
  left = dchTick(left);
  assert.equal(left, 0);
  assert.equal(dchTick(0), 0);
  let t = 4;
  let ticks = 0;
  while (t > 0) {
    t = dchTick(t);
    ticks++;
  }
  assert.equal(ticks, 40);
});

test('drop-cover-hold stars follow the rounds won', () => {
  assert.equal(dchStars(DCH_ROUNDS), 3);
  assert.equal(dchStars(2), 2);
  assert.equal(dchStars(1), 1);
  assert.equal(dchStars(0), 1);
});
