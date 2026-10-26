import { randomBytes } from 'node:crypto';
import type { Db } from './db.ts';
import { HttpError, type Router, type Req } from './http.ts';
import { sha256Hex } from './keys.ts';
import { BLOCKED_WORDS } from './chatwords.ts';

/**
 * Global internet chat. Public and anonymous, so the protections live here:
 * strict room names, cleaned and redacted text, a word filter, duplicate and rate limits,
 * reports that hide a message automatically, and moderator bans.
 * Devices are shown only as a short hash of their id, never the key.
 */

export const MAX_TEXT = 300;
export const MAX_NICK = 20;
export const MAX_ROOMS = 50;
export const KEEP_MS = 48 * 3600_000;
export const KEEP_PER_ROOM = 500;
export const REPORTS_TO_HIDE = 3;
const MAX_BODY = 4096;
const DEVICE_PER_MIN = 6;
const DEVICE_PER_HOUR = 60;
const IP_POST_PER_MIN = 30;
const IP_GET_PER_MIN = 60;
const DEDUPE_MS = 60_000;

export const RULES = {
  en: 'Be kind. Never share your address, phone number or location. For emergencies call 112: this chat cannot send help.',
  hi: 'दयालु रहें। अपना पता, फ़ोन नंबर या लोकेशन कभी साझा न करें। आपातकाल में 112 पर कॉल करें: यह चैट मदद नहीं भेज सकती।',
};

const ROOM_RE = /^(global|region-[0-9bcdefghjkmnpqrstuvwxyz]{2,3})$/;
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };
const BLOCKED = new Set(BLOCKED_WORDS.map((w) => w.normalize('NFC')));

export interface ChatMessage {
  id: string;
  room: string;
  ts: number;
  nick: string;
  text: string;
  device: string;
  flags: string[];
}

/** The 8-hex tag other people see for a device. A hash, never the key. */
export const deviceTag = (device: string) => sha256Hex(device).slice(0, 8);

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const URL_RE = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|in|org|net|io|me|co|app|ly|gg|xyz|info|link|ru|cc|tv)\b\S*/gi;
const PHONE = /\+?\d[\d\s\-().]{7,}\d/g;

/** Remove control characters, collapse whitespace. */
export function tidy(s: string): string {
  return s.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
}

/** Replace emails, URLs and phone numbers (10 or more digits) with [removed]. */
export function redact(s: string): { text: string; changed: boolean } {
  let changed = false;
  const hit = () => {
    changed = true;
    return '[removed]';
  };
  let out = s.replace(EMAIL, hit).replace(URL_RE, hit);
  out = out.replace(PHONE, (m) => (m.replace(/\D/g, '').length >= 10 ? hit() : m));
  return { text: out, changed };
}

/** Whole-word, case-insensitive blocklist with simple leetspeak normalisation. */
export function filterWords(s: string): { text: string; filtered: boolean } {
  let filtered = false;
  const text = s.replace(/[\p{L}\p{M}\p{N}@$]+/gu, (tok) => {
    let norm = tok.toLowerCase().normalize('NFC');
    if (/\p{L}/u.test(norm)) norm = norm.replace(/[013457@$]/g, (c) => LEET[c]!);
    if (BLOCKED.has(norm) || BLOCKED.has(norm.replace(/(.)\1+/g, '$1'))) {
      filtered = true;
      return '***';
    }
    return tok;
  });
  return { text, filtered };
}

export function cleanNick(raw: unknown): string {
  let n = tidy(typeof raw === 'string' ? raw : '').slice(0, MAX_NICK);
  n = filterWords(redact(n).text).text.trim().slice(0, MAX_NICK);
  return n || 'Guest';
}

/** Full text pipeline. Returns null when nothing is left. */
export function cleanText(raw: unknown): { text: string; flags: string[] } | null {
  if (typeof raw !== 'string') return null;
  let t = tidy(raw).slice(0, MAX_TEXT);
  const flags: string[] = [];
  const r = redact(t);
  t = r.text;
  if (r.changed) flags.push('redacted');
  const f = filterWords(t);
  t = f.text;
  if (f.filtered) flags.push('filtered');
  t = t.trim().slice(0, MAX_TEXT);
  return t ? { text: t, flags } : null;
}

const bad = (m: string) => new HttpError(400, m);

export function checkRoom(room: string): string {
  if (!ROOM_RE.test(room)) throw bad('unknown room');
  return room;
}

/** Sliding-window counter keyed by string. */
class Window {
  private hits = new Map<string, number[]>();
  constructor(private ms: number) {}
  count(key: string, now: number) {
    const a = (this.hits.get(key) ?? []).filter((t) => t > now - this.ms);
    if (a.length) this.hits.set(key, a);
    else this.hits.delete(key);
    return a.length;
  }
  add(key: string, now: number) {
    const a = (this.hits.get(key) ?? []).filter((t) => t > now - this.ms);
    a.push(now);
    this.hits.set(key, a);
    if (this.hits.size > 20_000) for (const [k, v] of this.hits) if (!v.some((t) => t > now - this.ms)) this.hits.delete(k);
  }
}

