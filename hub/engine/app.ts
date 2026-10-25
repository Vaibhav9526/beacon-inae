import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { anthropicBrain, cliBrain, haikuWriter, ruleFromText } from './brains.ts';
import type { Brain } from './brains.ts';
import { parseHealthCsv } from './csvImport.ts';
import { HealthStore, newKey } from './healthStore.ts';
import { Hub } from './hub.ts';
import { AuditLog, Outbox } from './outbox.ts';
import type { Sender } from './outbox.ts';
import { instantiate, templateById, TEMPLATES } from './templates.ts';
import { TelegramLink } from './telegram.ts';
import type { TelegramState } from './telegram.ts';
import type { Agent, Alert, Channel } from './types.ts';

interface Config {
  brain: 'none' | 'claude' | 'codex' | 'gemini' | 'api';
  allowed: Channel[];
  telegram: TelegramState;
  telegramToken?: string;
  anthropicKey?: string;
  relayUrl: string;
}

export interface Pending {
  id: string;
  alertId: string;
  text: string;
  channels: Channel[];
}

type Listener = (ev: { type: 'pending' | 'alert' | 'run' }) => void;

/**
 * Everything the hub is, wired together, with no HTTP in it. The local web UI, the MCP server and the tests all
 * talk to this. Secrets live in `secrets.json` next to the data (the Electron shell moves them to the OS keychain).
 */
export class HubApp {
  readonly dir: string;
  readonly hub: Hub;
  readonly health: HealthStore;
  readonly audit: AuditLog;
  readonly outbox: Outbox;
  private interactive: boolean;
  pending: Pending | null = null;
  /** phones linked to this hub on the Beacon server; refreshed by whoever owns the BeaconLink */
  phonesPaired = 0;
  telegram: TelegramLink | null = null;
  private cfg: Config;
  private brain: Brain | null = null;
  private resolveAsk: ((a: 'once' | 'always' | 'no') => void) | null = null;
  private listeners = new Set<Listener>();
  private senders: Sender[] = [];
  readonly offline: boolean;

