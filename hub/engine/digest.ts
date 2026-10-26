import { SEVERITY_RANK, type FeedItem, type FeedKind, type Severity } from './types.ts';

/** Telegram allows 4096 characters per message; we stay under with room for closing tags. */
export const TELEGRAM_MAX = 4000;
const DETAIL_PHONE_MAX = 1500;
const DETAIL_TG_MAX = 600;
const BODY_TG_MAX = 400;
const TITLE_PHONE_MAX = 50;
const BODY_WORDS_MAX = 60;

export function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Remove tags and decode the entities escapeHtml makes, for the plain text fallback. */
export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

const clip = (s: string, n: number): string => {
  const t = String(s ?? '').trim();
  return t.length > n ? t.slice(0, Math.max(0, n - 3)).trimEnd() + '...' : t;
};

/** Only http and https links are allowed in a post. Returns the normalised url or undefined. */
export function safeUrl(u: unknown): string | undefined {
  if (typeof u !== 'string' || !u.trim()) return undefined;
  try {
    const p = new URL(u.trim());
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.href : undefined;
  } catch {
    return undefined;
  }
}

const SEV_LABEL: Record<Severity, string> = { info: 'Info', watch: 'Watch', warning: 'Warning', severe: 'Severe' };

/* ---------- numbers with units ---------- */

const KNOWN: Record<string, [string, string]> = {
  temp_c: ['Temperature', 'C'],
  feels_like_c: ['Feels like', 'C'],
  heat_index_c: ['Heat index', 'C'],
  humidity_pct: ['Humidity', '%'],
  wind_kmh: ['Wind', 'km/h'],
  wind_gust_kmh: ['Gusts', 'km/h'],
  rain_mm_24h: ['Rain in 24 h', 'mm'],
  rain_mm_3h: ['Rain in 3 h', 'mm'],
  rain_mm_now: ['Rain now', 'mm'],
  uv_index: ['UV index', ''],
  aqi: ['AQI', ''],
  pm25: ['PM2.5', 'ug/m3'],
  quake_max_mag: ['Largest quake', 'M'],
  quake_nearest_km: ['Nearest quake', 'km'],
  quake_count: ['Quakes', ''],
  water_days: ['Water', 'days'],
  food_days: ['Food', 'days'],
  medicine_days: ['Medicine', 'days'],
};
const MEMBER_KEYS: Record<string, [string, string]> = {
  hr: ['Heart rate', 'bpm'],
  spo2: ['SpO2', '%'],
  steps: ['Steps', ''],
  sleep_h: ['Sleep', 'h'],
};
const UNITS: Record<string, string> = { c: 'C', kmh: 'km/h', mm: 'mm', pct: '%', km: 'km', days: 'days', min: 'min', h: 'h', m: 'm', ms: 'm/s', mag: 'M' };

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const fmtNum = (n: number): string => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

/** "wind_kmh", 62 -> "Wind 62 km/h"; unknown keys are humanised from their parts. */
export function labelData(key: string, value: number | string): string {
  const val = typeof value === 'number' ? fmtNum(value) : String(value);
  let label: string;
  let unit = '';
  const colon = key.indexOf(':');
  if (colon > 0 && MEMBER_KEYS[key.slice(0, colon)]) {
    const [name, u] = MEMBER_KEYS[key.slice(0, colon)]!;
    label = `${name} (${key.slice(colon + 1)})`;
    unit = u;
  } else if (KNOWN[key]) {
    [label, unit] = KNOWN[key]!;
  } else {
    const tokens = key.split(/[_\s]+/).filter(Boolean);
    const at = tokens.findIndex((t, i) => i > 0 && UNITS[t] !== undefined);
    if (at > 0) {
      const rest = tokens.slice(at + 1).map((t) => t.replace(/^(\d+)([a-z]+)$/i, '$1 $2'));
      label = cap(tokens.slice(0, at).join(' ')) + (rest.length ? ' in ' + rest.join(' ') : '');
      unit = UNITS[tokens[at]!]!;
    } else label = cap(tokens.join(' ') || key);
  }
  if (typeof value === 'string') return `${label} ${val}`;
  return `${label} ${val}${unit === '%' ? '%' : unit ? ' ' + unit : ''}`;
}

