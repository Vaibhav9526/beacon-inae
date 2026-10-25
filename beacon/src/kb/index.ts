import { DISASTERS, GO_BAG } from './disasters';
import { FIRST_AID } from './firstaid';
import { REMEDIES } from './remedies';
import type { DisasterGuide, Guide, Lang } from './types';

export * from './types';
export { DISASTERS, GO_BAG, FIRST_AID, REMEDIES };

export const ALL_GUIDES: Guide[] = [...FIRST_AID, ...REMEDIES];
const byId = new Map(ALL_GUIDES.map((g) => [g.id, g]));
const disasterById = new Map(DISASTERS.map((d) => [d.id, d]));

export const getGuide = (id: string) => byId.get(id);
export const getDisaster = (id: string) => disasterById.get(id);

// ---------- offline keyword matching ----------

const STOP = new Set(
  'a an the is are was am i my me we you he she it to of in on at and or for with have has had do does did not no can cannot cant dont what how there this that very been being from by as so if then they them his her our your please help need want near'.split(' '),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

// light stemming so "bleeding/bleeds/bled" and "burns/burnt" meet their keywords
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/u, '').replace(/^(.{3,}?)(e)$/u, '$1');

export interface Match<T> {
  item: T;
  score: number;
}

function score(query: string[], keywords: string, title: string): number {
  const kw = new Set(tokenize(keywords).map(stem));
  const ti = new Set(tokenize(title).map(stem));
  let s = 0;
  for (const raw of query) {
    const w = stem(raw);
    if (kw.has(w)) s += 1;
    if (ti.has(w)) s += 2;
  }
  return s;
}

export function searchGuides(text: string, opts: { kind?: Guide['kind']; limit?: number } = {}): Match<Guide>[] {
  const q = tokenize(text);
  if (q.length === 0) return [];
  return ALL_GUIDES.filter((g) => !opts.kind || g.kind === opts.kind)
    .map((g) => ({
      item: g,
      // both languages are scored at once so a Hindi or Hinglish query still works
      score: score(q, g.keywords[0] + ' ' + g.keywords[1], g.title[0] + ' ' + g.title[1]),
    }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || (a.item.level === 'emergency' ? -1 : 1))
    .slice(0, opts.limit ?? 5);
}

export function searchDisasters(text: string): Match<DisasterGuide>[] {
  const q = tokenize(text);
  return DISASTERS.map((d) => ({ item: d, score: score(q, d.keywords[0] + ' ' + d.keywords[1], d.title[0] + ' ' + d.title[1]) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** Level names shown on screen. */
export const LEVEL_LABEL: Record<Guide['level'], readonly [string, string]> = {
  emergency: ['Emergency: call 112', 'आपात: 112 पर कॉल करें'],
  urgent: ['See a doctor soon', 'जल्द डॉक्टर को दिखाएँ'],
  minor: ['Manage at home', 'घर पर देखभाल'],
};

export const langIndex = (l: Lang) => (l === 'hi' ? 1 : 0);
