// Tolerance for words a speech recogniser mis-heard ("open whether" for "open weather"). Pure; no imports.

/** Number of single-letter edits (insert, delete, change) between two strings. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** How many edits a word of this length may be off by and still count as the same word. Short words must be exact. */
export function allowedEdits(len: number): number {
  if (len <= 4) return 0;
  if (len <= 6) return 1;
  return 2;
}

/**
 * Score for how well `tokens` (already normalised words) contain `alias` (normalised) with mis-heard letters.
 * 0 = no match. Higher = closer. Exact matches are left to the caller; this only rewards near misses.
 */
export function fuzzyAliasScore(tokens: string[], alias: string): number {
  const n = alias.split(' ').length;
  const allow = allowedEdits(alias.replace(/ /g, '').length);
  if (allow === 0) return 0;
  let best = 0;
  for (let i = 0; i + n <= tokens.length; i++) {
    const d = editDistance(tokens.slice(i, i + n).join(' '), alias);
    if (d > 0 && d <= allow) best = Math.max(best, alias.length - d * 2);
  }
  return best;
}
