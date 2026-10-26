// Pure notification and notice helpers: what a notification says, which channel it uses, how a stored
// item reads on the detail page. No react-native or expo imports, so it runs under the test runner.
// Scheduling lives in notificationRouting.ts.

import type { Lang, T } from '../kb/types';
import type { AlertItem } from './alerts';
import type { FeedItem, FeedKind, Severity } from './wire';

export const NOTICE_TYPE = 'notice';
export const TITLE_MAX = 38;
export const BODY_MAX = 90;

export const CHANNEL = {
  severe: 'beacon-severe',
  warning: 'beacon-warning',
  info: 'beacon-info',
} as const;
export type ChannelId = (typeof CHANNEL)[keyof typeof CHANNEL];

export type NoticeOrigin = 'hub' | 'alert';

export type NoticeSource = { kind: 'feed'; item: FeedItem } | { kind: 'alert'; alert: AlertItem };

export interface NoticeData {
  type: typeof NOTICE_TYPE;
  id: string;
  origin: NoticeOrigin;
}

export interface NotificationContent {
  title: string;
  body: string;
  data: NoticeData;
  channelId: ChannelId;
  sound: 'default' | false;
}

/** Severity to Android channel. Watch and info share the quiet channel. */
export function channelFor(severity: Severity): ChannelId {
  return severity === 'severe' ? CHANNEL.severe : severity === 'warning' ? CHANNEL.warning : CHANNEL.info;
}

