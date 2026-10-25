import type { Condition, Op, Rule, Severity } from './types.ts';

/**
 * Deterministic parser for plain-English rules, e.g.
 * "if heat index > 41 and Maa's heart rate > 110 alert me".
 * Member-specific metrics take the name from a possessive ("Maa's"); without one they use "Member".
 */

interface MetricDef {
  re: RegExp;
  metric: string;
  /** Health metrics are keyed as `<metric>:<Member>`. */
  member?: boolean;
  label: string;
}

// Order matters: the first definition that matches a clause wins, so specific phrases come first.
const METRICS: MetricDef[] = [
  { re: /\bheat[\s_-]?index\b/, metric: 'heat_index_c', label: 'Heat index' },
  { re: /\bfeels[\s_-]?like\b/, metric: 'feels_like_c', label: 'Feels like' },
  { re: /\bwind[\s_-]?gusts?\b/, metric: 'wind_gust_kmh', label: 'Wind gust' },
  { re: /\bwind\b/, metric: 'wind_kmh', label: 'Wind' },
  { re: /\bhumidity\b/, metric: 'humidity_pct', label: 'Humidity' },
  { re: /\b(?:temperature|temp)\b/, metric: 'temp_c', label: 'Temperature' },
  { re: /\buv(?:[\s_-]?index)?\b/, metric: 'uv_index', label: 'UV index' },
  { re: /\brain(?:fall)?\b/, metric: 'rain_mm_24h', label: 'Rain' },
  { re: /\b(?:aqi|air quality(?: index)?)\b/, metric: 'aqi', label: 'AQI' },
  { re: /\bpm\s?2[._]?5\b/, metric: 'pm25', label: 'PM2.5' },
  { re: /\b(?:earthquake\s+magnitude|magnitude|earthquakes?|quake)\b/, metric: 'quake_max_mag', label: 'Earthquake magnitude' },
  { re: /\b(?:heart\s?rate|pulse|hr)\b/, metric: 'hr', member: true, label: 'heart rate' },
  { re: /\b(?:oxygen|spo\s?2|saturation)\b/, metric: 'spo2', member: true, label: 'oxygen' },
  { re: /\bsleep\b/, metric: 'sleep_h', member: true, label: 'sleep' },
  { re: /\bsteps?\b/, metric: 'steps', member: true, label: 'steps' },
  { re: /\bwater\b/, metric: 'water_days', label: 'Water days left' },
  { re: /\bfood\b/, metric: 'food_days', label: 'Food days left' },
  { re: /\bmedicines?\b/, metric: 'medicine_days', label: 'Medicine days left' },
];

const OP_WORDS: Array<[string, Op]> = [
  ['drops below', '<'], ['falls below', '<'], ['goes below', '<'], ['dips below', '<'],
  ['less than', '<'], ['lower than', '<'], ['below', '<'], ['under', '<'],
  ['at most', '<='], ['no more than', '<='],
  ['at least', '>='], ['no less than', '>='],
  ['more than', '>'], ['greater than', '>'], ['higher than', '>'],
  ['rises above', '>'], ['goes above', '>'], ['above', '>'], ['over', '>'], ['exceeds', '>'], ['exceed', '>'],
  ['not equal to', '!='], ['is exactly', '=='], ['equal to', '=='], ['equals', '=='],
];
const OP_SYMBOLS: Array<[string, Op]> = [['>=', '>='], ['<=', '<='], ['==', '=='], ['!=', '!='], ['>', '>'], ['<', '<'], ['=', '==']];

const OP_TEXT = new Map<string, Op>([...OP_WORDS, ...OP_SYMBOLS]);
const OP_RE = new RegExp(
  `\\b(?:${OP_WORDS.map(([w]) => w).sort((a, b) => b.length - a.length).map(escapeRe).join('|')})\\b|(>=|<=|==|!=|>|<|=)`,
);

/** Words that carry no meaning for the rule and do not lower confidence. */
const FILLER = new Set([
  'if', 'when', 'whenever', 'once', 'then', 'and', 'or', 'me', 'my', 'us', 'is', 'are', 'be', 'it', 'the', 'a', 'an',
  'of', 'in', 'to', 'at', 'than', 'per', 'day', 'days', 'hour', 'hours', 'min', 'minutes', 'mm', 'km', 'kmh', 'c',
  'celsius', 'percent', 'degrees', 'bpm', 'please', 'drops', 'falls', 'goes', 'gets', 'rises', 'reaches', 'hits',
  'becomes', 'last', 'past', 'also', 'let', 'know', 'send',
]);

const NOT_NAMES = new Set(['it', 'that', 'this', 'my', 'your', 'our', 'its', 'the', 'there']);

const SEVERITY_WORDS = /\b(?:urgent|emergency|severe|danger|warn|warning|alert|tell|notify|watch|remind)\b/g;

