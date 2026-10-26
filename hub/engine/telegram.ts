import { randomInt } from 'node:crypto';
import { Bot } from 'grammy';
import type { Alert } from './types.ts';
import type { Sender } from './outbox.ts';
import { splitHtml, stripHtml, TELEGRAM_MAX } from './digest.ts';

/** Plain text split on newlines (and at the limit for very long lines). */
function splitPlain(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    for (let rest = line; ; ) {
      const piece = rest.slice(0, max);
      rest = rest.slice(max);
      if (cur && cur.length + 1 + piece.length > max) {
        out.push(cur);
        cur = '';
      }
      cur += (cur ? '\n' : '') + piece;
      if (!rest) break;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export interface TelegramState {
  /** chat ids that finished pairing (the family group, plus anyone who joined with the code) */
  chats: number[];
}

// ---- errors and status -----------------------------------------------------

/** Waits before each automatic reconnect after a failure: 2, 4, 8, 16, 30 seconds. */
export const TELEGRAM_RETRY_MS = [2_000, 4_000, 8_000, 16_000, 30_000];
export const MSG_REJECTED = 'Telegram says this token is not valid. Create a new one with @BotFather.';
export const MSG_NETWORK = 'Cannot reach Telegram right now (no internet?). Will retry.';
export const MSG_GAVE_UP = 'Cannot reach Telegram right now (no internet?). Press Retry now when you are back online.';
export const MSG_OTHER = 'Telegram did not answer as expected. Will retry.';
const GETME_TIMEOUT_MS = 15_000;

/**
 * Removes bot tokens from text before it reaches a log, a message or the screen. Any `123456:ABC...` shape is hidden,
 * and the exact token is hidden when it is given.
 */
export function redactToken(text: string, token?: string): string {
  let out = String(text).replace(/\b\d{5,}:[A-Za-z0-9_-]{10,}\b/g, '[token hidden]');
  if (token) out = out.split(token).join('[token hidden]');
  return out;
}

export interface TelegramFailure {
  kind: 'rejected' | 'network' | 'other';
  code?: number;
  /** the user-facing sentence; never contains the token */
  message: string;
}

/**
 * Sorts a failed Telegram call. 401 and 404 mean the token itself is refused (stop, do not retry). A grammY HttpError
 * or our timeout means no answer came (no internet, DNS, a blocked network): retry. Anything else is retried too.
 */
export function classifyTelegramError(err: unknown): TelegramFailure {
  const e = (err ?? {}) as { error_code?: unknown; name?: unknown; message?: unknown };
  const code = typeof e.error_code === 'number' ? e.error_code : undefined;
  if (code === 401 || code === 404) return { kind: 'rejected', code, message: MSG_REJECTED };
  const msg = typeof e.message === 'string' ? e.message : '';
  if (e.name === 'HttpError' || msg.startsWith('Network request')) return { kind: 'network', message: MSG_NETWORK };
  return { kind: 'other', code, message: MSG_OTHER };
}

export type TelegramStatus =
  | { state: 'none' }
  | { state: 'connecting' }
  | { state: 'connected'; bot: string }
  | { state: 'reconnecting'; attempt: number; of: number; message: string }
  | { state: 'rejected'; message: string }
  | { state: 'unreachable'; message: string };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("Network request for 'getMe' timed out"), { name: 'HttpError' })), ms);
    (timer as { unref?: () => void }).unref?.();
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** One getMe call with a timeout: checks a token before it is saved. Resolves with the bot's username; throws grammY errors. */
export async function getBotName(token: string): Promise<string> {
  const me = await withTimeout(new Bot(token).api.getMe(), GETME_TIMEOUT_MS);
  return me.username ?? '';
}

/** Trims, strips quotes and removes inner whitespace, the way a token is pasted from BotFather. */
export function cleanTelegramToken(input: unknown): string {
  return String(input ?? '').trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, '');
}

// ---- link -------------------------------------------------------------------

