// Reads OASIS CAP 1.2 alerts (the format NDMA SACHET publishes) into plain records, and turns them into FeedItems.
// Tolerant of namespace prefixes (cap:alert) and of missing optional fields.

import { itemId, parseDate, plainText, trimWords, xmlTag } from './rss.ts';
import type { Agent, FeedItem, Severity } from './types.ts';

export interface CapArea {
  areaDesc: string;
  polygon?: string;
  circle?: string;
}

/** One <info> block, with the alert-level identifier, sender, status and msgType copied onto it. */
export interface CapInfo {
  identifier: string;
  sender: string;
  sent: number | null;
  status: string;
  msgType: string;
  scope: string;
  language: string;
  category: string;
  event: string;
  urgency: string;
  severity: string;
  certainty: string;
  headline: string;
  description: string;
  instruction: string;
  expires: number | null;
  areas: CapArea[];
}

const BODY_WORDS = 40;

function blocksOf(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}(?=[\\s>])[^>]*(?<!/)>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>`, 'gi');
  return [...xml.matchAll(re)].map((m) => m[1]);
}

function infoOf(alertHead: string, body: string): CapInfo {
  const text = (name: string) => plainText(xmlTag(body, name));
  const areas: CapArea[] = [];
  for (const area of blocksOf(body, 'area')) {
    const areaDesc = plainText(xmlTag(area, 'areaDesc'));
    const polygon = plainText(xmlTag(area, 'polygon')) || undefined;
    const circle = plainText(xmlTag(area, 'circle')) || undefined;
    if (areaDesc || polygon || circle) areas.push({ areaDesc, polygon, circle });
  }
  const head = (name: string) => plainText(xmlTag(alertHead, name));
  return {
    identifier: head('identifier'),
    sender: head('sender'),
    sent: parseDate(head('sent')),
    status: head('status'),
    msgType: head('msgType'),
    scope: head('scope'),
    language: text('language'),
    category: text('category'),
    event: text('event'),
    urgency: text('urgency'),
    severity: text('severity'),
    certainty: text('certainty'),
    headline: text('headline'),
    description: text('description'),
    instruction: text('instruction'),
    expires: parseDate(text('expires')),
    areas,
  };
}

/**
 * Every <info> block of every <alert> in the document. A document with no <alert> wrapper but with
 * <info> blocks is read as one alert. Anything else returns [].
 */
export function parseCapAlert(xml: string): CapInfo[] {
  if (typeof xml !== 'string' || !xml.includes('<')) return [];
  const doc = xml.replace(/<!--[\s\S]*?-->/g, '');
  const alerts = blocksOf(doc, 'alert');
  const bodies = alerts.length ? alerts : [doc];
  const out: CapInfo[] = [];
  for (const alert of bodies) {
    const infos = blocksOf(alert, 'info');
    const head = alert.replace(/<(?:[\w.-]+:)?info(?=[\s>])[^>]*(?<!\/)>[\s\S]*?<\/(?:[\w.-]+:)?info\s*>/gi, '');
    for (const info of infos) out.push(infoOf(head, info));
  }
  return out;
}

/**
 * Severity for an alert from its CAP severity: Extreme and Severe become severe, Moderate becomes
 * warning, Minor becomes watch, anything else info.
 */
export function capSeverity(severity: string): Severity {
  const s = severity.trim().toLowerCase();
  if (s === 'extreme' || s === 'severe') return 'severe';
  if (s === 'moderate') return 'warning';
  if (s === 'minor') return 'watch';
  return 'info';
}

/** Headline, then the first 40 words of the description (or the instruction when there is none). */
function capBody(info: CapInfo): string {
  const lead = info.description || info.instruction;
  if (!lead) return info.headline;
  const words = trimWords(lead, BODY_WORDS);
  if (!info.headline) return words;
  return `${info.headline.replace(/[.!?]\s*$/, '')}. ${words}`;
}

/** One CAP info block as a FeedItem for this agent. `now` is used when the alert has no sent time. */
export function capToFeedItem(info: CapInfo, agent: Agent, now: number = Date.now()): FeedItem {
  const title = info.headline || info.event || 'Official alert';
  const kind = 'alert';
  const tags = [info.category, info.event].filter(Boolean).map((t) => t.toLowerCase());
  const place = info.areas.find((a) => a.areaDesc)?.areaDesc || undefined;
  return {
    id: itemId(kind, title, undefined),
    agentId: agent.id,
    agentName: agent.name,
    kind,
    title,
    body: capBody(info),
    severity: capSeverity(info.severity),
    at: info.sent ?? now,
    tags,
    place,
  };
}