interface Piece {
  cond: Condition;
  /** Message fragment with `{metric}` placeholders. */
  text: string;
  leftover: string;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parseClause(clause: string): Piece | null {
  let def: MetricDef | undefined;
  let hit: RegExpExecArray | null = null;
  for (const d of METRICS) {
    const r = d.re.exec(clause);
    if (r) {
      def = d;
      hit = r;
      break;
    }
  }
  if (!def || !hit) return null;

  let name = 'Member';
  let before = clause.slice(0, hit.index);
  const after = clause.slice(hit.index + hit[0].length);
  if (def.member) {
    const poss = before.match(/([a-z]+)'s\s*$/);
    if (poss && poss.index !== undefined && !NOT_NAMES.has(poss[1]!)) {
      name = capitalize(poss[1]!);
      before = before.slice(0, poss.index);
    }
  }

  const s = `${before} ${after}`;
  const opHit = OP_RE.exec(s);
  if (!opHit) return null;
  const op = OP_TEXT.get(opHit[0].trim());
  if (!op) return null;

  const pre = s.slice(0, opHit.index);
  const post = s.slice(opHit.index + opHit[0].length);
  const numHit = /-?\d+(?:\.\d+)?/.exec(post);
  if (!numHit) return null;

  const value = Number(numHit[0]);
  const metric = def.member ? `${def.metric}:${name}` : def.metric;
  const label = def.member ? `${name}'s ${def.label}` : def.label;
  const opText = opHit[0].trim();
  const leftover = `${pre} ${post.slice(0, numHit.index)} ${post.slice(numHit.index + numHit[0].length)}`;

  return {
    cond: { metric, op, value },
    text: `${label} {${metric}} ${opText} ${numHit[0]}`,
    leftover,
  };
}

export function parseRule(text: string): { rule: Rule; confidence: number } | null {
  const original = text.trim();
  const norm = original
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/°/g, ' ')
    .replace(/\s+/g, ' ');
  if (!norm) return null;

  // Severity from keywords. Default is watch.
  let severity: Severity = 'watch';
  if (/\b(?:urgent|emergency|severe|danger)/.test(norm)) severity = 'severe';
  else if (/\bwarn/.test(norm)) severity = 'warning';
  else if (/\b(?:alert|tell|notify)/.test(norm)) severity = 'warning';
  else if (/\b(?:watch|remind)/.test(norm)) severity = 'watch';

  let work = norm.replace(SEVERITY_WORDS, ' ');

  // "within N km" is a distance condition on the nearest quake. It is used only when a quake metric is present.
  let withinKm: number | undefined;
  const within = work.match(/\bwithin\s+(\d+(?:\.\d+)?)\s*km\b/);
  if (within) {
    withinKm = Number(within[1]);
    work = work.replace(within[0], ' ');
  }

  const hasAnd = /\band\b/.test(norm);
  const hasOr = /\bor\b/.test(norm);
  const mode: 'all' | 'any' = hasOr && !hasAnd ? 'any' : 'all';

  const pieces: Piece[] = [];
  const residue: string[] = [];
  for (const clause of work.split(/\s*(?:,|;|\band\b|\bor\b|\bthen\b)\s*/)) {
    if (!clause.trim()) continue;
    const piece = parseClause(clause);
    if (piece) {
      pieces.push(piece);
      residue.push(piece.leftover);
    } else {
      residue.push(clause);
    }
  }

  if (pieces.length === 0) return null;

  const conditions: Condition[] = pieces.map((p) => p.cond);
  const fragments: string[] = pieces.map((p) => p.text);

  if (withinKm !== undefined) {
    if (conditions.some((c) => c.metric === 'quake_max_mag')) {
      conditions.push({ metric: 'quake_nearest_km', op: '<=', value: withinKm });
      fragments.push(`Earthquake within ${withinKm} km (nearest {quake_nearest_km} km)`);
    } else {
      residue.push(`within ${withinKm} km`);
    }
  }

  // Confidence: share of the words that were understood (matched, or filler).
  const totalTokens = norm.split(/[\s,;]+/).filter((t) => /[a-z0-9]/.test(t));
  const unknown = residue
    .join(' ')
    .split(/[\s,;]+/)
    .filter((t) => /[a-z0-9]/.test(t) && !FILLER.has(t)).length;
  const confidence = totalTokens.length === 0
    ? 0
    : Math.round(Math.max(0, (totalTokens.length - unknown) / totalTokens.length) * 100) / 100;

  const joiner = mode === 'any' ? ' or ' : ' and ';
  const message = capitalize(fragments.join(joiner));

  const slug = norm.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

  const rule: Rule = {
    id: `custom-${slug}`,
    name: original.slice(0, 80),
    when: { mode, conditions },
    severity,
    message,
  };

  return { rule, confidence };
}