interface Row {
  id: string;
  room: string;
  ts: number;
  nick: string;
  text: string;
  device: string;
  flags: string;
}
const view = (r: Row): ChatMessage => ({ id: r.id, room: r.room, ts: r.ts, nick: r.nick, text: r.text, device: r.device, flags: r.flags ? r.flags.split(',') : [] });

export class ChatService {
  private devMin = new Window(60_000);
  private devHour = new Window(3600_000);
  private ipPost = new Window(60_000);
  private ipGet = new Window(60_000);
  private lastText = new Map<string, { text: string; ts: number }>();

  constructor(
    private db: Db,
    private now: () => number = () => Date.now(),
  ) {}

  private prune(room: string, t: number) {
    this.db.prepare('DELETE FROM chat_msgs WHERE ts < ?').run(t - KEEP_MS);
    this.db.prepare('DELETE FROM chat_msgs WHERE room = ? AND id NOT IN (SELECT id FROM chat_msgs WHERE room = ? ORDER BY ts DESC LIMIT ?)').run(room, room, KEEP_PER_ROOM);
    this.db.prepare('DELETE FROM chat_reports WHERE msg_id NOT IN (SELECT id FROM chat_msgs)').run();
  }

  post(device: string, ip: string, room: string, body: { text?: unknown; nick?: unknown }, rawLen: number) {
    if (rawLen > MAX_BODY) throw new HttpError(413, 'message too large');
    checkRoom(room);
    const tag = deviceTag(device);
    if (this.db.prepare('SELECT 1 AS x FROM chat_bans WHERE device = ?').get(tag)) throw new HttpError(403, 'you are blocked from this chat');
    const t = this.now();
    if (this.ipPost.count(ip, t) >= IP_POST_PER_MIN) throw new HttpError(429, 'Too many messages from this network. Please wait a minute.');
    if (this.devMin.count(device, t) >= DEVICE_PER_MIN) throw new HttpError(429, `You are sending too fast. Limit is ${DEVICE_PER_MIN} messages a minute.`);
    if (this.devHour.count(device, t) >= DEVICE_PER_HOUR) throw new HttpError(429, `Hourly limit reached (${DEVICE_PER_HOUR} messages). Please try later.`);

    const cleaned = cleanText(body?.text);
    if (!cleaned) throw bad('message is empty');
    const nick = cleanNick(body?.nick);

    const known = this.db.prepare('SELECT 1 AS x FROM chat_msgs WHERE room = ? LIMIT 1').get(room);
    if (!known) {
      const n = (this.db.prepare('SELECT COUNT(DISTINCT room) AS n FROM chat_msgs').get() as { n: number }).n;
      if (n >= MAX_ROOMS) throw bad('too many rooms right now');
    }

    // an identical message from the same device inside a minute is dropped quietly
    const last = this.lastText.get(device);
    if (last && last.text === cleaned.text && t - last.ts < DEDUPE_MS) return { ok: true, dropped: true, reason: 'duplicate' };
    this.lastText.set(device, { text: cleaned.text, ts: t });
    if (this.lastText.size > 20_000) for (const [k, v] of this.lastText) if (t - v.ts >= DEDUPE_MS) this.lastText.delete(k);

    this.devMin.add(device, t);
    this.devHour.add(device, t);
    this.ipPost.add(ip, t);

    const maxTs = (this.db.prepare('SELECT MAX(ts) AS m FROM chat_msgs WHERE room = ?').get(room) as { m: number | null }).m ?? 0;
    const ts = Math.max(t, maxTs + 1); // strictly increasing per room so the since cursor never skips a message
    const msg: ChatMessage = { id: randomBytes(8).toString('hex'), room, ts, nick, text: cleaned.text, device: tag, flags: cleaned.flags };
    this.db.prepare('INSERT INTO chat_msgs (id, room, ts, nick, text, device, flags, hidden) VALUES (?,?,?,?,?,?,?,0)').run(msg.id, room, ts, nick, msg.text, tag, msg.flags.join(','));
    this.prune(room, t);
    return { ok: true, message: msg };
  }

  list(ip: string, room: string, since: number, limit: number) {
    checkRoom(room);
    const t = this.now();
    if (this.ipGet.count(ip, t) >= IP_GET_PER_MIN) throw new HttpError(429, 'Too many requests. Please wait a moment.');
    this.ipGet.add(ip, t);
    const lim = Math.min(Math.max(Math.floor(limit) || 50, 1), 60);
    const cutoff = t - KEEP_MS;
    const rows = (
      since > 0
        ? this.db.prepare('SELECT id, room, ts, nick, text, device, flags FROM chat_msgs WHERE room = ? AND hidden = 0 AND ts > ? AND ts > ? ORDER BY ts ASC LIMIT ?').all(room, since, cutoff, lim)
        : this.db.prepare('SELECT * FROM (SELECT id, room, ts, nick, text, device, flags FROM chat_msgs WHERE room = ? AND hidden = 0 AND ts > ? ORDER BY ts DESC LIMIT ?) ORDER BY ts ASC').all(room, cutoff, lim)
    ) as unknown as Row[];
    return { messages: rows.map(view), now: t };
  }