function dataLines(data: FeedItem['data']): string[] {
  if (!data) return [];
  return Object.entries(data)
    .filter(([, v]) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== ''))
    .slice(0, 12)
    .map(([k, v]) => labelData(k, v));
}

/* ---------- sections ---------- */

const SECTION_ORDER = ['Alerts', 'Weather now', 'Next 24 hours', 'Wind', 'Rain and flood', 'Air quality', 'Quakes', 'Other updates', 'News headlines'] as const;
type Section = (typeof SECTION_ORDER)[number];

function sectionOf(it: FeedItem): Section {
  if (it.kind === 'alert') return 'Alerts';
  if (it.tags.includes('forecast') || it.tags.includes('next24h')) return 'Next 24 hours';
  if (it.kind === 'wind') return 'Wind';
  if (it.kind === 'flood') return 'Rain and flood';
  if (it.kind === 'quake') return 'Quakes';
  if (it.kind === 'news') return 'News headlines';
  if (it.tags.includes('aqi') || (it.data && ('aqi' in it.data || 'pm25' in it.data))) return 'Air quality';
  if (it.kind === 'weather') return 'Weather now';
  return 'Other updates';
}

const WEATHER_LIKE: readonly FeedKind[] = ['weather', 'wind', 'flood'];

const bySeverity = (a: FeedItem, b: FeedItem): number => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.at - a.at;

function groupItems(items: FeedItem[]): Array<{ name: Section; items: FeedItem[] }> {
  const map = new Map<Section, FeedItem[]>();
  for (const it of [...items].sort(bySeverity)) {
    const s = sectionOf(it);
    map.set(s, [...(map.get(s) ?? []), it]);
  }
  return SECTION_ORDER.filter((s) => map.has(s)).map((name) => ({ name, items: map.get(name)! }));
}

