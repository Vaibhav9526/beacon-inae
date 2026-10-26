import type { Alert } from './types.ts';
import type { Sender } from './outbox.ts';
import { splitHtml, TELEGRAM_MAX } from './digest.ts';
import { MSG_REJECTED, splitPlain } from './telegram.ts';

// Telegram run by the relay server (webhook mode). The bot token is uploaded to the relay over the hub's signed
// channel; the hub keeps the token and the paired chats and re-uploads them whenever the relay lost them.
// The Hub is the source of truth. Outbox approval and the audit log stay in the Hub: this only changes where a send goes.

/** The signed relay call the hub already makes for /v1/hub/* (BeaconLink.request). Test code passes a fake. */
export interface RelayHttp {
  request(method: string, path: string, payload?: unknown): Promise<{ status: number; json: any }>;
}

export type TelegramMode = 'relay' | 'direct';

/** What Connections shows for the relay path. Never contains the token. */
export type RelayTelegramStatus =
  | { state: 'none' }
  | { state: 'connected'; bot: string }
  | { state: 'waiting'; message: string }
  | { state: 'rejected'; message: string }
  | { state: 'unreachable'; message: string }
  | { state: 'no-telegram'; message: string };

export interface TelegramInbound {
  id: string;
  chatId: number;
  name: string;
  text: string;
  at: number;
}

export interface RelayTelegramDeps {
  relay: RelayHttp;
  getToken(): string | undefined;
  setToken(token: string | undefined): void;
  getChats(): number[];
  setChats(ids: number[]): void;
  getCursor(): string | undefined;
  setCursor(cursor: string): void;
  /** a text message from a chat that is paired with this hub */
  onInbound(msg: TelegramInbound): void;
  onChange?(status: RelayTelegramStatus): void;
  log?(line: string): void;
  now?(): number;
}

/** User-facing sentences. None of them contain the token or the relay's raw error codes. */
export const RELAY_MSG = {
  waiting: 'Waiting for the relay. The token is kept on this computer and sent when the relay answers.',
  unreachable: 'The relay could not reach Telegram. Will retry.',
  noPublicUrl: 'The relay has no public address yet, so Telegram cannot reach it. Check the relay server settings.',
  notSetUp: 'The relay does not have Telegram set up yet. Press Retry now, or save the bot token again.',
  noChats: 'No Telegram chat is paired yet. Get a pairing code and send it to the bot.',
  busy: 'The relay is sending too many Telegram messages. Try again in a minute.',
  failed: 'The relay could not deliver the message to Telegram.',
  cannotReach: 'The relay could not be reached. Try again in a moment.',
  otherReply: 'The relay did not answer as expected. Will retry.',
  noCode: 'The relay did not give a pairing code. Try again in a moment.',
} as const;

const SYNC_EVERY_MS = 60_000;
const PAIRING_SYNC_EVERY_MS = 8_000;
const PAIRING_WINDOW_MS = 10 * 60_000;

/** The relay did not answer (no network, a sleeping server, a 5xx). Not a verdict on the token or the chats. */
class RelayDown extends Error {
  constructor() {
    super('relay did not answer');
  }
}

interface RelayInfo {
  connected: boolean;
  bot: string;
  chats: Array<{ id: number; name: string }>;
}

const botName = (v: unknown) => String(v ?? '').replace(/^@/, '');

function sendError(status: number, error?: string): string {
  if (status === 409 && error === 'no-chats') return RELAY_MSG.noChats;
  if (status === 409) return RELAY_MSG.notSetUp;
  if (status === 429) return RELAY_MSG.busy;
  if (status === 400 && error === 'telegram-unreachable') return RELAY_MSG.unreachable;
  return RELAY_MSG.failed;
}

/**
 * The default mode: the relay when a real relay address is configured, direct when the address is this computer
 * (the local development server). An explicit choice saved in config always wins.
 */