/**
 * Telegram through grammY. Pairing: the hub shows a 6-digit code; someone sends `/start 123456` in the family group
 * (or to the bot) and that chat is remembered. Nothing is sent to a chat that has not paired.
 */
export class TelegramLink implements Sender {
  readonly channel = 'telegram' as const;
  private bot: Bot | null = null;
  private code = '';
  private codeAt = 0;

  constructor(
    private token: string,
    private state: TelegramState,
    private save: (s: TelegramState) => void,
  ) {}

  newPairingCode(): string {
    this.code = String(randomInt(100000, 1000000));
    this.codeAt = Date.now();
    return this.code;
  }

  get paired(): number {
    return this.state.chats.length;
  }

  /**
   * Checks the token with getMe, then starts polling in the background. A getMe failure throws (the caller decides
   * whether to retry). A later polling failure is passed to `onLost` instead of becoming an unhandled rejection.
   */
  async start(onPaired?: (chatId: number, title: string) => void, onLost?: (err: unknown) => void): Promise<string> {
    const bot = new Bot(this.token);
    bot.command('start', async (ctx) => {
      const given = (ctx.match ?? '').toString().trim();
      const fresh = this.code && Date.now() - this.codeAt < 15 * 60_000;
      if (!fresh || given !== this.code) {
        await ctx.reply('Open Beacon Hub on the computer, press Connect Telegram, then send /start with the 6 digit code shown there.');
        return;
      }
      if (!this.state.chats.includes(ctx.chat.id)) {
        this.state.chats.push(ctx.chat.id);
        this.save(this.state);
      }
      this.code = '';
      await ctx.reply('Connected. I will send short family alerts here.');
      onPaired?.(ctx.chat.id, 'title' in ctx.chat && ctx.chat.title ? ctx.chat.title : 'private chat');
    });
    bot.command('stop', async (ctx) => {
      this.state.chats = this.state.chats.filter((c) => c !== ctx.chat.id);
      this.save(this.state);
      await ctx.reply('Stopped. No more alerts here.');
    });
    const me = await withTimeout(bot.api.getMe(), GETME_TIMEOUT_MS);
    this.bot = bot;
    // grammY retries network blips while polling; what reaches this catch is fatal for this bot instance.
    bot.start({ drop_pending_updates: true }).catch((err: unknown) => {
      if (this.bot !== bot) return; // stopped on purpose
      this.bot = null;
      onLost?.(err);
    });
    return me.username ?? '';
  }

  async stop() {
    const bot = this.bot;
    this.bot = null;
    if (!bot) return;
    try {
      await bot.stop();
    } catch {
      /* already stopped */
    }
  }

  /**
   * Send to every paired chat. With `html: true` the text is Telegram HTML (parse_mode HTML); link previews are off.
   * Text over 4000 characters is split on newlines without breaking a tag. If Telegram cannot parse the markup the
   * chunk is retried once as plain text with the tags stripped.
   */
  async send(text: string, _alert?: Alert, opts?: { html?: boolean }): Promise<void> {
    if (!this.bot) throw new Error('Telegram is not started');
    if (this.state.chats.length === 0) throw new Error('No Telegram chat is paired yet');
    const html = !!opts?.html;
    const chunks = html ? splitHtml(text, TELEGRAM_MAX) : splitPlain(text, TELEGRAM_MAX);
    for (const id of this.state.chats) {
      for (const chunk of chunks) {
        try {
          await this.bot.api.sendMessage(id, chunk, { ...(html ? { parse_mode: 'HTML' as const } : {}), link_preview_options: { is_disabled: true } });
        } catch (e) {
          if (!html || !/can't parse entities/i.test(String((e as Error)?.message ?? e))) throw e;
          await this.bot.api.sendMessage(id, stripHtml(chunk), { link_preview_options: { is_disabled: true } });
        }
      }
    }
  }
}

// ---- connection supervisor -------------------------------------------------------

export interface SupervisorDeps {
  /** Start polling with this token. Resolves with the bot username; rejects if the start fails. */
  start(token: string, onLost: (err: unknown) => void): Promise<string>;
  /** Stop whatever is running. Must not throw. */
  stop(): Promise<void>;
  onChange?(status: TelegramStatus): void;
  /** retry waits in ms; defaults to TELEGRAM_RETRY_MS */
  delays?: number[];
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
  log?(line: string): void;
}

function errText(err: unknown): string {
  return (err as Error)?.message ?? String(err);
}

/**
 * Keeps the Telegram connection alive: connects with the saved token, retries network failures in the background
 * (2, 4, 8, 16, 30 s, then gives up until the user presses Retry), stops on a rejected token, and never throws.
 * Attempts run one at a time, so a stale attempt can never leave a second poller running.
 */
export class TelegramSupervisor {
  status: TelegramStatus = { state: 'none' };
  private token = '';
  private gen = 0;
  private attempt = 0;
  private timer: unknown = null;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly delays: number[];

