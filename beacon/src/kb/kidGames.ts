// Pure game rules for the kid games (no React, no native modules), so they can be unit tested.

export type Rand = () => number;

/** Fisher-Yates shuffle that returns a new array. */
export function shuffle<T>(items: readonly T[], rand: Rand = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- 1. pack the go-bag ----
export const BAG_LIVES = 3;
export const BAG_GOOD_PER_ROUND = 6;
export const BAG_BAD_PER_ROUND = 5;

/** Picks the items for one round: some needed things and some that are not, in random order. */
export function pickBagRound<T extends { good: boolean }>(items: readonly T[], goodCount = BAG_GOOD_PER_ROUND, badCount = BAG_BAD_PER_ROUND, rand: Rand = Math.random): T[] {
  const good = shuffle(
    items.filter((i) => i.good),
    rand,
  ).slice(0, goodCount);
  const bad = shuffle(
    items.filter((i) => !i.good),
    rand,
  ).slice(0, badCount);
  return shuffle([...good, ...bad], rand);
}

/** The bag game is over when every needed item is packed or all lives are gone. */
export function bagIsOver(mistakes: number, packed: number, goodTotal: number): boolean {
  return mistakes >= BAG_LIVES || packed >= goodTotal;
}

/** 3 stars for a clean pack, 2 for one mistake, 1 otherwise (including running out of lives). */
export function bagStars(mistakes: number, packedAll: boolean): 1 | 2 | 3 {
  if (!packedAll || mistakes >= BAG_LIVES) return 1;
  if (mistakes === 0) return 3;
  return mistakes === 1 ? 2 : 1;
}

// ---- 2. safe or not ----
export const SAFE_ROUND_SIZE = 8;

export function pickSafeRound<T>(cards: readonly T[], n = SAFE_ROUND_SIZE, rand: Rand = Math.random): T[] {
  return shuffle(cards, rand).slice(0, Math.min(n, cards.length));
}

export function isSafeAnswerRight(card: { safe: boolean }, answerSafe: boolean): boolean {
  return card.safe === answerSafe;
}

export function safeStars(score: number, total: number): 1 | 2 | 3 {
  if (total <= 0) return 1;
  if (score >= total) return 3;
  return score >= total - 2 ? 2 : 1;
}

// ---- 3. drop, cover, hold ----
export const DCH_MOVES = ['drop', 'cover', 'hold'] as const;
export type DchMove = (typeof DCH_MOVES)[number];
export const DCH_ROUNDS = 3;

/** Seconds allowed per round. Gets tighter each round. */
export function dchTimeLimit(round: number): number {
  return [4, 3, 2.4][Math.min(Math.max(round, 0), 2)];
}

/** One tap at position `need` of the sequence. Returns what happens next. */
export function dchTap(need: number, tapped: number): 'fail' | 'advance' | 'complete' {
  if (tapped !== need) return 'fail';
  return need >= DCH_MOVES.length - 1 ? 'complete' : 'advance';
}

/** One 100 ms timer tick, never below zero, rounded so 0.1 steps stay exact. */
export function dchTick(left: number): number {
  return Math.max(0, Number((left - 0.1).toFixed(1)));
}

export function dchStars(wins: number): 1 | 2 | 3 {
  return wins >= DCH_ROUNDS ? 3 : wins >= 2 ? 2 : 1;
}