/** Cuts text to at most `max` characters, ending with an ellipsis when it had to cut. */
export function clip(text: string, max: number): string {
  const s = text.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** The first sentence of a text (Latin or Devanagari full stop), clipped to `max`. */
export function firstSentence(text: string, max: number): string {
  const s = text.replace(/\s+/g, ' ').trim();
  const m = s.match(/^.*?[.!?।](?=\s|$)/);
  return clip(m ? m[0] : s, max);
}

const pair = (en: string, hi: string, lang: Lang) => (lang === 'hi' ? hi : en);

/** First finite number among the keys, or null. */
function num(data: Record<string, number | string> | undefined, keys: string[]): number | null {
  if (!data) return null;
  for (const k of keys) {
    const v = data[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * A short, numeric headline for a feed item when its data says something specific.
 * Returns null when nothing specific applies; the caller then uses the item's own title.
 */
function specificTitle(item: FeedItem, lang: Lang): string | null {
  const temp = num(item.data, ['temp_c', 'feels_like_c']);
  if (temp !== null && temp >= 35) return pair(`Heat warning: ${Math.round(temp)} C`, `गर्मी की चेतावनी: ${Math.round(temp)} C`, lang);
  if (temp !== null && temp <= 2) return pair(`Cold alert: ${Math.round(temp)} C`, `ठंड की चेतावनी: ${Math.round(temp)} C`, lang);
  const gust = num(item.data, ['gust_kmh']);
  const wind = num(item.data, ['wind_kmh']);
  if (gust !== null || wind !== null) {
    const v = Math.round((gust ?? wind)!);
    return gust !== null
      ? pair(`Wind alert: gusts ${v} km/h`, `तेज़ हवा: झोंके ${v} km/h`, lang)
      : pair(`Wind alert: ${v} km/h`, `तेज़ हवा: ${v} km/h`, lang);
  }
  const rain = num(item.data, ['rain_mm_3h', 'rain_mm']);
  if (rain !== null) return pair(`Flood risk: ${Math.round(rain)} mm rain`, `बाढ़ का ख़तरा: ${Math.round(rain)} mm बारिश`, lang);
  const aqi = num(item.data, ['aqi']);
  if (aqi !== null) return pair(`Air quality: AQI ${Math.round(aqi)}`, `हवा की गुणवत्ता: AQI ${Math.round(aqi)}`, lang);
  const mag = num(item.data, ['mag', 'magnitude']);
  if (mag !== null) return pair(`Earthquake: M${mag.toFixed(1)}`, `भूकंप: M${mag.toFixed(1)}`, lang);
  const sos = item.tags?.includes('sos') ? item.data?.name : undefined;
  if (typeof sos === 'string' && sos) return pair(`SOS from ${sos}`, `${sos} से SOS`, lang);
  return null;
}

/** The one thing worth reading on the lock screen: the first sentence of the body, or a fallback. */
function bodyFor(text: string, lang: Lang): string {
  const first = firstSentence(text, BODY_MAX);
  return first || pair('Tap to see what to do.', 'करने योग्य बातें देखने के लिए दबाएँ।', lang);
}

/**
 * Title, body, data and channel for a local notification about a hub feed item or an official alert.
 * The id in `data` is the item or alert id, so the tap can open /notice/<id> and a repeat is recognised.
 */
export function buildNotification(source: NoticeSource, lang: Lang): NotificationContent {
  if (source.kind === 'alert') {
    const a = source.alert;
    const title = clip(a.title, TITLE_MAX);
    const body = a.body ? bodyFor(a.body, lang) : pair('Open Beacon for what to do.', 'क्या करें, यह Beacon में देखें।', lang);
    return finish(title, body, a.id, 'alert', a.severity);
  }
  const it = source.item;
  const origin: NoticeOrigin = 'hub';
  let title: string;
  if (it.tags?.includes('digest')) {
    title = clip(pair(`Update: ${it.title}`, `अपडेट: ${it.title}`, lang), TITLE_MAX);
  } else {
    title = clip(specificTitle(it, lang) ?? it.title, TITLE_MAX);
  }
  const body = it.body ? bodyFor(it.body, lang) : pair('Open Beacon for details.', 'विवरण के लिए Beacon खोलें।', lang);
  return finish(title, body, it.id, origin, it.severity);
}

function finish(title: string, body: string, id: string, origin: NoticeOrigin, severity: Severity): NotificationContent {
  const channelId = channelFor(severity);
  return {
    title: title || 'Beacon',
    body,
    data: { type: NOTICE_TYPE, id, origin },
    channelId,
    sound: channelId === CHANNEL.info ? false : 'default',
  };
}

/** Reads a notification's data payload. Null for anything that is not one of ours. */
export function parseNoticeData(data: unknown): { id: string; origin: NoticeOrigin } | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.type !== NOTICE_TYPE || typeof d.id !== 'string' || !d.id) return null;
  if (d.origin !== 'hub' && d.origin !== 'alert') return null;
  return { id: d.id, origin: d.origin };
}

// ---- notices list and detail ----

export type NoticeKind = FeedKind | 'alert';

/** One row of the notices list, from either store. */
export interface NoticeRow {
  id: string;
  origin: NoticeOrigin;
  kind: NoticeKind;
  title: string;
  body: string;
  severity: Severity;
  at: number;
}

export function rowFromItem(it: FeedItem): NoticeRow {
  return { id: it.id, origin: 'hub', kind: it.kind, title: it.title, body: it.body, severity: it.severity, at: it.at };
}

export function rowFromAlert(a: AlertItem): NoticeRow {
  return { id: a.id, origin: 'alert', kind: 'alert', title: a.title, body: a.body, severity: a.severity, at: a.seenAt };
}

/** Feed items and alerts together, newest first, at most `limit`. Duplicate ids keep the first copy. */
export function mergeNotices(items: FeedItem[], alerts: AlertItem[], limit = 50): NoticeRow[] {
  const seen = new Set<string>();
  const out: NoticeRow[] = [];
  for (const r of [...items.map(rowFromItem), ...alerts.map(rowFromAlert)].sort((a, b) => b.at - a.at)) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

export const SEVERITY_LABEL: Record<Severity, T> = {
  info: ['Info', 'जानकारी'],
  watch: ['Watch', 'निगरानी'],
  warning: ['Warning', 'चेतावनी'],
  severe: ['Severe', 'अति गंभीर'],
};

export const KIND_LABEL: Record<NoticeKind, T> = {
  news: ['News', 'समाचार'],
  weather: ['Weather', 'मौसम'],
  wind: ['Wind', 'हवा'],
  quake: ['Earthquake', 'भूकंप'],
  flood: ['Flood', 'बाढ़'],
  alert: ['Alert', 'चेतावनी'],
  health: ['Health', 'स्वास्थ्य'],
  supply: ['Supplies', 'सामान'],
  advisory: ['Advisory', 'सलाह'],
  chat: ['Family', 'परिवार'],
  custom: ['Update', 'अपडेट'],
};

/** Field labels for the numbers table. Units are shown next to the value. */
const FIELDS: Record<string, { label: T; unit?: string }> = {
  temp_c: { label: ['Temperature', 'तापमान'], unit: '°C' },
  feels_like_c: { label: ['Feels like', 'महसूस'], unit: '°C' },
  humidity_pct: { label: ['Humidity', 'नमी'], unit: '%' },
  pressure: { label: ['Pressure', 'दबाव'], unit: 'hPa' },
  wind_kmh: { label: ['Wind', 'हवा'], unit: 'km/h' },
  gust_kmh: { label: ['Gusts', 'झोंके'], unit: 'km/h' },
  rain_mm: { label: ['Rain', 'बारिश'], unit: 'mm' },
  rain_mm_3h: { label: ['Rain, 3 h', 'बारिश, 3 घंटे'], unit: 'mm' },
  aqi: { label: ['AQI', 'AQI'] },
  pm25: { label: ['PM2.5', 'PM2.5'], unit: 'µg/m³' },
  mag: { label: ['Magnitude', 'तीव्रता'], unit: 'M' },
  magnitude: { label: ['Magnitude', 'तीव्रता'], unit: 'M' },
  depth_km: { label: ['Depth', 'गहराई'], unit: 'km' },
};

export interface DataRow {
  label: string;
  value: string;
}

/** Turns an item's `data` into labelled rows: known keys get a proper label and unit, others are title-cased. */
export function dataRows(data: Record<string, number | string> | undefined, lang: Lang): DataRow[] {
  if (!data) return [];
  return Object.entries(data).map(([key, raw]) => {
    const known = FIELDS[key];
    const value = typeof raw === 'number' ? (Number.isInteger(raw) ? String(raw) : raw.toFixed(1)) : String(raw);
    if (known) return { label: known.label[lang === 'hi' ? 1 : 0], value: known.unit ? `${value} ${known.unit}` : value };
    const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return { label, value };
  });
}

/** "Today 14:05" for today, otherwise "12 Oct 14:05". */
export function whenLabel(at: number, now: number, lang: Lang): string {
  const d = new Date(at);
  const n = new Date(now);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  if (sameDay) return `${pair('Today', 'आज', lang)} ${hh}:${mm}`;
  const months = lang === 'hi' ? ['जन', 'फ़र', 'मार्च', 'अप्रै', 'मई', 'जून', 'जुला', 'अग', 'सित', 'अक्तू', 'नव', 'दिस'] : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${hh}:${mm}`;
}
