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

  async start(onPaired?: (chatId: number, title: string) => void): Promise<string> {
    this.bot = new Bot(this.token);
    this.bot.command('start', async (ctx) => {
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
    this.bot.command('stop', async (ctx) => {
      this.state.chats = this.state.chats.filter((c) => c !== ctx.chat.id);
      this.save(this.state);
      await ctx.reply('Stopped. No more alerts here.');
    });
    const me = await this.bot.api.getMe();
    void this.bot.start({ drop_pending_updates: true });
    return me.username ?? '';
  }

  async stop() {
    await this.bot?.stop();
    this.bot = null;
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