function localTime(ms: number): string {
  return new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

function hashId(parts: string[]): string {
  let h = 5381;
  for (const ch of parts.join('|')) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

/* ---------- one item as Telegram HTML ---------- */

function itemBlock(it: FeedItem, showSeverity = true): string {
  const t = escapeHtml(clip(it.title, 200));
  const url = safeUrl(it.url);
  const head = url ? `<a href="${escapeHtml(url)}">${t}</a>` : `<b>${t}</b>`;
  const sev = showSeverity && it.severity !== 'info' ? ` (${SEV_LABEL[it.severity]})` : '';
  let s = `- ${head}${sev}`;
  const nums = dataLines(it.data);
  if (nums.length) s += `\n  ${escapeHtml(nums.join(', '))}`;
  const text = it.detail?.trim() ? clip(it.detail, DETAIL_TG_MAX) : clip(it.body, BODY_TG_MAX);
  if (text) s += `\n${escapeHtml(text)}`;
  return s;
}

/** One feed item as a big Telegram HTML post (instant routes). */
export function formatItemPost(item: FeedItem, opts: { now?: number; place?: string; nextInMin?: number } = {}): string {
  const place = opts.place ?? item.place;
  const meta = [SEV_LABEL[item.severity], item.agentName, place, localTime(opts.now ?? item.at)].filter(Boolean).join(' - ');
  const lines = [`<b>${escapeHtml(clip(item.title, 200))}</b>`, `<i>${escapeHtml(meta)}</i>`];
  const text = item.detail?.trim() ? clip(item.detail, DETAIL_TG_MAX) : clip(item.body, BODY_TG_MAX);
  if (text) lines.push('', escapeHtml(text));
  const nums = dataLines(item.data);
  if (nums.length) lines.push('', ...nums.map((n) => `- ${escapeHtml(n)}`));
  const url = safeUrl(item.url);
  if (url) lines.push('', `<a href="${escapeHtml(url)}">Read more</a>`);
  lines.push('', `<i>Sent by Beacon Hub.${opts.nextInMin ? ` Next update in ${opts.nextInMin} min.` : ''}</i>`);
  return lines.join('\n');
}

/* ---------- splitting ---------- */

/**
 * Split Telegram HTML into messages of at most `max` characters on newlines. Tags that are open at a split are closed
 * at the end of the message and reopened at the start of the next, so no message has a broken tag. A single line
 * longer than `max` is cut at a point outside any tag or entity.
 */
export function splitHtml(text: string, max = TELEGRAM_MAX): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let open: string[] = []; // opening tags, in order
  let cur = '';
  const names = () => open.map((t) => /^<([a-z]+)/i.exec(t)![1]!);
  const closers = () => names().reverse().map((n) => `</${n}>`).join('');
  const track = (s: string) => {
    for (const m of s.matchAll(/<(\/?)([a-z]+)(?:\s[^>]*)?>/gi)) {
      if (m[1]) {
        const i = names().lastIndexOf(m[2]!.toLowerCase());
        if (i >= 0) open = open.slice(0, i);
      } else open.push(m[0]);
    }
  };
  const flush = () => {
    if (!cur.trim()) return;
    out.push(cur.replace(/\n+$/, '') + closers());
    cur = open.join('');
  };
  const pieces: string[] = [];
  for (const line of text.split('\n')) {
    let rest = line;
    while (rest.length > max - 200) {
      let cut = max - 200;
      const lt = rest.lastIndexOf('<', cut);
      if (lt > rest.lastIndexOf('>', cut)) cut = lt;
      const amp = rest.lastIndexOf('&', cut);
      if (amp > rest.lastIndexOf(';', cut) && cut - amp < 8) cut = amp;
      const sp = rest.lastIndexOf(' ', cut);
      if (sp > cut / 2 && !(rest.lastIndexOf('<', sp) > rest.lastIndexOf('>', sp))) cut = sp;
      if (cut <= 0) cut = max - 200;
      pieces.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    pieces.push(rest);
  }
  for (const piece of pieces) {
    const add = (cur && !cur.endsWith('\n') ? '\n' : '') + piece;
    if (cur.length + add.length + closers().length > max && cur.trim() && cur !== open.join('')) flush();
    cur += (cur && !cur.endsWith('\n') ? '\n' : '') + piece;
    track(piece);
  }
  if (cur.trim() && cur !== open.join('')) out.push(cur + closers());
  return out;
}

/* ---------- the digest ---------- */

export interface DigestOpts {
  title?: string;
  place?: string;
  nextInMin?: number;
  now: number;
  /** add the 'notify' tag to the phone item */
  notify?: boolean;
  /** makes the id differ between routes that queue the same items */
  routeId?: string;
}

function mostCommonPlace(items: FeedItem[]): string | undefined {
  const count = new Map<string, number>();
  for (const it of items) if (it.place) count.set(it.place, (count.get(it.place) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function phoneTitle(items: FeedItem[], base: string, place: string | undefined): string {
  const strongest = [...items].sort(bySeverity)[0]!;
  let temp: number | undefined;
  for (const it of items) if (typeof it.data?.temp_c === 'number') { temp = it.data.temp_c; break; }
  const lead = `${base}:${place ? ' ' + place : ''}${temp !== undefined ? ` ${fmtNum(temp)} C` : ''}`;
  const headline = clip(strongest.title.replace(/[.!\s]+$/, ''), 40);
  const lowered = /^[A-Z][a-z]/.test(headline) ? headline.charAt(0).toLowerCase() + headline.slice(1) : headline;
  const joiner = lead.endsWith(':') ? ' ' : ', ';
  const full = lead + joiner + lowered;
  if (full.length <= TITLE_PHONE_MAX) return full;
  return clip(lead.endsWith(':') ? lowered || lead : lead, TITLE_PHONE_MAX);
}

/** Combine queued items into one phone item and a set of Telegram messages. Items must not be empty. */
export function buildDigest(items: FeedItem[], opts: DigestOpts): { phoneItem: FeedItem; telegram: string[] } {
  if (!items.length) throw new Error('buildDigest needs at least one item');
  const sorted = [...items].sort(bySeverity);
  const weatherLike = items.every((i) => WEATHER_LIKE.includes(i.kind));
  const severity = sorted[0]!.severity;
  const place = opts.place ?? mostCommonPlace(items);
  const base = opts.title?.trim() || (weatherLike ? 'Weather update' : 'Update');
  const title = phoneTitle(items, base, place);

  const body = sorted
    .slice(0, 3)
    .map((i) => i.title.replace(/[.!\s]+$/, ''))
    .join('. ')
    .split(/\s+/)
    .slice(0, BODY_WORDS_MAX)
    .join(' ') + '.';

  const groups = groupItems(items);
  const dl: string[] = [];
  for (const g of groups) {
    if (dl.length) dl.push('');
    dl.push(`${g.name}:`);
    for (const it of g.items) {
      const nums = dataLines(it.data);
      dl.push(`- ${it.title.trim()}${it.severity !== 'info' ? ` (${SEV_LABEL[it.severity]})` : ''}${nums.length ? ': ' + nums.join(', ') : ''}`);
      const note = clip(it.body, 140);
      if (note) dl.push(`  ${note}`);
    }
  }
  let detail = '';
  for (const line of dl) {
    if ((detail ? detail.length + 1 : 0) + line.length > DETAIL_PHONE_MAX - 4) {
      detail += '\n...';
      break;
    }
    detail += (detail ? '\n' : '') + line;
  }

  const union = [...new Set(items.flatMap((i) => i.tags))].filter((t) => t !== 'digest' && t !== 'notify');
  const tags = ['digest', ...union, ...(opts.notify ? ['notify'] : [])];
  const phoneItem: FeedItem = {
    id: `digest-${hashId([opts.routeId ?? '', ...items.map((i) => i.id).sort()])}`,
    agentId: 'digest',
    agentName: 'Beacon Hub',
    kind: weatherLike ? 'weather' : 'advisory',
    title,
    body,
    severity,
    at: opts.now,
    tags,
    detail,
  };
  if (place) phoneItem.place = place;

  // Telegram
  const head = [`<b>${escapeHtml(clip(opts.title?.trim() || (weatherLike ? 'Weather update' : 'Update'), 120))}</b>`];
  const sub = [place, localTime(opts.now)].filter(Boolean).join(' - ');
  head.push(`<i>${escapeHtml(sub)}</i>`);
  const footer = `<i>Sent by Beacon Hub.${opts.nextInMin ? ` Next update in ${opts.nextInMin} min.` : ''}</i>`;

  const messages: string[] = [];
  let cur = head.join('\n');
  const push = (piece: string, glue: string) => {
    if (cur && cur.length + glue.length + piece.length <= TELEGRAM_MAX) cur += glue + piece;
    else {
      if (cur) messages.push(cur);
      cur = piece;
    }
  };
  for (const g of groups) {
    const heading = `<b>${g.name}</b>`;
    const whole = [heading, ...g.items.map((i) => itemBlock(i))].join('\n');
    if (whole.length <= TELEGRAM_MAX) push(whole, '\n\n');
    else {
      let first = true;
      for (const i of g.items) {
        const block = itemBlock(i);
        const piece = `<b>${g.name}${first ? '' : ' (continued)'}</b>\n${block}`;
        if (first) {
          push(piece, '\n\n');
          first = false;
        } else if (cur.length + 1 + block.length <= TELEGRAM_MAX && cur.includes(`<b>${g.name}`)) cur += '\n' + block;
        else {
          messages.push(cur);
          cur = piece;
        }
      }
    }
  }
  push(footer, '\n\n');
  if (cur) messages.push(cur);
  return { phoneItem, telegram: messages.flatMap((m) => splitHtml(m)) };
}
