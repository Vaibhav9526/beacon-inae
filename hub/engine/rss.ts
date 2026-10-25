// Tolerant RSS 2.0 and Atom parser, plus the text helpers shared by nodes.ts and capParse.ts.
// Regex based on purpose: real feeds are often slightly broken, and a strict XML parser would reject them.

import { createHash } from 'node:crypto';

export interface FeedEntry {
  title: string;
  link: string;
  summary: string;
  publishedAt: number | null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', hellip: '…', copy: '©', reg: '®', trade: '™',
};

const CDATA_SPLIT = /(<!\[CDATA\[[\s\S]*?\]\]>)/;
/** Inline formatting tags join the words around them, so they become nothing rather than a space. */
const INLINE_TAG_RE = /<\/?(?:b|i|u|em|strong|span|a|font|small|sup|sub)\b[^>]*>/gi;

/** Decodes numeric and common named entities in one pass, so "&amp;lt;" becomes "&lt;" and no further. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Plain text: CDATA is taken literally, entities are decoded, markup is kept as typed. Used for CAP. */
export function plainText(raw: string | undefined): string {
  if (!raw) return '';
  return collapse(
    raw.split(CDATA_SPLIT)
      .map((p) => (p.startsWith('<![CDATA[') ? p.slice(9, -3) : decodeEntities(p)))
      .join(''),
  );
}

/**
 * Feed text to readable text: tags become spaces, entities are decoded, and escaped markup
 * (&lt;p&gt;...) is stripped too. Whitespace is collapsed.
 */
export function htmlToText(raw: string | undefined): string {
  if (!raw) return '';
  const unwrapped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, ' $1 ');
  const spaced = unwrapped
    .replace(INLINE_TAG_RE, '')
    .replace(/<[^>]*>/g, ' ');
  let text = decodeEntities(spaced);
  if (/<\/?[a-z][^>]*>/i.test(text)) text = text.replace(INLINE_TAG_RE, '').replace(/<[^>]*>/g, ' ');
  return collapse(text);
}

/** Text of the first <name> element (unprefixed first, then any namespace prefix). Undefined when absent. */
export function xmlTag(block: string, name: string): string | undefined {
  const plain = new RegExp(`<${name}(?=[\\s>])[^>]*(?<!/)>([\\s\\S]*?)</${name}\\s*>`, 'i').exec(block);
  if (plain) return plain[1];
  const prefixed = new RegExp(`<[\\w.-]+:${name}(?=[\\s>])[^>]*(?<!/)>([\\s\\S]*?)</[\\w.-]+:${name}\\s*>`, 'i').exec(block);
  return prefixed?.[1];
}

/** Date from RFC 822 (RSS), ISO 8601 (Atom) or "IST". Null when unreadable. */
export function parseDate(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim().replace(/\bIST\b/, '+0530');
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** Stable id for a feed item: hash of kind, title and url. Repeats of the same story get the same id. */
export function itemId(kind: string, title: string, url?: string): string {
  return createHash('sha256').update(`${kind}\n${title}\n${url ?? ''}`).digest('hex').slice(0, 16);
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** First `n` words, with "..." added when something was cut. The word count stays at n. */
export function trimWords(text: string, n: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= n) return words.join(' ');
  return `${words.slice(0, n).join(' ')}...`;
}

const ITEM_RE = /<(?:[\w.-]+:)?(item|entry)(?=[\s>])[^>]*(?<!\/)>([\s\S]*?)<\/(?:[\w.-]+:)?\1\s*>/gi;
const LINK_RE = /<link(?=[\s>/])([^>]*)>/gi;

function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(attrs)?.[2];
}

/** Atom links: prefers rel="alternate" (or no rel), falls back to any href. */
function atomHref(block: string): string | undefined {
  let fallback: string | undefined;
  for (const m of block.matchAll(LINK_RE)) {
    const href = attr(m[1], 'href');
    if (!href) continue;
    const rel = attr(m[1], 'rel') ?? 'alternate';
    if (rel === 'alternate') return decodeEntities(href).trim();
    fallback ??= decodeEntities(href).trim();
  }
  return fallback;
}

function entryOf(block: string): FeedEntry | null {
  const title = htmlToText(xmlTag(block, 'title'));
  const link = atomHref(block) || htmlToText(xmlTag(block, 'link'));
  let summary = '';
  for (const name of ['summary', 'description', 'encoded', 'content']) {
    summary = htmlToText(xmlTag(block, name));
    if (summary) break;
  }
  let publishedAt: number | null = null;
  for (const name of ['pubDate', 'published', 'updated', 'date']) {
    publishedAt = parseDate(htmlToText(xmlTag(block, name)));
    if (publishedAt !== null) break;
  }
  if (!title && !link) return null;
  return { title, link, summary, publishedAt };
}

/**
 * Items of an RSS 2.0 or Atom document, in document order. Items without a closing tag are ignored,
 * so a truncated feed still yields its complete items. A document with no items returns [].
 */
export function parseFeed(xml: string): FeedEntry[] {
  if (typeof xml !== 'string' || !xml.includes('<')) return [];
  const doc = xml.replace(/<!--[\s\S]*?-->/g, '');
  const out: FeedEntry[] = [];
  for (const m of doc.matchAll(ITEM_RE)) {
    const entry = entryOf(m[2]);
    if (entry) out.push(entry);
  }
  return out;
}
