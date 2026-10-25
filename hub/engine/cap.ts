import { SEVERITY_RANK } from './types.ts';
import type { Alert, Severity } from './types.ts';

export interface CapOptions {
  /** Who issued the alert, e.g. "beacon-hub". Required by CAP. */
  sender: string;
  /** ms since epoch. Used as the sent time when the alert has no valid time. */
  now: number;
  /** Area description. Defaults to the place in the signal fingerprint, e.g. "heat:delhi" gives "Delhi". */
  place?: string;
  /** Minutes east of UTC for the sent time. Defaults to this machine's offset at `now`. */
  tzOffsetMin?: number;
}

const CAP_SEVERITY: Record<Severity, 'Minor' | 'Moderate' | 'Severe' | 'Extreme'> = {
  info: 'Minor',
  watch: 'Moderate',
  warning: 'Severe',
  severe: 'Extreme',
};
const CAP_URGENCY: Record<Severity, 'Unknown' | 'Future' | 'Expected' | 'Immediate'> = {
  info: 'Unknown',
  watch: 'Future',
  warning: 'Expected',
  severe: 'Immediate',
};
const TAG_ORDER = ['health', 'quake', 'heat', 'flood', 'air'];

/** XML-escapes text and drops characters XML 1.0 does not allow. */
export function xmlEscape(text: string): string {
  return String(text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isoWithOffset(ms: number, offMin: number): string {
  const local = new Date(ms + offMin * 60_000).toISOString().slice(0, 19);
  const abs = Math.abs(offMin);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${local}${offMin >= 0 ? '+' : '-'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Category by the most important hazard tag in the alert's signals. */
function categoryOf(alert: Alert): 'Met' | 'Geo' | 'Health' {
  const tags = (alert.signals ?? [])
    .slice()
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    .flatMap((s) => s.tags ?? []);
  const top = TAG_ORDER.find((t) => tags.includes(t));
  if (top === 'health') return 'Health';
  if (top === 'quake') return 'Geo';
  return 'Met';
}

function areaOf(alert: Alert, place?: string): string {
  if (place?.trim()) return place.trim();
  const fp = alert.signals?.[0]?.fingerprint ?? '';
  const seg = fp.split(':')[1]?.trim() ?? '';
  return seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : 'Your area';
}

/**
 * Pure: builds an OASIS CAP 1.2 alert (XML string) for one hub alert. Status Actual, msgType Alert, scope Public.
 * Severity maps info, watch, warning, severe to Minor, Moderate, Severe, Extreme.
 */
export function toCap(alert: Alert, opts: CapOptions): string {
  const sentMs = Number.isFinite(alert.at) ? alert.at : opts.now;
  const offset = opts.tzOffsetMin ?? -new Date(sentMs).getTimezoneOffset();
  const e = xmlEscape;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">',
    `  <identifier>${e(alert.id)}</identifier>`,
    `  <sender>${e(opts.sender)}</sender>`,
    `  <sent>${isoWithOffset(sentMs, offset)}</sent>`,
    '  <status>Actual</status>',
    '  <msgType>Alert</msgType>',
    '  <scope>Public</scope>',
    '  <info>',
    `    <category>${categoryOf(alert)}</category>`,
    `    <event>${e(alert.title)}</event>`,
    `    <urgency>${CAP_URGENCY[alert.severity] ?? 'Unknown'}</urgency>`,
    `    <severity>${CAP_SEVERITY[alert.severity] ?? 'Minor'}</severity>`,
    '    <certainty>Likely</certainty>',
    `    <headline>${e(alert.title)}</headline>`,
    `    <description>${e(alert.body)}</description>`,
    '    <area>',
    `      <areaDesc>${e(areaOf(alert, opts.place))}</areaDesc>`,
    '    </area>',
    '  </info>',
    '</alert>',
    '',
  ].join('\n');
}
