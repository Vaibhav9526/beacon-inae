import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Alert, Channel } from './types.ts';

/** A transport that can deliver a short text. Telegram and the Beacon push each implement this. */
export interface Sender {
  channel: Channel;
  send(text: string, alert: Alert): Promise<void>;
}

export interface AuditLine {
  at: number;
  alertId: string;
  channel: Channel | 'gate';
  event: 'queued' | 'approved' | 'declined' | 'sent' | 'failed' | 'auto-approved';
  text: string;
  error?: string;
}

/** Append-only JSON-lines log of every message the hub sends or refuses to send. */
export class AuditLog {
  constructor(private file: string) {
    mkdirSync(dirname(file), { recursive: true });
  }
  add(line: Omit<AuditLine, 'at'> & { at?: number }) {
    appendFileSync(this.file, JSON.stringify({ at: Date.now(), ...line }) + '\n');
  }
  read(limit = 200): AuditLine[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map((l) => JSON.parse(l) as AuditLine);
  }
}

export interface OutboxOptions {
  senders: Sender[];
  audit: AuditLog;
  /** Ask the person. The first send on a channel always asks; after "always allow" later ones go straight out. */
  ask: (alert: Alert, text: string) => Promise<'once' | 'always' | 'no'>;
  /** channels already allowed with "always" */
  allowed?: Set<Channel>;
  onAllowed?: (c: Channel) => void;
}

/**
 * The only way a message leaves the computer. Every message is logged; the first on each channel needs a yes.
 * Only the short alert text is ever passed to a sender, never health records.
 */
export class Outbox {
  private allowed: Set<Channel>;
  constructor(private o: OutboxOptions) {
    this.allowed = o.allowed ?? new Set();
  }

  async deliver(alert: Alert, text: string): Promise<Alert> {
    const todo = alert.channels.filter((c) => this.o.senders.some((s) => s.channel === c));
    if (todo.length === 0) {
      return { ...alert, status: 'failed', note: 'No connected channel. Connect Telegram or pair the phone.' };
    }
    this.o.audit.add({ alertId: alert.id, channel: 'gate', event: 'queued', text });
    const needsAsk = todo.filter((c) => !this.allowed.has(c));
    if (needsAsk.length) {
      const answer = await this.o.ask(alert, text);
      if (answer === 'no') {
        this.o.audit.add({ alertId: alert.id, channel: 'gate', event: 'declined', text });
        return { ...alert, status: 'suppressed', note: 'Declined by you' };
      }
      this.o.audit.add({ alertId: alert.id, channel: 'gate', event: 'approved', text });
      if (answer === 'always') for (const c of needsAsk) { this.allowed.add(c); this.o.onAllowed?.(c); }
    } else {
      this.o.audit.add({ alertId: alert.id, channel: 'gate', event: 'auto-approved', text });
    }

    let failed = 0;
    for (const c of todo) {
      const s = this.o.senders.find((x) => x.channel === c)!;
      try {
        await s.send(text, alert);
        this.o.audit.add({ alertId: alert.id, channel: c, event: 'sent', text });
      } catch (e) {
        failed++;
        this.o.audit.add({ alertId: alert.id, channel: c, event: 'failed', text, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { ...alert, status: failed === todo.length ? 'failed' : 'sent', note: failed ? `${failed} of ${todo.length} channels failed` : undefined };
  }
}
