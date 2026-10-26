import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.ts';
import { HttpError, type Req, type Router } from './http.ts';

/**
 * The family's Telegram bot, hosted here so it works even when the user's PC cannot reach api.telegram.org.
 * Webhook mode: Telegram POSTs each message to /v1/telegram/webhook/<secret>, which also wakes a sleeping host.
 * The bot token is stored server side (sqlite), never echoed back, and never written to logs.
 * Hub routes are signed by the hub's Ed25519 key, the same guard as the other /v1/hub/* routes.
 */

export type TelegramFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;

export interface TelegramOptions {
  /** Bot API transport. Defaults to the global fetch. Tests inject a fake Bot API. */
  fetch?: TelegramFetch;
  /** Public https base URL. Defaults to PUBLIC_URL, then RENDER_EXTERNAL_URL. An empty string means "not set". */
  publicUrl?: string;
  now?: () => number;
  /** Log sink. Every line is redacted before it gets here. */
  log?: (msg: string) => void;
}

export const MAX_CHUNK = 4000;
const MAX_SEND_CHARS = 20000;
const MAX_CHATS = 50;
const MAX_INBOX = 100;
const MAX_WEBHOOK_BYTES = 64 * 1024;
const SEND_PER_MIN = 30;
const CODE_TTL_MS = 10 * 60_000;
/** 31 characters with no 0/O or 1/I/L, so a code read off a screen is not ambiguous. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TOKEN_RE = /^\d+:[A-Za-z0-9_-]{30,}$/;
const TOKEN_LIKE_RE = /\d+:[A-Za-z0-9_-]{30,}/g;

const PAIRED = 'Paired with Beacon. You will get family alerts here.';
const BAD_CODE = 'That pairing code is not valid. Ask for a new one in the Beacon Hub.';
const HOW = 'To connect this chat to Beacon, open the Beacon Hub on your computer, choose Telegram, and send the code it shows here as: /start CODE';
const ALREADY = 'This chat is already paired with Beacon.';
const STOPPED = 'Stopped. This chat will no longer get Beacon messages. Send /start with a new code to pair again.';

const bad = (m: string) => new HttpError(400, m);

/** Hide bot tokens (and any extra secrets) from anything that could be logged or returned. */
export function redact(s: string, extra: string[] = []): string {
  let out = s.replace(TOKEN_LIKE_RE, '<bot-token>');
  for (const x of extra) if (x) out = out.split(x).join('<redacted>');
  return out;
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const cleanName = (raw: unknown) =>
  (typeof raw === 'string' ? raw : '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64) || 'Chat';

function chatName(chat: any, from: any): string {
  const parts = [chat.title, [chat.first_name, chat.last_name].filter(Boolean).join(' '), chat.username, from?.first_name];
  return cleanName(parts.find((p) => typeof p === 'string' && p.trim() !== '') ?? 'Unknown');
}

// ---------- HTML-aware chunking ----------

interface Tok {
  tag: boolean;
  s: string;
  name?: string;
  close?: boolean;
  selfClose?: boolean;
}

const VOID = new Set(['br', 'hr', 'img']);

function tokenize(html: string): Tok[] {
  const out: Tok[] = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>]*)?(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m.index > last) out.push({ tag: false, s: html.slice(last, m.index) });
    const name = m[2]!.toLowerCase();
    out.push({ tag: true, s: m[0], name, close: m[1] === '/', selfClose: m[3] === '/' || VOID.has(name) });
    last = m.index + m[0].length;
  }
  if (last < html.length) out.push({ tag: false, s: html.slice(last) });
  return out;
}

/**
 * Split a message into pieces of at most `limit` characters. In HTML mode a piece never breaks a tag,
 * never splits an entity such as &amp;, and every piece closes the tags it opened and reopens the ones
 * still open at its start, so each piece parses on its own.
 */