  constructor(opts: { dir?: string; offline?: boolean; extraSenders?: Sender[]; interactive?: boolean } = {}) {
    this.interactive = opts.interactive ?? true;
    this.dir = opts.dir ?? process.env.BEACON_HUB_DIR ?? join(homedir(), '.beacon-hub');
    this.offline = opts.offline ?? process.env.BEACON_HUB_OFFLINE === '1';
    mkdirSync(this.dir, { recursive: true });
    this.cfg = this.readCfg();
    const keyFile = join(this.dir, 'health.key');
    if (!existsSync(keyFile)) writeFileSync(keyFile, newKey().toString('hex'), { mode: 0o600 });
    const key = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'hex');
    const healthFile = join(this.dir, 'health.bin');
    this.health = existsSync(healthFile) ? HealthStore.load(healthFile, key) : new HealthStore(healthFile, key);
    this.audit = new AuditLog(join(this.dir, 'audit.jsonl'));
    this.senders = [...(opts.extraSenders ?? [])];
    this.outbox = new Outbox({
      senders: this.senders,
      audit: this.audit,
      allowed: new Set(this.cfg.allowed),
      onAllowed: (c) => {
        this.cfg.allowed = [...new Set([...this.cfg.allowed, c])];
        this.writeCfg();
      },
      ask: (alert, text) => this.ask(alert, text),
    });
    this.hub = new Hub({
      dir: this.dir,
      health: this.health,
      outbox: this.outbox,
      source: { offline: this.offline },
      rewrite: (a, fallback) => (this.brain ? haikuWriter(this.brain)(a, fallback) : Promise.resolve(null)),
    });
    this.setBrain(this.cfg.brain, this.cfg.anthropicKey);
    if (this.cfg.telegramToken) void this.connectTelegram(this.cfg.telegramToken).catch(() => {});
  }

  // ---- config ---------------------------------------------------------
  private cfgFile = () => join(this.dir, 'secrets.json');
  private readCfg(): Config {
    const base: Config = { brain: 'none', allowed: [], telegram: { chats: [] }, relayUrl: process.env.BEACON_SERVER ?? 'http://127.0.0.1:8787' };
    try {
      return { ...base, ...(JSON.parse(readFileSync(this.cfgFile(), 'utf8')) as Partial<Config>) };
    } catch {
      return base;
    }
  }
  private writeCfg() {
    writeFileSync(this.cfgFile(), JSON.stringify(this.cfg), { mode: 0o600 });
  }
  get relayUrl() {
    return this.cfg.relayUrl;
  }

  // ---- events and approvals -------------------------------------------
  on(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit(type: 'pending' | 'alert' | 'run') {
    for (const l of this.listeners) l({ type });
  }
  private ask(alert: Alert, text: string) {
    // a headless process (MCP over stdio) has nobody to ask: only channels already allowed with "always" go out
    if (!this.interactive) return Promise.resolve<'once' | 'always' | 'no'>('no');
    return new Promise<'once' | 'always' | 'no'>((resolve) => {
      this.pending = { id: randomBytes(6).toString('hex'), alertId: alert.id, text, channels: alert.channels };
      this.resolveAsk = (a) => {
        this.pending = null;
        this.resolveAsk = null;
        this.emit('pending');
        resolve(a);
      };
      this.emit('pending');
    });
  }
  approve(id: string, answer: 'once' | 'always' | 'no'): boolean {
    if (!this.pending || this.pending.id !== id || !this.resolveAsk) return false;
    this.resolveAsk(answer);
    return true;
  }

  // ---- brain -----------------------------------------------------------
  setBrain(kind: Config['brain'], apiKey?: string) {
    this.cfg.brain = kind;
    if (apiKey) this.cfg.anthropicKey = apiKey;
    this.writeCfg();
    const key = apiKey ?? this.cfg.anthropicKey;
    this.brain = kind === 'api' && key ? anthropicBrain(key) : kind === 'claude' || kind === 'codex' || kind === 'gemini' ? cliBrain(kind) : null;
  }
  brainInfo() {
    return { kind: this.cfg.brain, ok: this.cfg.brain === 'none' || this.brain !== null };
  }
  haiku = () => this.cfg.brain === 'api' && !!this.cfg.anthropicKey;

  // ---- agents ----------------------------------------------------------
  addFromTemplate(templateId: string, over: Partial<Agent> = {}): Agent | null {
    const t = templateById(templateId);
    if (!t) return null;
    const a = instantiate(t, over);
    this.hub.upsert(a);
    return a;
  }
  async addRule(agentId: string, text: string) {
    const a = this.hub.agents().find((x) => x.id === agentId);
    if (!a) return null;
    const r = await ruleFromText(text, this.brain ?? undefined);
    if (!r) return null;
    this.hub.upsert({ ...a, rules: [...a.rules, r.rule] });
    return r;
  }
  removeRule(agentId: string, ruleId: string) {
    const a = this.hub.agents().find((x) => x.id === agentId);
    if (a) this.hub.upsert({ ...a, rules: a.rules.filter((r) => r.id !== ruleId) });
  }
  async tick() {
    const alerts = await this.hub.tick(true);
    this.emit('run');
    if (alerts.length) this.emit('alert');
    return alerts;
  }
  async runOne(id: string) {
    const a = this.hub.agents().find((x) => x.id === id);
    if (!a) return -1;
    const n = (await this.hub.runAgent(a)).length;
    this.emit('run');
    return n;
  }

  // ---- health ----------------------------------------------------------
  importCsv(text: string, member: string) {
    const r = parseHealthCsv(text, member);
    this.health.addMany(r.readings);
    this.health.save();
    return { added: r.readings.length, skipped: r.skipped };
  }
  addReading(r: { member: string; hr?: number; spo2?: number; steps?: number; sleepHours?: number }) {
    this.health.add({ ...r, at: Date.now() });
    this.health.save();
  }

  // ---- channels --------------------------------------------------------
  addSender(s: Sender) {
    this.senders.splice(0, this.senders.length, ...this.senders.filter((x) => x.channel !== s.channel), s);
  }
  async connectTelegram(token: string): Promise<string> {
    await this.telegram?.stop();
    this.cfg.telegramToken = token;
    this.writeCfg();
    const link = new TelegramLink(token, this.cfg.telegram, (s) => {
      this.cfg.telegram = s;
      this.writeCfg();
    });
    const bot = await link.start(() => this.emit('run'));
    this.telegram = link;
    this.addSender(link);
    return bot;
  }
  telegramInfo() {
    return { connected: !!this.telegram, paired: this.cfg.telegram.chats.length, bot: '' };
  }

  state() {
    return {
      agents: this.hub.agents(),
      templates: TEMPLATES,
      runs: this.hub.runs().slice(-50).reverse(),
      alerts: this.hub.alerts().slice(-30).reverse(),
      audit: this.audit.read(50).reverse(),
      connections: {
        telegram: this.telegramInfo(),
        beacon: { paired: this.phonesPaired },
        brain: this.brainInfo(),
        haiku: this.haiku(),
      },
      pending: this.pending,
      members: this.health.members(),
    };
  }
}