export function defaultTelegramMode(relayUrl: string): TelegramMode {
  try {
    const host = new URL(relayUrl).hostname;
    if (host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1') return 'direct';
    return 'relay';
  } catch {
    return 'direct';
  }
}

export class TelegramViaRelay implements Sender {
  readonly channel = 'telegram' as const;
  status: RelayTelegramStatus = { state: 'none' };
  private names = new Map<number, string>();
  private needsSync = true;
  private lastSync = 0;
  private pairingUntil = 0;
  /** token and chat changes run one at a time, so a sync can never undo an upload that is still in progress */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly d: RelayTelegramDeps) {}

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => {});
    return p;
  }

  private now(): number {
    return this.d.now ? this.d.now() : Date.now();
  }

  private set(s: RelayTelegramStatus): RelayTelegramStatus {
    this.status = s;
    this.d.onChange?.(s);
    return s;
  }

  /** Makes the next tick reconcile with the relay (after a failure, a restart, or a pairing code). */
  requestSync() {
    this.needsSync = true;
  }

  /** Paired chats with the names the relay reported (names may be empty). */
  chatList(): Array<{ id: number; name: string }> {
    return this.d.getChats().map((id) => ({ id, name: this.names.get(id) ?? '' }));
  }

  /** One signed call. Network failures and 5xx become RelayDown; any other answer is returned for the caller to map. */
  private async rpc(method: string, path: string, payload?: unknown): Promise<{ status: number; json: any }> {
    let r: { status: number; json: any };
    try {
      r = await this.d.relay.request(method, path, payload);
    } catch {
      throw new RelayDown();
    }
    if (r.status >= 500) throw new RelayDown();
    return r;
  }

  /** PUT the token. Never throws except RelayDown-free surprises; a refusal comes back as the status to show. */
  private async upload(token: string): Promise<RelayTelegramStatus | { state: 'connected'; bot: string }> {
    try {
      const r = await this.rpc('PUT', '/v1/hub/telegram', { token });
      if (r.status === 200 && r.json?.ok) return { state: 'connected', bot: botName(r.json.bot) };
      const e = r.json?.error;
      if (e === 'invalid-token') return { state: 'rejected', message: MSG_REJECTED };
      if (e === 'telegram-unreachable') return { state: 'unreachable', message: RELAY_MSG.unreachable };
      if (e === 'no-public-url') return { state: 'unreachable', message: RELAY_MSG.noPublicUrl };
      this.d.log?.(`telegram relay: token upload answered ${r.status}`);
      return { state: 'no-telegram', message: RELAY_MSG.otherReply };
    } catch (e) {
      if (e instanceof RelayDown) return { state: 'waiting', message: RELAY_MSG.waiting };
      throw e;
    }
  }

  private async readInfo(): Promise<RelayInfo> {
    const r = await this.rpc('GET', '/v1/hub/telegram');
    if (r.status !== 200) throw new RelayDown();
    const j = r.json ?? {};
    const chats = Array.isArray(j.chats)
      ? j.chats.map((c: any) => ({ id: Number(c?.id), name: String(c?.name ?? '').slice(0, 60) })).filter((c: { id: number }) => Number.isFinite(c.id))
      : [];
    return { connected: j.connected === true, bot: botName(j.bot), chats };
  }

  /** Remove the token on the relay. Failure is remembered: the next sync tries again. */
  private async dropRemote(): Promise<void> {
    try {
      await this.rpc('DELETE', '/v1/hub/telegram');
    } catch {
      this.needsSync = true;
    }
  }

  private async putChats(ids: number[]): Promise<void> {
    const chats = ids.map((id) => ({ id, name: this.names.get(id) ?? '' }));
    try {
      const r = await this.rpc('PUT', '/v1/hub/telegram/chats', { chats });
      if (r.status !== 200 || !r.json?.ok) this.d.log?.(`telegram relay: chat restore answered ${r.status}`);
    } catch (e) {
      if (e instanceof RelayDown) this.needsSync = true;
      else throw e;
    }
  }

  /** Adopt chats the relay has and the hub does not; restore the hub's chats when the relay has none. */
  async syncChats(info?: RelayInfo): Promise<void> {
    const relayInfo = info ?? (await this.readInfo());
    for (const c of relayInfo.chats) this.names.set(c.id, c.name);
    const local = this.d.getChats();
    const known = new Set(local);
    const unknown = relayInfo.chats.filter((c) => !known.has(c.id)).map((c) => c.id);
    if (unknown.length) {
      this.d.setChats([...local, ...unknown]);
      return;
    }
    if (relayInfo.chats.length === 0 && local.length > 0) await this.putChats(local);
  }

  /**
   * Bring the relay in line with the hub: upload the saved token if the relay is not connected, remove a token the
   * hub no longer has, then reconcile the chats. Unreachable relay: the status says waiting and the sync repeats.
   */
  sync(): Promise<RelayTelegramStatus> {
    return this.exclusive(() => this.doSync());
  }

  private async doSync(): Promise<RelayTelegramStatus> {
    this.needsSync = false;
    this.lastSync = this.now();
    try {
      const token = this.d.getToken();
      let info = await this.readInfo();
      if (!token) {
        if (info.connected) await this.dropRemote();
        return this.set({ state: 'none' });
      }
      let next: RelayTelegramStatus;
      if (info.connected) {
        next = { state: 'connected', bot: info.bot };
      } else {
        next = await this.upload(token);
        if (next.state === 'connected') info = await this.readInfo();
      }
      if (next.state === 'connected') await this.syncChats(info);
      if (next.state === 'waiting') this.needsSync = true;
      return this.set(next);
    } catch (e) {
      if (!(e instanceof RelayDown)) throw e;
      this.needsSync = true;
      return this.set(this.d.getToken() ? { state: 'waiting', message: RELAY_MSG.waiting } : { state: 'none' });
    }
  }

  /**
   * Save the token here and upload it. A token Telegram refuses throws (and is not saved), as in direct mode. An
   * unreachable relay or Telegram keeps the token and says so; the sync uploads it later.
   */
  connect(token: string): Promise<RelayTelegramStatus> {
    return this.exclusive(async () => {
      const up = await this.upload(token);
      if (up.state === 'rejected') throw new Error(up.message);
      this.d.setToken(token);
      this.set(up);
      if (up.state === 'connected') return this.doSync();
      if (up.state === 'waiting') this.needsSync = true;
      return this.status;
    });
  }

  /** Remove key: forget the token here and on the relay. Paired chats are kept. */
  disconnect(): Promise<RelayTelegramStatus> {
    return this.exclusive(async () => {
      this.d.setToken(undefined);
      await this.dropRemote();
      return this.set({ state: 'none' });
    });
  }

  /** Switching to direct mode: the relay stops polling and forgets the token, but this computer keeps its copy. */
  unregister(): Promise<RelayTelegramStatus> {
    return this.exclusive(async () => {
      await this.dropRemote();
      this.needsSync = false;
      return this.set({ state: 'none' });
    });
  }

  /** Ask the relay for a pairing code. The user sends `/start CODE` to the bot; the next syncs pick the chat up. */
  async pairingCode(): Promise<string> {
    let r: { status: number; json: any };
    try {
      r = await this.rpc('POST', '/v1/hub/telegram/code', {});
    } catch {
      throw new Error(RELAY_MSG.cannotReach);
    }
    if (r.status === 409) throw new Error(RELAY_MSG.notSetUp);
    if (r.status !== 200 || typeof r.json?.code !== 'string') throw new Error(RELAY_MSG.noCode);
    this.pairingUntil = this.now() + PAIRING_WINDOW_MS;
    this.requestSync();
    return r.json.code;
  }

  /** Read the chat messages the relay holds for this hub since the saved cursor. Only paired chats reach the handler. */
  async pollInbound(): Promise<number> {
    if (this.status.state !== 'connected') return 0;
    const since = this.d.getCursor() ?? '0';
    let r: { status: number; json: any };
    try {
      r = await this.rpc('GET', `/v1/hub/telegram/inbound?since=${encodeURIComponent(since)}`);
    } catch {
      return 0;
    }
    if (r.status !== 200 || !Array.isArray(r.json?.messages)) return 0;
    const paired = new Set(this.d.getChats());
    let cursor: string | undefined;
    let handled = 0;
    for (const m of r.json.messages) {
      if (m?.id !== undefined) cursor = String(m.id);
      const chatId = Number(m?.chatId);
      if (!paired.has(chatId)) continue;
      this.d.onInbound({
        id: String(m.id),
        chatId,
        name: String(m.name ?? '').slice(0, 60),
        text: String(m.text ?? '').slice(0, 1000),
        at: Number(m.at) || this.now(),
      });
      handled++;
    }
    if (cursor !== undefined && cursor !== since) this.d.setCursor(cursor);
    return handled;
  }

  /** Called on every relay tick (about every 8 s): sync when due, then read inbound messages. Never throws. */
  async tick(): Promise<void> {
    const now = this.now();
    const every = now < this.pairingUntil ? PAIRING_SYNC_EVERY_MS : SYNC_EVERY_MS;
    try {
      if (this.needsSync || now - this.lastSync >= every) await this.sync();
      await this.pollInbound();
    } catch (e) {
      this.d.log?.(`telegram relay: tick failed: ${(e as Error)?.name ?? 'error'}`);
    }
  }

  /**
   * Sends to every paired chat through the relay. Text is split like direct mode. Approval and the audit log are
   * handled by the Outbox before this is called; here a refusal becomes a readable Error.
   */
  async send(text: string, _alert?: Alert, opts?: { html?: boolean }): Promise<void> {
    if (this.d.getChats().length === 0) throw new Error(RELAY_MSG.noChats);
    const html = !!opts?.html;
    const chunks = html ? splitHtml(text, TELEGRAM_MAX) : splitPlain(text, TELEGRAM_MAX);
    let sent = 0;
    let failed = 0;
    for (const chunk of chunks) {
      let r: { status: number; json: any };
      try {
        r = await this.rpc('POST', '/v1/hub/telegram/send', html ? { text: chunk, html: true } : { text: chunk });
      } catch {
        this.requestSync();
        throw new Error(RELAY_MSG.cannotReach);
      }
      if (r.status === 200 && r.json?.ok) {
        sent += Number(r.json.sent) || 0;
        failed += Number(r.json.failed) || 0;
        continue;
      }
      throw new Error(sendError(r.status, r.json?.error));
    }
    if (failed > 0) throw new Error(`The relay could not reach ${failed} of ${sent + failed} Telegram chats.`);
    if (sent === 0) throw new Error(RELAY_MSG.failed);
  }
}