export function chunkMessage(text: string, html: boolean, limit = MAX_CHUNK): string[] {
  const toks: Tok[] = html ? tokenize(text) : [{ tag: false, s: text }];
  const out: string[] = [];
  let open: { name: string; raw: string }[] = [];
  let base = ''; // the tags reopened at the start of the current piece
  let cur = '';

  const suffixOf = (o: { name: string }[]) => [...o].reverse().map((x) => `</${x.name}>`).join('');
  const hasBody = () => cur.length > base.length;
  const flush = () => {
    out.push(cur + suffixOf(open));
    base = open.map((x) => x.raw).join('');
    cur = base;
  };

  const addText = (s: string) => {
    let rest = s;
    while (rest.length > 0) {
      const room = limit - cur.length - suffixOf(open).length;
      if (rest.length <= room) {
        cur += rest;
        return;
      }
      let cut = room;
      if (cut > 0) {
        let i = cut - 1;
        while (i > 0 && !/\s/.test(rest[i]!)) i--;
        if (i > 0 && i + 1 >= cut / 2) cut = i + 1; // prefer a word boundary when it costs at most half the piece
        const amp = rest.lastIndexOf('&', cut - 1);
        if (amp >= 0 && /^&[#a-zA-Z0-9]*$/.test(rest.slice(amp, cut))) cut = amp; // do not cut inside an entity
      }
      if (cut <= 0) {
        if (hasBody()) {
          flush();
          continue;
        }
        cut = 1; // a single unbreakable character larger than the room; send it anyway
      }
      cur += rest.slice(0, cut);
      rest = rest.slice(cut);
      flush();
    }
  };

  for (const t of toks) {
    if (!t.tag) {
      addText(t.s);
      continue;
    }
    let next = open;
    if (t.close) {
      if (open.length && open[open.length - 1]!.name === t.name) next = open.slice(0, -1);
    } else if (!t.selfClose) {
      next = [...open, { name: t.name!, raw: t.s }];
    }
    if (cur.length + t.s.length + suffixOf(next).length > limit && hasBody()) flush();
    cur += t.s;
    open = next;
  }
  if (hasBody()) out.push(cur + suffixOf(open));
  return out;
}

/** Plain text from a Telegram HTML fragment: tags removed, the basic entities decoded. */
export function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// ---------- Bot API ----------

type ApiResult = { ok: true; result: any } | { ok: false; status: number; description: string };

interface CfgRow {
  hub_id: string;
  token: string;
  secret: string;
  username: string;
}

export class TelegramService {
  private sendLog = new Map<string, number[]>();
  private f: TelegramFetch;
  private now: () => number;
  private log: (m: string) => void;

  constructor(
    private db: Db,
    private opts: TelegramOptions = {},
  ) {
    this.f = opts.fetch ?? ((u, i) => fetch(u, i));
    this.now = opts.now ?? (() => Date.now());
    this.log = opts.log ?? ((m) => console.error(`telegram: ${m}`));
  }

  /** The public https base URL, without a trailing slash, or '' when not configured. */
  publicUrl(): string {
    const raw = this.opts.publicUrl ?? (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '');
    const u = raw.trim().replace(/\/+$/, '');
    return u.startsWith('https://') ? u : '';
  }

  private webhookUrl(secret: string): string {
    return `${this.publicUrl()}/v1/telegram/webhook/${secret}`;
  }

  private async api(token: string, method: string, params?: Record<string, unknown>): Promise<ApiResult> {
    try {
      const res = await this.f(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params ?? {}),
        signal: AbortSignal.timeout(10_000),
      });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown; description?: unknown } | null;
      if (res.ok && j?.ok === true) return { ok: true, result: j.result };
      return { ok: false, status: res.status, description: redact(String(j?.description ?? ''), [token]) };
    } catch {
      // status 0 = could not reach Telegram. The error text is not kept: it may carry the URL.
      return { ok: false, status: 0, description: 'unreachable' };
    }
  }

  private setWebhook(token: string, secret: string) {
    return this.api(token, 'setWebhook', {
      url: this.webhookUrl(secret),
      secret_token: secret,
      allowed_updates: ['message'],
      drop_pending_updates: false,
    });
  }

  private warn(msg: string, extra: string[] = []) {
    this.log(redact(msg, extra));
  }

  private cfg(hub: string): CfgRow | undefined {
    return this.db.prepare('SELECT * FROM telegram_cfg WHERE hub_id = ?').get(hub) as CfgRow | undefined;
  }

  private chatIds(hub: string): number[] {
    return (this.db.prepare('SELECT chat_id FROM telegram_chats WHERE hub_id = ? ORDER BY paired_at, chat_id').all(hub) as { chat_id: number }[]).map((r) => Number(r.chat_id));
  }

  private isPaired(hub: string, chatId: number): boolean {
    return !!this.db.prepare('SELECT 1 AS x FROM telegram_chats WHERE hub_id = ? AND chat_id = ?').get(hub, chatId);
  }

  /** PUT /v1/hub/telegram {token}: validate with getMe, register the webhook, store the config. */
  async connect(hub: string, token: string) {
    if (!TOKEN_RE.test(token)) throw bad('invalid-token');
    if (!this.publicUrl()) throw bad('no-public-url');

    const me = await this.api(token, 'getMe');
    if (!me.ok) {
      const rejected = [400, 401, 403, 404].includes(me.status);
      throw bad(rejected ? 'invalid-token' : 'telegram-unreachable');
    }
    const username = String((me.result as { username?: unknown })?.username ?? '');

    const secret = randomBytes(16).toString('hex');
    const wh = await this.setWebhook(token, secret);
    if (!wh.ok) {
      this.warn(`setWebhook failed: ${wh.description}`, [token, secret]);
      throw bad('telegram-unreachable');
    }

    const prev = this.cfg(hub);
    if (prev && prev.token !== token) {
      // a different bot: the old bot's paired chats mean nothing for this one, and its webhook should stop
      this.db.prepare('DELETE FROM telegram_chats WHERE hub_id = ?').run(hub);
      void this.api(prev.token, 'deleteWebhook', { drop_pending_updates: false });
    }
    this.db.prepare('INSERT OR REPLACE INTO telegram_cfg (hub_id, token, secret, username) VALUES (?,?,?,?)').run(hub, token, secret, username);
    return { ok: true, bot: `@${username || 'bot'}` };
  }

  /** DELETE /v1/hub/telegram: remove the webhook and every row for this hub. */
  async disconnect(hub: string) {
    const cfg = this.cfg(hub);
    if (cfg) {
      const r = await this.api(cfg.token, 'deleteWebhook', { drop_pending_updates: false });
      if (!r.ok) this.warn(`deleteWebhook failed: ${r.description}`, [cfg.token, cfg.secret]);
    }
    for (const table of ['telegram_cfg', 'telegram_chats', 'telegram_codes', 'telegram_inbox']) {
      this.db.prepare(`DELETE FROM ${table} WHERE hub_id = ?`).run(hub);
    }
    return { ok: true };
  }

  /** GET /v1/hub/telegram */
  async status(hub: string) {
    const cfg = this.cfg(hub);
    const chats = (this.db.prepare('SELECT chat_id AS id, name FROM telegram_chats WHERE hub_id = ? ORDER BY paired_at, chat_id').all(hub) as { id: number; name: string }[]).map((c) => ({
      id: Number(c.id),
      name: c.name,
    }));
    if (!cfg) return { connected: false, chats };
    const info = await this.api(cfg.token, 'getWebhookInfo');
    const webhook = info.ok
      ? {
          ok: (info.result as { url?: unknown })?.url === this.webhookUrl(cfg.secret) && this.publicUrl() !== '',
          lastError: ((info.result as { last_error_message?: unknown })?.last_error_message as string | undefined)
            ? redact(String((info.result as { last_error_message: unknown }).last_error_message), [cfg.token, cfg.secret])
            : undefined,
        }
      : { ok: false, lastError: 'telegram-unreachable' };
    return { connected: true, bot: `@${cfg.username || 'bot'}`, chats, webhook };
  }

  /** POST /v1/hub/telegram/code: a one-time pairing code, valid 10 minutes, one active per hub. */
  issueCode(hub: string) {
    if (!this.cfg(hub)) throw new HttpError(409, 'not-connected');
    const t = this.now();
    this.db.prepare('DELETE FROM telegram_codes WHERE hub_id = ? OR expires < ?').run(hub, t);
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      const r = this.db.prepare('INSERT OR IGNORE INTO telegram_codes (code, hub_id, expires) VALUES (?,?,?)').run(code, hub, t + CODE_TTL_MS);
      if (Number(r.changes) === 1) return { code };
    }
    throw new HttpError(500, 'could not issue a code, try again');
  }

  /** PUT /v1/hub/telegram/chats {chats:[{id,name}]}: replace the paired chats (used after the server lost its files). */
  setChats(hub: string, body: { chats?: unknown }) {
    if (!this.cfg(hub)) throw new HttpError(409, 'not-connected');
    if (!Array.isArray(body.chats) || body.chats.length > MAX_CHATS) throw bad(`chats must be an array of at most ${MAX_CHATS}`);
    const rows = body.chats.map((c) => {
      const id = (c as { id?: unknown } | null)?.id;
      if (!Number.isSafeInteger(id)) throw bad('chat id must be an integer');
      return { id: id as number, name: cleanName((c as { name?: unknown }).name) };
    });
    const t = this.now();
    this.db.prepare('DELETE FROM telegram_chats WHERE hub_id = ?').run(hub);
    for (const r of rows) {
      this.db.prepare('INSERT OR REPLACE INTO telegram_chats (hub_id, chat_id, name, paired_at) VALUES (?,?,?,?)').run(hub, r.id, r.name, t);
    }
    return { ok: true };
  }

  private sendAllowed(hub: string): boolean {
    const t = this.now();
    const recent = (this.sendLog.get(hub) ?? []).filter((x) => x > t - 60_000);
    if (recent.length >= SEND_PER_MIN) {
      this.sendLog.set(hub, recent);
      return false;
    }
    recent.push(t);
    this.sendLog.set(hub, recent);
    return true;
  }

  private async sendChunk(token: string, chatId: number, chunk: string, html: boolean): Promise<boolean> {
    const base = { chat_id: chatId, link_preview_options: { is_disabled: true }, disable_web_page_preview: true };
    if (!html) return (await this.api(token, 'sendMessage', { ...base, text: chunk })).ok;
    const r = await this.api(token, 'sendMessage', { ...base, text: chunk, parse_mode: 'HTML' });
    if (r.ok) return true;
    if (/can.t parse entities/i.test(r.description)) {
      // Telegram rejected the markup: send the same words once more as plain text
      return (await this.api(token, 'sendMessage', { ...base, text: stripTags(chunk) })).ok;
    }
    this.warn(`sendMessage failed: ${r.description}`, [token]);
    return false;
  }

  /** POST /v1/hub/telegram/send {text, html?}: to every paired chat. sent and failed count chats. */
  async send(hub: string, body: { text?: unknown; html?: unknown }) {
    const cfg = this.cfg(hub);
    if (!cfg) throw new HttpError(409, 'not-connected');
    if (typeof body.text !== 'string' || body.text.length === 0 || body.text.length > MAX_SEND_CHARS) {
      throw bad(`text must be 1-${MAX_SEND_CHARS} characters`);
    }
    const chats = this.chatIds(hub);
    if (chats.length === 0) throw new HttpError(409, 'no-chats');
    if (!this.sendAllowed(hub)) throw new HttpError(429, `send rate limit: ${SEND_PER_MIN} per minute per hub`);

    const html = body.html === true;
    const chunks = chunkMessage(body.text, html);
    let sent = 0;
    let failed = 0;
    for (const chatId of chats) {
      let ok = true;
      for (const chunk of chunks) {
        if (!(await this.sendChunk(cfg.token, chatId, chunk, html))) {
          ok = false;
          break;
        }
      }
      if (ok) sent++;
      else failed++;
    }
    return { ok: true, sent, failed };
  }

  /** GET /v1/hub/telegram/inbound?since=<id>: text from paired chats, oldest first, newest 100 kept. */
  inbound(hub: string, since: number) {
    const messages = this.db
      .prepare('SELECT id, chat_id AS chatId, name, text, at FROM telegram_inbox WHERE hub_id = ? AND id > ? ORDER BY id ASC LIMIT ?')
      .all(hub, since, MAX_INBOX) as { id: number; chatId: number; name: string; text: string; at: number }[];
    return { messages: messages.map((m) => ({ ...m, id: Number(m.id), chatId: Number(m.chatId), at: Number(m.at) })) };
  }

  /** The stored config whose secret matches the path, compared in constant time over every row. */
  private byPathSecret(path: string): CfgRow | undefined {
    let hit: CfgRow | undefined;
    for (const row of this.db.prepare('SELECT * FROM telegram_cfg').all() as unknown as CfgRow[]) {
      if (same(row.secret, path)) hit = row;
    }
    return hit;
  }

  /**
   * POST /v1/telegram/webhook/:secret. Public, so the secret in the path and the
   * X-Telegram-Bot-Api-Secret-Token header must both match. Anything else is a plain 404.
   */
  async webhook(path: string, header: string, raw: Buffer): Promise<void> {
    const row = this.byPathSecret(path);
    if (!row || !same(row.secret, header)) throw new HttpError(404, 'not found');
    if (raw.length > MAX_WEBHOOK_BYTES) {
      this.warn('webhook body over 64 KB ignored');
      return;
    }
    try {
      await this.handleUpdate(row, raw);
    } catch (e) {
      this.warn(`webhook handling failed: ${e instanceof Error ? e.message : 'error'}`, [row.token, row.secret]);
    }
  }

  private async handleUpdate(row: CfgRow, raw: Buffer): Promise<void> {
    let update: any;
    try {
      update = JSON.parse(raw.toString('utf8'));
    } catch {
      return;
    }
    const msg = update?.message;
    const chat = msg?.chat;
    if (!msg || typeof msg !== 'object' || !chat || !Number.isSafeInteger(chat.id)) return;
    const text = typeof msg.text === 'string' ? msg.text.trim() : '';
    if (!text) return;

    const chatId: number = chat.id;
    const hub = row.hub_id;
    const paired = this.isPaired(hub, chatId);
    const say = (t: string) => this.api(row.token, 'sendMessage', { chat_id: chatId, text: t });
    const cmd = /^\/(start|stop)(?:@\S+)?(?:\s+(\S+))?$/i.exec(text);
    const verb = cmd?.[1]?.toLowerCase();

    if (verb === 'start') {
      const code = cmd![2];
      if (code) {
        if (this.redeem(hub, code.toUpperCase())) {
          this.db
            .prepare('INSERT OR REPLACE INTO telegram_chats (hub_id, chat_id, name, paired_at) VALUES (?,?,?,?)')
            .run(hub, chatId, chatName(chat, msg.from), this.now());
          await say(PAIRED);
        } else {
          await say(BAD_CODE);
        }
      } else {
        await say(paired ? ALREADY : HOW);
      }
      return;
    }
    if (verb === 'stop') {
      if (!paired) return;
      this.db.prepare('DELETE FROM telegram_chats WHERE hub_id = ? AND chat_id = ?').run(hub, chatId);
      await say(STOPPED);
      return;
    }
    if (!paired) return;

    this.db
      .prepare('INSERT INTO telegram_inbox (hub_id, chat_id, name, text, at) VALUES (?,?,?,?,?)')
      .run(hub, chatId, chatName(chat, msg.from), text.slice(0, 4096), this.now());
    this.db
      .prepare('DELETE FROM telegram_inbox WHERE hub_id = ? AND id NOT IN (SELECT id FROM telegram_inbox WHERE hub_id = ? ORDER BY id DESC LIMIT ?)')
      .run(hub, hub, MAX_INBOX);
  }

  /** Spend a pairing code. Only a live code issued by this same hub works, and a code is good once. */
  private redeem(hub: string, code: string): boolean {
    const row = this.db.prepare('SELECT hub_id, expires FROM telegram_codes WHERE code = ?').get(code) as { hub_id: string; expires: number } | undefined;
    if (!row) return false;
    if (Number(row.expires) <= this.now()) {
      this.db.prepare('DELETE FROM telegram_codes WHERE code = ?').run(code);
      return false;
    }
    if (row.hub_id !== hub) return false;
    this.db.prepare('DELETE FROM telegram_codes WHERE code = ?').run(code);
    return true;
  }

  /**
   * On start: point every stored bot's webhook at this host again, so a changed URL or a lost webhook heals.
   * Best effort: an offline Telegram or a missing PUBLIC_URL only logs.
   */
  async reregisterAll(): Promise<number> {
    const rows = this.db.prepare('SELECT * FROM telegram_cfg').all() as unknown as CfgRow[];
    if (rows.length === 0) return 0;
    if (!this.publicUrl()) {
      this.warn('PUBLIC_URL not set: stored Telegram webhooks were not re-registered');
      return 0;
    }
    let n = 0;
    for (const row of rows) {
      const r = await this.setWebhook(row.token, row.secret);
      if (r.ok) n++;
      else this.warn(`webhook re-register failed: ${r.description}`, [row.token, row.secret]);
    }
    return n;
  }
}

