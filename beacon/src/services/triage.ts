import { TRIAGE_CHOICES, type Severity, type TriageChoiceId, getTriageChoice } from '../kb/triage';
import type { Lang } from '../kb/types';

// Pure guided-triage logic. No react-native imports here, so the tests run under plain tsx.

export interface TriageResult {
  guideIds: string[];
  severity: 'emergency' | 'urgent' | 'home';
  reasons: string[];
}

const RANK: Record<Severity, number> = { home: 0, urgent: 1, emergency: 2 };
const idx = (lang: Lang) => (lang === 'hi' ? 1 : 0);

export const triageQuestions = (choice: TriageChoiceId, lang: Lang = 'en'): { id: string; text: string }[] => {
  const c = getTriageChoice(choice);
  if (!c) return [];
  return c.questions.map((q) => ({ id: q.id, text: q.ask[idx(lang)] }));
};

/**
 * Combine the base outcome of a choice with every "yes" answer. Severity and guide ids only ever go up: an answer
 * can add an emergency, never remove one. Guides from the most severe contribution come first.
 */
export function triageResult(choice: TriageChoiceId, answers: Record<string, boolean>, lang: Lang = 'en'): TriageResult {
  const c = getTriageChoice(choice);
  if (!c) return { guideIds: [], severity: 'urgent', reasons: [] };

  const hits = [c.base, ...c.questions.filter((q) => answers[q.id] && q.yes).map((q) => q.yes!)];
  // stable sort by severity, most severe first, so the base outcome keeps its place among equals
  const ordered = hits
    .map((o, i) => ({ o, i }))
    .sort((a, b) => RANK[b.o.severity] - RANK[a.o.severity] || a.i - b.i)
    .map((x) => x.o);

  const severity = ordered.reduce<Severity>((max, o) => (RANK[o.severity] > RANK[max] ? o.severity : max), 'home');
  const guideIds: string[] = [];
  for (const o of ordered) for (const g of o.guideIds) if (!guideIds.includes(g)) guideIds.push(g);
  const reasons: string[] = [];
  for (const o of ordered) {
    const r = o.reason[idx(lang)];
    if (!reasons.includes(r)) reasons.push(r);
  }
  return { guideIds, severity, reasons };
}

/**
 * Map a vision-model sentence (for example "a bleeding cut on a hand") to the best-matching choice. Only used to
 * pre-select a chip; the person still confirms. Returns null when nothing matches.
 */
export function choiceFromDescription(text: string): TriageChoiceId | null {
  const lower = text.toLowerCase();
  let best: TriageChoiceId | null = null;
  let bestScore = 0;
  for (const c of TRIAGE_CHOICES) {
    let score = 0;
    for (const k of c.keywords) if (k && mentions(lower, k)) score += 1;
    if (score > bestScore) {
      best = c.id;
      bestScore = score;
    }
  }
  return best;
}

const NEGATION = /\b(no|not|without|nor|none|never|isn't|aren't|free of)\b|नहीं|नही|बिना/iu;

/**
 * True when `keyword` appears in `lower` as a whole word (plurals and -ed/-ing allowed) and at least one
 * appearance is not negated in its own clause. "face" does not match "surface"; "no blood" does not count.
 * Hindi keywords have no word boundaries in JS, so they are matched as plain substrings.
 */
export function mentions(lower: string, keyword: string): boolean {
  const k = keyword.toLowerCase();
  if (!k) return false;
  const ascii = /^[a-z]+$/.test(k);
  const re = ascii ? new RegExp(`\\b${k}(s|es|ed|ing)?\\b`, 'g') : null;
  if (!re) return lower.includes(k);
  for (const m of lower.matchAll(re)) {
    const before = lower.slice(0, m.index ?? 0).split(/[.,;!?]/).pop() ?? '';
    if (!NEGATION.test(before)) return true;
  }
  return false;
}