  constructor(private readonly d: SupervisorDeps) {
    this.delays = d.delays ?? TELEGRAM_RETRY_MS;
  }

  /** Connect with this token now. Resolves with the status after the first try. An empty token means "none". */
  connect(token: string): Promise<TelegramStatus> {
    this.cancel();
    this.gen++;
    this.token = token;
    this.attempt = 0;
    const g = this.gen;
    if (!token) {
      this.set({ state: 'none' });
      return Promise.resolve(this.status);
    }
    return this.run(() => this.attemptNow(g));
  }

  /** The Retry button: start again from the first retry. */
  retryNow(): Promise<TelegramStatus> {
    return this.connect(this.token);
  }

  /** Remove the token: cancel retries and stop polling. */
  async forget(): Promise<void> {
    this.cancel();
    this.gen++;
    this.token = '';
    await this.run(() => this.d.stop().catch(() => {}));
    this.set({ state: 'none' });
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => {});
    return p;
  }

  private async attemptNow(g: number): Promise<TelegramStatus> {
    if (g !== this.gen) return this.status;
    this.set({ state: 'connecting' });
    await this.d.stop().catch(() => {});
    try {
      const bot = await this.d.start(this.token, (err) => this.lost(g, err));
      if (g !== this.gen) {
        await this.d.stop().catch(() => {});
        return this.status;
      }
      this.attempt = 0;
      this.set({ state: 'connected', bot });
    } catch (err) {
      this.failed(g, err);
    }
    return this.status;
  }

  private lost(g: number, err: unknown) {
    if (g !== this.gen) return;
    void this.run(async () => {
      if (g !== this.gen) return;
      await this.d.stop().catch(() => {});
      this.failed(g, err);
    }).catch(() => {});
  }

  private failed(g: number, err: unknown) {
    if (g !== this.gen) return;
    const f = classifyTelegramError(err);
    this.d.log?.(`telegram: ${f.kind}${f.code ? ` ${f.code}` : ''}: ${redactToken(errText(err), this.token)}`);
    this.cancel();
    if (f.kind === 'rejected') {
      this.set({ state: 'rejected', message: f.message });
      return;
    }
    if (this.attempt >= this.delays.length) {
      this.set({ state: 'unreachable', message: MSG_GAVE_UP });
      return;
    }
    const wait = this.delays[this.attempt]!;
    this.attempt++;
    this.set({ state: 'reconnecting', attempt: this.attempt, of: this.delays.length, message: f.message });
    const schedule = this.d.setTimer ?? defaultTimer;
    this.timer = schedule(() => {
      this.timer = null;
      void this.run(() => this.attemptNow(g)).catch(() => {});
    }, wait);
  }

  private cancel() {
    if (this.timer === null) return;
    (this.d.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = null;
  }

  private set(s: TelegramStatus) {
    this.status = s;
    this.d.onChange?.(s);
  }
}

function defaultTimer(fn: () => void, ms: number): unknown {
  const t = setTimeout(fn, ms);
  (t as { unref?: () => void }).unref?.();
  return t;
}