/** Mount the /v1/hub/telegram* routes and the public webhook. `signed` and `hubOf` are the app's existing guards. */
export function registerTelegram(r: Router, svc: TelegramService, signed: (req: Req) => string, hubOf: (device: string) => string | undefined) {
  const hub = (req: Req) => {
    const id = hubOf(signed(req));
    if (!id) throw new HttpError(403, 'hub not registered');
    return id;
  };
  r.get('/v1/hub/telegram', async (req) => svc.status(hub(req)));
  r.add('PUT', '/v1/hub/telegram', async (req) => svc.connect(hub(req), String(req.json<{ token?: unknown }>().token ?? '')));
  r.add('DELETE', '/v1/hub/telegram', async (req) => svc.disconnect(hub(req)));
  r.post('/v1/hub/telegram/code', (req) => svc.issueCode(hub(req)));
  r.add('PUT', '/v1/hub/telegram/chats', (req) => svc.setChats(hub(req), req.json()));
  r.post('/v1/hub/telegram/send', async (req) => svc.send(hub(req), req.json()));
  r.get('/v1/hub/telegram/inbound', (req) => {
    const since = Number(req.query.get('since') ?? 0);
    return svc.inbound(hub(req), Number.isFinite(since) && since > 0 ? Math.floor(since) : 0);
  });
  r.post('/v1/telegram/webhook/:secret', async (req) => {
    await svc.webhook(req.params.secret!, String(req.headers['x-telegram-bot-api-secret-token'] ?? ''), req.raw);
    return { ok: true };
  });
}