  info(room: string) {
    checkRoom(room);
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM chat_msgs WHERE room = ? AND hidden = 0').get(room) as { n: number }).n;
    return { room, rules: RULES, limits: { perMinute: DEVICE_PER_MIN, perHour: DEVICE_PER_HOUR, maxChars: MAX_TEXT, keepHours: KEEP_MS / 3600_000 }, count: n };
  }

  report(device: string, b: { room?: unknown; id?: unknown; reason?: unknown }) {
    const room = checkRoom(String(b.room ?? ''));
    const id = String(b.id ?? '');
    const m = this.db.prepare('SELECT device FROM chat_msgs WHERE id = ? AND room = ?').get(id, room) as { device: string } | undefined;
    if (!m) throw new HttpError(404, 'message not found');
    const me = deviceTag(device);
    if (m.device === me) throw bad('you cannot report your own message');
    this.db.prepare('INSERT OR IGNORE INTO chat_reports (msg_id, reporter, reason, ts) VALUES (?,?,?,?)').run(id, me, tidy(String(b.reason ?? '')).slice(0, 100), this.now());
    const n = (this.db.prepare('SELECT COUNT(DISTINCT reporter) AS n FROM chat_reports WHERE msg_id = ?').get(id) as { n: number }).n;
    if (n >= REPORTS_TO_HIDE) this.db.prepare('UPDATE chat_msgs SET hidden = 1 WHERE id = ? AND hidden = 0').run(id);
    return { ok: true, reports: n };
  }

  reported() {
    const rows = this.db
      .prepare(
        `SELECT m.id, m.room, m.ts, m.nick, m.text, m.device, m.flags, m.hidden, COUNT(DISTINCT r.reporter) AS reports
         FROM chat_msgs m JOIN chat_reports r ON r.msg_id = m.id GROUP BY m.id ORDER BY reports DESC, m.ts DESC LIMIT 200`,
      )
      .all() as unknown as (Row & { hidden: number; reports: number })[];
    return { messages: rows.map((r) => ({ ...view(r), hidden: r.hidden !== 0, reports: r.reports })) };
  }

  hide(b: { room?: unknown; id?: unknown }) {
    const r = this.db.prepare('UPDATE chat_msgs SET hidden = 1 WHERE id = ? AND room = ?').run(String(b.id ?? ''), String(b.room ?? ''));
    if (Number(r.changes) === 0) throw new HttpError(404, 'message not found');
    return { ok: true };
  }

  ban(b: { device?: unknown }) {
    const d = String(b.device ?? '');
    if (!/^[0-9a-f]{8}$/.test(d)) throw bad('device must be the 8-hex tag');
    this.db.prepare('INSERT OR IGNORE INTO chat_bans (device, ts) VALUES (?,?)').run(d, this.now());
    this.db.prepare('UPDATE chat_msgs SET hidden = 2 WHERE device = ? AND hidden = 0').run(d);
    return { ok: true };
  }

  unban(b: { device?: unknown }) {
    const d = String(b.device ?? '');
    if (!/^[0-9a-f]{8}$/.test(d)) throw bad('device must be the 8-hex tag');
    this.db.prepare('DELETE FROM chat_bans WHERE device = ?').run(d);
    this.db.prepare('UPDATE chat_msgs SET hidden = 0 WHERE device = ? AND hidden = 2').run(d);
    return { ok: true };
  }
}

const ipOf = (req: Req) => String(req.headers['x-forwarded-for'] ?? '').split(',')[0]!.trim() || 'direct';

/** Mount the chat routes. `signed` and `mod` are the app's existing auth guards. */
export function registerChat(r: Router, db: Db, now: () => number, signed: (req: Req) => string, mod: (req: Req) => void) {
  const chat = new ChatService(db, now);
  // fixed paths first: the router takes the first match
  r.post('/v1/chat/report', (req) => chat.report(signed(req), req.json()));
  r.post('/v1/chat/:room', (req) => {
    const device = signed(req);
    return chat.post(device, ipOf(req), req.params.room!, req.json(), req.raw.length);
  });
  r.get('/v1/chat/:room/info', (req) => chat.info(req.params.room!));
  r.get('/v1/chat/:room', (req) => {
    const since = Number(req.query.get('since') ?? 0);
    return {
      status: 200,
      body: chat.list(ipOf(req), req.params.room!, Number.isFinite(since) ? since : 0, Number(req.query.get('limit') ?? 50)),
      headers: { 'cache-control': 'no-store' },
    };
  });
  r.get('/v1/mod/chat/reported', (req) => (mod(req), chat.reported()));
  r.post('/v1/mod/chat/hide', (req) => (mod(req), chat.hide(req.json())));
  r.post('/v1/mod/chat/ban', (req) => (mod(req), chat.ban(req.json())));
  r.post('/v1/mod/chat/unban', (req) => (mod(req), chat.unban(req.json())));
}
