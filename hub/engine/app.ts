import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BeaconLink } from './beaconLink.ts';
import { anthropicBrain, cliBrain, haikuWriter, ruleFromText } from './brains.ts';
import type { Brain } from './brains.ts';
import { parseHealthCsv } from './csvImport.ts';
import { Gateway } from './gateway.ts';
import type { DeliveryReport } from './gateway.ts';
import { manualRunItems } from './digest.ts';
import { HealthStore, newKey } from './healthStore.ts';
import { Hub } from './hub.ts';
import { McpClients } from './mcpClients.ts';
import type { McpSpecInput } from './mcpClients.ts';
import { Members } from './members.ts';
import { cleanPipeline, NODE_KINDS } from './nodeCatalog.ts';
import { cleanOwmKey, currentUrl, redactKey } from './owm.ts';
import { owmGet, runPipeline } from './nodes.ts';
import { AuditLog, Outbox } from './outbox.ts';
import type { Sender } from './outbox.ts';
import { PERSONAS, personaById } from './personas.ts';
import { computeSituation } from './situation.ts';
import type { Situation } from './situation.ts';
import { instantiate, templateById, TEMPLATES } from './templates.ts';
import { classifyTelegramError, cleanTelegramToken, getBotName, TelegramLink, TelegramSupervisor } from './telegram.ts';
import type { SupervisorDeps, TelegramState, TelegramStatus } from './telegram.ts';
import { defaultTelegramMode, TelegramViaRelay } from './telegramRelay.ts';
import type { RelayTelegramStatus, TelegramInbound, TelegramMode } from './telegramRelay.ts';
import type { Agent, Alert, Channel, FeedItem, GatewayRoute, GroupMessage, Member, MemberRole, NodeSpec, WireMessage } from './types.ts';
import { chunkFeed, decodeWire, encodeWire, newGroupKey } from './wire.ts';

interface Config {
  brain: 'none' | 'claude' | 'codex' | 'gemini' | 'api';
  allowed: Channel[];
  telegram: TelegramState;
  telegramToken?: string;
  /** where Telegram runs; unset means the default for the relay address (see defaultTelegramMode) */
  telegramMode?: TelegramMode;
  /** newest inbound relay message id handled for Telegram */
  telegramInboxSince?: string;
  anthropicKey?: string;
  openWeatherKey?: string;
  relayUrl: string;
  allowAdultAsks: boolean;
  /** newest inbox item already handled (ms) */
  inboxSince: number;
}

export interface Pending {
  id: string;
  alertId: string;
  text: string;
  channels: Channel[];
}

/** A question from a phone for the desktop's assistant. Elders and children need an OK from the desktop. */
export interface AskEntry {
  id: string;
  memberId: string;
  name: string;
  text: string;
  at: number;
  status: 'pending' | 'running' | 'answered' | 'denied';
  answer?: string;
}

export interface JoinRequest {
  deviceId: string;
  name: string;
  at: number;
}

export type HubEvent = { type: 'pending' | 'alert' | 'run' | 'feed' | 'group' | 'ask' | 'mcp' | 'members' };
type Listener = (ev: HubEvent) => void;

const FEED_MAX = 100;
const ASK_SYSTEM =
  'You are the family safety assistant on the desktop Beacon Hub. Answer in at most 80 words, in plain calm language. ' +
  'For anything urgent tell them to call 112. You cannot run commands or open files; only answer from what you are told.';

/** A relay address: http or https, no trailing slash, no query or fragment. Throws a readable error otherwise. */
export function cleanRelayUrl(input: string): string {
  const raw = String(input ?? '').trim();
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('The relay address must be a full address, such as https://beacon.example.org');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('The relay address must start with http:// or https://');
  if (!u.hostname) throw new Error('The relay address has no host name');
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

/**
 * Everything the hub is, wired together, with no HTTP in it. The local web UI, the MCP server and the tests all
 * talk to this. Secrets live in `secrets.json` next to the data (the Electron shell moves them to the OS keychain).
 */
/** The one line the Run button shows: what was sent, or why it was not. */
export function deliveryLine(r: DeliveryReport | undefined, items: number): string {
  if (!r) return items ? 'Not sent: the hub could not hand the items to the phones or Telegram.' : 'Nothing to send: this run found no items.';
  if (r.telegram === 'none' && !r.phones) return 'Nothing new to send: these items were sent before.';
  const phones = r.phones === 1 ? '1 phone' : `${r.phones} phones`;
  const tg = r.telegram === 'sent';
  const tgWhy = r.telegram === 'off' ? 'Telegram is not connected' : r.telegramNote ?? 'Telegram did not send';
  if (r.phones && tg) return `Sent to ${phones} and Telegram`;
  if (r.phones) return `Sent to ${phones}. Telegram: ${tgWhy}.`;
  if (tg) return `Sent to Telegram. No phone received it: ${r.phonesPaired ? 'the phones could not be reached' : 'no phone is paired'}.`;
  const why = `${r.phonesPaired ? 'the phones could not be reached' : 'no phone is paired'} and ${tgWhy.charAt(0).toLowerCase()}${tgWhy.slice(1)}`;
  return `Not sent: ${why}.`;
}

/**
 * What Connections may show about a saved secret: that it is saved and the last four characters, never more. Short
 * values show only "Saved", so a short secret is never mostly revealed.
 */
export function keyHint(secret?: string): string {
  if (!secret) return '';
  return secret.length >= 12 ? `Saved (ends ...${secret.slice(-4)})` : 'Saved';
}

export class HubApp {
  readonly dir: string;
  readonly hub: Hub;
  readonly health: HealthStore;
  readonly audit: AuditLog;
  readonly outbox: Outbox;
  readonly members: Members;
  readonly gateway: Gateway;
  readonly mcp: McpClients;
  readonly link: BeaconLink;
  private interactive: boolean;
  pending: Pending | null = null;
  /** phones linked to this hub on the Beacon server */
  phonesPaired = 0;
  telegram: TelegramLink | null = null;
  asks: AskEntry[] = [];
  joins: JoinRequest[] = [];
  private feedItems: FeedItem[] = [];
  private cfg: Config;
  private brain: Brain | null = null;
  private resolveAsk: ((a: 'once' | 'always' | 'no') => void) | null = null;
  private listeners = new Set<Listener>();
  private senders: Sender[] = [];
  private gk: Uint8Array;
  private relayTimer: ReturnType<typeof setInterval> | null = null;
  readonly offline: boolean;

  readonly telegramSup: TelegramSupervisor;
  /** Telegram run by the relay server (used when the mode is 'relay') */
  readonly telegramRelay: TelegramViaRelay;
  private telegramProbe: (token: string) => Promise<string>;
  /** messages from paired Telegram chats, newest first (relay mode); kept in memory only */
  private telegramInbox: TelegramInbound[] = [];
  /** the relay failed its last health check; the next success re-registers and re-syncs Telegram */
  private relayWasDown = false;

  /**
   * `telegramStart` and `telegramProbe` replace the real Telegram calls in tests; `telegramDelays` shortens the retry waits.
   * The data folder is `opts.dir`, else BEACON_HUB_DIR, else ~/.beacon-hub (see electron/main.cjs for the desktop folder).
   */
  constructor(opts: {
    dir?: string;
    offline?: boolean;
    extraSenders?: Sender[];
    interactive?: boolean;
    link?: BeaconLink;
    telegramStart?: SupervisorDeps['start'];
    telegramProbe?: (token: string) => Promise<string>;
    telegramDelays?: number[];
  } = {}) {
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

    // the group key: made once, shown to phones only inside the pairing QR
    const gkFile = join(this.dir, 'group.key');
    if (!existsSync(gkFile)) writeFileSync(gkFile, Buffer.from(newGroupKey()).toString('hex'), { mode: 0o600 });
    this.gk = Uint8Array.from(Buffer.from(readFileSync(gkFile, 'utf8').trim(), 'hex'));

    this.link = opts.link ?? new BeaconLink(this.dir, this.cfg.relayUrl);
    this.senders = [...(opts.extraSenders ?? []), this.link];
    this.telegramRelay = new TelegramViaRelay({
      relay: this.link,
      getToken: () => this.cfg.telegramToken,
      setToken: (t) => {
        if (t) this.cfg.telegramToken = t;
        else delete this.cfg.telegramToken;
        this.writeCfg();
      },
      getChats: () => [...this.cfg.telegram.chats],
      setChats: (ids) => {
        this.cfg.telegram = { chats: [...new Set(ids)] };
        this.writeCfg();
      },
      getCursor: () => this.cfg.telegramInboxSince,
      setCursor: (c) => {
        this.cfg.telegramInboxSince = c;
        this.writeCfg();
      },
      onInbound: (m) => this.onTelegramText(m),
      onChange: () => this.emit('run'),
      log: (line) => console.log(line),
    });
    if (this.telegramMode() === 'relay') this.addSender(this.telegramRelay);
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

    this.members = new Members(join(this.dir, 'members.json'));
    this.gateway = new Gateway(join(this.dir, 'gateway.json'), {
      members: this.members,
      groupKey: () => this.gk,
      sendToPhone: async (deviceId, blobs) => {
        for (const b of blobs) await this.link.sendToPhone(deviceId, b);
      },
      // Telegram copies of feed items still go through the first-send approval and the audit log
      // a refused or failed send throws, so the gateway can report it (the outbox itself does not throw)
      sendTelegram: async (text, o) => {
        // in relay mode the relay sender reports its own refusals (not set up, no chats) through the outbox
        if (!this.telegram && this.telegramMode() !== 'relay') throw new Error('Telegram is not connected');
        const alert: Alert = { id: `feed-${Date.now().toString(36)}`, severity: 'warning', title: 'Feed', body: text, channels: ['telegram'], signals: [], at: Date.now(), status: 'pending-approval' };
        const done = await this.outbox.deliver(alert, text, o);
        if (done.status !== 'sent') throw new Error(done.note ?? 'Telegram did not take the message');
      },
    });
    this.mcp = new McpClients(join(this.dir, 'mcp.json'));
    this.feedItems = this.readFeed();

    this.hub = new Hub({
      dir: this.dir,
      health: this.health,
      outbox: this.outbox,
      source: { offline: this.offline },
      rewrite: (a, fallback, persona) => (this.brain ? haikuWriter(this.brain)(a, fallback, persona) : Promise.resolve(null)),
      pipeline: (agent) =>
        runPipeline(agent, {
          offline: this.offline,
          owmKey: this.cfg.openWeatherKey,
          metricsFor: (a) => this.hub.metricsOf(a),
          callMcp: async (server, tool, args) => {
            if (!this.mcp.status().find((s) => s.id === server)?.connected) {
              const c = await this.mcp.connect(server);
              if (!c.ok) throw new Error(c.error ?? 'MCP server did not connect');
            }
            return this.mcp.callTool(server, tool, args);
          },
          summarize: this.brain ? (t) => this.brain!('Shorten this to at most 50 words in plain language. Keep every number exactly. Reply with the text only.', t).catch(() => null) : undefined,
        }),
      onItems: (items, opts) => this.takeItems(items, opts),
    });
    this.setBrain(this.cfg.brain, this.cfg.anthropicKey);
    this.telegramProbe = opts.telegramProbe ?? getBotName;
    this.telegramSup = new TelegramSupervisor({
      start: opts.telegramStart ?? ((token, onLost) => this.startTelegram(token, onLost)),
      stop: async () => {
        const link = this.telegram;
        this.telegram = null;
        if (link) this.senders.splice(0, this.senders.length, ...this.senders.filter((s) => s !== link));
        await link?.stop();
      },
      delays: opts.telegramDelays,
      log: (line) => console.log(line),
    });
    // the saved token connects on every start, in the background; failures retry and never block startup.
    // In relay mode the relay gets the token on the first sync (startRelay), not this computer.
    if (this.cfg.telegramToken && this.telegramMode() === 'direct') void this.telegramSup.connect(this.cfg.telegramToken).catch(() => {});
  }

  // ---- config ---------------------------------------------------------
  // Everything secret or saved (bot token, OpenWeather key, Claude/API key, paired chats) lives in secrets.json in the
  // data folder, mode 600. It is written at once on every change, through a temp file so a crash cannot leave half of it.
  private cfgFile = () => join(this.dir, 'secrets.json');
  private readCfg(): Config {
    const base: Config = { brain: 'none', allowed: [], telegram: { chats: [] }, relayUrl: process.env.BEACON_SERVER ?? 'http://127.0.0.1:8787', allowAdultAsks: false, inboxSince: 0 };
    const file = this.cfgFile();
    if (!existsSync(file)) return base;
    try {
      return { ...base, ...(JSON.parse(readFileSync(file, 'utf8')) as Partial<Config>) };
    } catch {
      // unreadable: keep the bytes aside instead of letting the next save overwrite them
      try {
        renameSync(file, `${file}.unreadable-${Date.now()}`);
      } catch {
        /* ignore */
      }
      return base;
    }
  }
  private writeCfg() {
    const file = this.cfgFile();
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.cfg), { mode: 0o600 });
    renameSync(tmp, file);
  }
  get relayUrl() {
    return this.cfg.relayUrl;
  }
  /**
   * Save the Beacon server address the hub talks to (phones pair and get alerts through it). Must be an http or https
   * address. Trailing slashes and any query or fragment are dropped. Takes effect at once.
   */
  setRelayUrl(input: string): string {
    const url = cleanRelayUrl(input);
    const before = this.telegramMode();
    this.cfg.relayUrl = url;
    this.writeCfg();
    this.link.setUrl(url);
    // with no mode chosen yet, the default follows the address, so Telegram moves with it
    const after = this.telegramMode();
    if (after !== before) void this.moveTelegram(after).catch(() => {});
    return url;
  }
  /** Ask a Beacon server whether it is up: GET {url}/healthz, from here so the browser's CORS rules do not apply. */
  async checkRelay(input?: string): Promise<{ ok: boolean; ms: number; error?: string }> {
    const base = input === undefined ? this.cfg.relayUrl : cleanRelayUrl(input);
    const started = Date.now();
    try {
      const res = await fetch(base + '/healthz', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
      const ms = Date.now() - started;
      if (!res.ok) return { ok: false, ms, error: `the server answered ${res.status}` };
      const j = (await res.json().catch(() => null)) as { ok?: unknown } | null;
      if (j?.ok !== true) return { ok: false, ms, error: 'that address answered, but it is not a Beacon server' };
      return { ok: true, ms };
    } catch (e) {
      const ms = Date.now() - started;
      return { ok: false, ms, error: (e as Error).name === 'TimeoutError' ? 'no answer after 6 seconds' : 'could not reach that address' };
    }
  }
  groupKey = () => this.gk;
  setAllowAdultAsks(v: boolean) {
    this.cfg.allowAdultAsks = !!v;
    this.writeCfg();
    this.emit('ask');
  }

  // ---- events and approvals -------------------------------------------
  on(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit(type: HubEvent['type']) {
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

  // ---- OpenWeather -------------------------------------------------------
  /**
   * Save the user's OpenWeather key (secrets.json, mode 600). Quotes and spaces are removed. An empty value does NOT
   * erase a saved key (use removeOpenWeatherKey for that). The key is never returned.
   */
  setOpenWeatherKey(input: string): { hasKey: boolean } {
    const key = cleanOwmKey(input);
    if (!key) return { hasKey: !!this.cfg.openWeatherKey };
    this.cfg.openWeatherKey = key;
    this.writeCfg();
    return { hasKey: true };
  }
  removeOpenWeatherKey(): { hasKey: boolean } {
    delete this.cfg.openWeatherKey;
    this.writeCfg();
    return { hasKey: false };
  }
  openWeatherInfo() {
    return { hasKey: !!this.cfg.openWeatherKey, hint: keyHint(this.cfg.openWeatherKey) };
  }
  /** Ask OpenWeather for the current weather in Delhi to see whether the key works. */
  async testOpenWeather(): Promise<{ ok: boolean; ms: number; error?: string }> {
    const key = this.cfg.openWeatherKey;
    const started = Date.now();
    if (!key) return { ok: false, ms: 0, error: 'Add your OpenWeather key in Connections' };
    try {
      await owmGet(currentUrl(28.61, 77.21, key), { owmKey: key });
      return { ok: true, ms: Date.now() - started };
    } catch (e) {
      return { ok: false, ms: Date.now() - started, error: redactKey(e instanceof Error ? e.message : String(e), key) };
    }
  }

  // ---- agents ----------------------------------------------------------
  addFromTemplate(templateId: string, over: Partial<Agent> = {}): Agent | null {
    const t = templateById(templateId);
    if (!t) return null;
    const a = instantiate(t, over);
    this.hub.upsert(a);
    return a;
  }
  /**
   * Enrol a new agent in the School: pick a persona, optionally a template (else the persona's first), a name, a place and
   * the people it looks after. It starts awake. Returns null for an unknown persona or template.
   */
  enrol(o: { personaId: string; name?: string; templateId?: string; place?: Agent['place']; members?: string[]; look?: Agent['look']; channels?: Agent['channels']; awake?: boolean; genre?: Agent['genre']; pipeline?: NodeSpec[] }): Agent | null {
    const persona = personaById(o.personaId);
    if (!persona) return null;
    const t = templateById(o.templateId ?? persona.templates[0]);
    if (!t) return null;
    const a = instantiate(t, {
      name: o.name?.trim() || `${persona.name}'s ${t.name}`,
      avatar: persona.avatar,
      personaId: persona.id,
      look: o.look ?? persona.look,
      enabled: o.awake ?? true,
      ...(o.genre ? { genre: o.genre } : {}),
      ...(o.pipeline ? { pipeline: cleanPipeline(o.pipeline) } : {}),
      ...(o.place ? { place: o.place } : {}),
      ...(o.members?.length ? { members: o.members } : {}),
      ...(o.channels?.length ? { channels: o.channels } : {}),
    });
    this.hub.upsert(a);
    return a;
  }

  /** Replace an agent's path of nodes. Throws a readable error for unknown kinds. */
  setPipeline(agentId: string, nodes: unknown): Agent | null {
    const a = this.hub.agents().find((x) => x.id === agentId);
    if (!a) return null;
    const next = { ...a, pipeline: cleanPipeline(nodes) };
    this.hub.upsert(next);
    return next;
  }

  /** Run a single node of an agent on its own, to see what it would find. Nothing is sent or stored. */
  async testNode(agentId: string, node: NodeSpec) {
    const a = this.hub.agents().find((x) => x.id === agentId);
    if (!a) return null;
    const [clean] = cleanPipeline([{ ...node, enabled: true }]);
    const r = await runPipeline(
      { ...a, pipeline: [clean] },
      {
        offline: this.offline,
        owmKey: this.cfg.openWeatherKey,
        metricsFor: (x) => this.hub.metricsOf(x),
        callMcp: async (server, tool, args) => {
          if (!this.mcp.status().find((s) => s.id === server)?.connected) await this.mcp.connect(server);
          return this.mcp.callTool(server, tool, args);
        },
      },
    );
    return { items: r.items, result: r.results[0] };
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
  /**
   * A manual Run (the Run button). Its items go to the phones and Telegram at once, and the answer says what happened.
   * Scheduled runs (tick) do not come through here and keep the normal routes.
   */
  async runOne(id: string, opts: { deliverNow?: boolean } = {}) {
    const a = this.hub.agents().find((x) => x.id === id);
    if (!a) return null;
    const deliverNow = opts.deliverNow !== false;
    const signals = (await this.hub.runAgent(a, { deliverNow })).length;
    this.emit('run');
    const { delivery, ...detail } = this.hub.lastDetail(id);
    return { signals, ...detail, delivery: deliverNow ? { report: delivery ?? null, line: deliveryLine(delivery, detail.items) } : null };
  }

  // ---- feed and gateway -----------------------------------------------
  private feedFile = () => join(this.dir, 'feed.json');
  private readFeed(): FeedItem[] {
    try {
      return (JSON.parse(readFileSync(this.feedFile(), 'utf8')) as FeedItem[]).slice(0, FEED_MAX);
    } catch {
      return [];
    }
  }
  private saveFeed() {
    const tmp = this.feedFile() + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.feedItems));
    renameSync(tmp, this.feedFile());
  }
  feed = () => this.feedItems;

  /**
   * New items from agents: keep the newest 100 for the UI and pass them to the gateway for the phones.
   * A manual run (deliverNow) sends its items at once, with the current weather merged into one plain "now" item.
   * Returns what reached the phones and Telegram for a manual run.
   */
  async takeItems(items: FeedItem[], opts: { deliverNow?: boolean } = {}): Promise<DeliveryReport | undefined> {
    if (!items.length) return undefined;
    const have = new Set(this.feedItems.map((i) => i.id));
    const fresh = items.filter((i) => !have.has(i.id));
    if (fresh.length) {
      this.feedItems = [...fresh, ...this.feedItems].sort((a, b) => b.at - a.at).slice(0, FEED_MAX);
      this.saveFeed();
      this.emit('feed');
    }
    // the gateway keeps its own seen-list, so a repeat never reaches a phone twice (a manual run is the exception)
    try {
      if (opts.deliverNow) return (await this.gateway.dispatch(manualRunItems(items, Date.now()), { deliverNow: true })).report;
      await this.gateway.dispatch(items);
    } catch {
      /* delivery trouble is counted by the gateway; the run goes on */
    }
    return undefined;
  }
  setRoutes(routes: GatewayRoute[]) {
    this.gateway.setRoutes(routes);
    this.emit('group');
    return this.gateway.routes();
  }

  // ---- members and the group -------------------------------------------
  private ownerId = () => this.members.list().find((m) => m.role === 'adult')?.id ?? null;
  addMember(input: { name: string; role: MemberRole; healthName?: string; look?: Member['look'] }): Member {
    const m = this.members.add(this.ownerId(), input);
    this.emit('members');
    return m;
  }
  removeMember(id: string) {
    this.members.remove(this.ownerId(), id);
    this.emit('members');
  }
  updateMember(id: string, patch: Partial<Pick<Member, 'name' | 'role' | 'healthName' | 'look'>>) {
    const m = this.members.update(this.ownerId() ?? id, id, patch);
    this.emit('members');
    return m;
  }
  /** One-time invite for a member: a QR the member's phone scans to join with that member's role. */
  async invite(memberId: string) {
    if (!this.members.get(memberId)) throw new Error('No such member');
    const inv = this.members.createInvite(memberId);
    const q = await this.link.pairingQr({ invite: inv.code, gk: this.gk });
    return { code: inv.code, expiresAt: inv.expiresAt, qr: q.qr, payload: q.payload };
  }
  /** A pairing QR with no invite (for a phone that will be approved on the desktop afterwards). */
  pairingQr = () => this.link.pairingQr({ gk: this.gk });

  approveJoin(deviceId: string, role: MemberRole, name?: string): Member {
    const j = this.joins.find((x) => x.deviceId === deviceId);
    if (!j) throw new Error('No such join request');
    const m = this.members.add(this.ownerId(), { name: (name ?? j.name).trim() || 'Family member', role });
    const inv = this.members.createInvite(m.id);
    this.members.redeemInvite(inv.code, deviceId);
    this.joins = this.joins.filter((x) => x.deviceId !== deviceId);
    this.welcome(deviceId);
    this.emit('members');
    this.emit('group');
    return this.members.get(m.id) ?? m;
  }
  declineJoin(deviceId: string) {
    this.joins = this.joins.filter((x) => x.deviceId !== deviceId);
    this.emit('group');
  }

  private async sendBlobs(deviceId: string, blobs: string[]) {
    for (const b of blobs) {
      try {
        await this.link.sendToPhone(deviceId, b);
      } catch {
        /* an unreachable phone must not stop the others */
      }
    }
  }
  private sendWire(deviceId: string, msg: WireMessage) {
    return this.sendBlobs(deviceId, [encodeWire(msg, this.gk)]);
  }
  /** Tell a phone who is in the group and show it the recent chat. */
  private welcome(deviceId: string) {
    const me = this.members.byDevice(deviceId);
    void this.sendWire(deviceId, { t: 'members', members: this.members.exportPublic(), you: me?.id });
    for (const msg of this.members.recent(20)) void this.sendWire(deviceId, { t: 'chat', msg });
  }
  private fanOut(msg: GroupMessage, exceptDevice?: string) {
    for (const m of this.members.list()) if (m.deviceId && m.deviceId !== exceptDevice) void this.sendWire(m.deviceId, { t: 'chat', msg });
  }
  /** A message typed on the desktop, sent to everyone. */
  sendChat(text: string): GroupMessage {
    const owner = this.members.list().find((m) => m.role === 'adult');
    const msg: GroupMessage = { id: randomBytes(6).toString('hex'), from: owner?.id ?? 'hub', fromName: owner?.name ?? 'Desktop', text: text.trim().slice(0, 500), at: Date.now(), kind: 'text' };
    if (!msg.text) throw new Error('Message is empty');
    this.members.addMessage(msg);
    this.fanOut(msg);
    this.emit('group');
    return msg;
  }
  messages = (n = 200) => this.members.recent(n);

  // ---- messages from phones --------------------------------------------
  /** Handle one decoded message from a phone. Unknown phones can only say hello. */
  async onWire(deviceId: string, msg: WireMessage): Promise<void> {
    const me = this.members.byDevice(deviceId);
    switch (msg.t) {
      case 'hello': {
        if (msg.invite) {
          const joined = this.members.redeemInvite(msg.invite, deviceId);
          if (joined) {
            const note: GroupMessage = { id: randomBytes(6).toString('hex'), from: 'hub', fromName: 'Hub', text: `${joined.name} joined the family`, at: Date.now(), kind: 'agent' };
            this.members.addMessage(note);
            this.welcome(deviceId);
            this.fanOut(note, deviceId);
            this.emit('members');
            this.emit('group');
            return;
          }
        }
        if (me) {
          this.welcome(deviceId);
          return;
        }
        if (!this.joins.some((j) => j.deviceId === deviceId)) this.joins.push({ deviceId, name: String(msg.name ?? 'Someone').slice(0, 40), at: Date.now() });
        this.emit('group');
        return;
      }
      case 'chat': {
        if (!me || !msg.msg || typeof msg.msg.text !== 'string') return;
        const text = msg.msg.text.trim().slice(0, 500);
        if (!text) return;
        // who it is from comes from the paired device, never from what the phone claims
        const gm: GroupMessage = { id: randomBytes(6).toString('hex'), from: me.id, fromName: me.name, text, at: Date.now(), kind: 'text' };
        this.members.addMessage(gm);
        this.fanOut(gm, deviceId);
        this.emit('group');
        return;
      }
      case 'safe':
      case 'sos': {
        if (!me) return;
        const note = 'note' in msg && msg.note ? `: ${String(msg.note).slice(0, 200)}` : '';
        const gm: GroupMessage = {
          id: randomBytes(6).toString('hex'),
          from: me.id,
          fromName: me.name,
          text: msg.t === 'safe' ? `${me.name} is safe${note}` : `SOS from ${me.name}${note}`,
          at: Date.now(),
          kind: msg.t,
        };
        this.members.addMessage(gm);
        this.fanOut(gm, deviceId);
        if (msg.t === 'sos') {
          await this.takeItems([{ id: `sos-${gm.id}`, agentId: 'hub', agentName: 'Family', kind: 'alert', title: `SOS from ${me.name}`, body: gm.text, severity: 'severe', at: gm.at, tags: ['sos', 'notify'] }]);
        }
        this.emit('group');
        return;
      }
      case 'ask': {
        if (!me || typeof msg.text !== 'string' || !msg.text.trim()) return;
        const id = String(msg.id ?? randomBytes(6).toString('hex')).slice(0, 40);
        if (this.asks.some((a) => a.id === id)) return;
        this.asks = [{ id, memberId: me.id, name: me.name, text: msg.text.trim().slice(0, 500), at: Date.now(), status: 'pending' as const }, ...this.asks].slice(0, 50);
        this.emit('ask');
        if (me.role === 'adult' && this.cfg.allowAdultAsks) await this.answerAsk(id);
        return;
      }
      default:
        return;
    }
  }

  /** The desktop owner's decision on a question from a phone. */
  async decideAsk(id: string, answer: 'approve' | 'deny') {
    const a = this.asks.find((x) => x.id === id);
    if (!a || a.status !== 'pending') return false;
    if (answer === 'deny') {
      a.status = 'denied';
      const dev = this.members.get(a.memberId)?.deviceId;
      if (dev) await this.sendWire(dev, { t: 'answer', id, text: 'The desktop declined this question.', ok: false });
      this.emit('ask');
      return true;
    }
    await this.answerAsk(id);
    return true;
  }

  private async answerAsk(id: string) {
    const a = this.asks.find((x) => x.id === id);
    if (!a) return;
    a.status = 'running';
    this.emit('ask');
    let text = 'No assistant is connected on the desktop yet. Open Connections and pick one.';
    let ok = false;
    if (this.brain) {
      try {
        const sit = this.situation();
        const context = `Right now: ${sit.headline}. Latest: ${this.feedItems.slice(0, 3).map((i) => i.title).join('; ') || 'nothing new'}.`;
        text = (await this.brain(ASK_SYSTEM, `${context}\n\nQuestion from ${a.name}: ${a.text}`)).slice(0, 1200);
        ok = true;
      } catch (e) {
        text = `The assistant could not answer: ${e instanceof Error ? e.message : 'unknown error'}`;
      }
    }
    a.status = 'answered';
    a.answer = text;
    const dev = this.members.get(a.memberId)?.deviceId;
    if (dev) await this.sendWire(dev, { t: 'answer', id, text, ok });
    this.emit('ask');
  }

  // ---- talking to the relay ---------------------------------------------
  /** Read new mail from phones once. Returns how many messages were handled. */
  async pollInbox(): Promise<number> {
    const items = await this.link.inbox(this.cfg.inboxSince);
    let handled = 0;
    let newest = this.cfg.inboxSince;
    for (const it of items) {
      newest = Math.max(newest, it.at);
      if (!it.from.startsWith('phone:')) continue;
      const msg = decodeWire(it.blob, this.gk);
      if (!msg) continue;
      await this.onWire(it.from.slice('phone:'.length), msg);
      handled++;
    }
    if (newest !== this.cfg.inboxSince) {
      this.cfg.inboxSince = newest;
      this.writeCfg();
    }
    return handled;
  }
  /** Start listening for phones: register with the relay, then poll every few seconds. */
  async startRelay(everyMs = 8000) {
    this.stopRelay();
    try {
      await this.link.register();
    } catch {
      /* the server may be offline right now; polling keeps trying */
      this.relayWasDown = true;
    }
    this.telegramRelay.requestSync();
    const tick = () => {
      void this.gateway.flushDigests().then((r) => { if (r.flushed.length) this.emit('feed'); }).catch(() => {});
      void this.pollInbox().catch(() => {});
      void this.link.phones().then(
        (p) => {
          this.phonesPaired = p.length;
          this.relayBack();
        },
        () => {
          this.relayWasDown = true;
        },
      );
      if (this.telegramMode() === 'relay') void this.telegramRelay.tick();
    };
    tick();
    this.relayTimer = setInterval(tick, everyMs);
    this.relayTimer.unref?.();
  }
  stopRelay() {
    if (this.relayTimer) clearInterval(this.relayTimer);
    this.relayTimer = null;
  }
  /** The relay answered again after a failure: register once more, then let Telegram re-sync (token and chats). */
  private relayBack() {
    if (!this.relayWasDown) return;
    this.relayWasDown = false;
    void this.link.register().catch(() => {});
    this.telegramRelay.requestSync();
  }

  // ---- MCP ------------------------------------------------------------
  addMcp(spec: McpSpecInput) {
    const s = this.mcp.add(spec);
    this.emit('mcp');
    return s;
  }
  async removeMcp(id: string) {
    await this.mcp.remove(id);
    this.emit('mcp');
  }
  async updateMcp(id: string, patch: Parameters<McpClients['update']>[1]) {
    const s = await this.mcp.update(id, patch);
    this.emit('mcp');
    return s;
  }
  async connectMcp(id: string) {
    const r = await this.mcp.connect(id);
    this.emit('mcp');
    return r;
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
  /** Starts one polling link with the token. Throws if getMe fails; the supervisor decides what to do then. */
  private async startTelegram(token: string, onLost: (err: unknown) => void): Promise<string> {
    const link = new TelegramLink(token, this.cfg.telegram, (s) => {
      this.cfg.telegram = s;
      this.writeCfg();
    });
    const bot = await link.start(
      () => this.emit('run'),
      (err) => {
        if (this.telegram === link) this.telegram = null;
        onLost(err);
      },
    );
    this.telegram = link;
    this.addSender(link);
    return bot;
  }

  /**
   * Save a bot token entered in Connections and connect with it. The token is checked first: if Telegram refuses it,
   * the error says so and the saved token (if any) is kept. If Telegram cannot be reached, the token is saved and the
   * connection retries in the background. The token is never part of an error message.
   */
  async connectTelegram(input: string): Promise<TelegramStatus | RelayTelegramStatus> {
    const token = cleanTelegramToken(input);
    if (!token) throw new Error('Paste the bot token first.');
    if (!/^\d+:[A-Za-z0-9_-]{10,}$/.test(token)) throw new Error('That is not a bot token. It looks like 123456:ABC..., and @BotFather gives it to you.');
    // relay mode: the token goes to the relay, which checks it with Telegram; nothing is checked here
    if (this.telegramMode() === 'relay') return this.telegramRelay.connect(token);
    try {
      await this.telegramProbe(token);
    } catch (e) {
      const f = classifyTelegramError(e);
      if (f.kind === 'rejected') throw new Error(f.message);
      // no answer from Telegram: keep the token and let the supervisor retry
    }
    this.cfg.telegramToken = token;
    this.writeCfg();
    return this.telegramSup.connect(token);
  }
  /** The Retry button: connect again with the saved token (relay mode: sync with the relay now). */
  retryTelegram(): Promise<TelegramStatus | RelayTelegramStatus> {
    if (this.telegramMode() === 'relay') {
      this.telegramRelay.requestSync();
      return this.telegramRelay.sync();
    }
    return this.telegramSup.retryNow();
  }
  /** The Remove key button: forget the token (also on the relay in relay mode). Paired chats stay paired. */
  async removeTelegramToken() {
    if (this.telegramMode() === 'relay') {
      await this.telegramRelay.disconnect();
    } else {
      await this.telegramSup.forget();
      delete this.cfg.telegramToken;
      this.writeCfg();
    }
    return this.telegramInfo();
  }

  /** Where Telegram runs right now: the saved choice, else the default for the relay address. */
  telegramMode(): TelegramMode {
    return this.cfg.telegramMode ?? defaultTelegramMode(this.cfg.relayUrl);
  }

  /**
   * Switch where Telegram runs. The choice is saved. Switching keeps the saved token and the paired chats: going to the
   * relay uploads the token there; going back to direct removes it from the relay and connects this computer again.
   */
  async setTelegramMode(mode: TelegramMode): Promise<ReturnType<HubApp['telegramInfo']>> {
    if (mode !== 'relay' && mode !== 'direct') throw new Error('Telegram mode must be relay or direct.');
    const from = this.telegramMode();
    this.cfg.telegramMode = mode;
    this.writeCfg();
    if (from !== mode) await this.moveTelegram(mode);
    return this.telegramInfo();
  }

  /** Starts Telegram in the given mode and stops it in the other: senders, the local bot, and the relay's copy of the token. */
  private async moveTelegram(mode: TelegramMode): Promise<void> {
    const token = this.cfg.telegramToken;
    if (mode === 'relay') {
      await this.telegramSup.forget();
      this.addSender(this.telegramRelay);
      await this.telegramRelay.sync().catch(() => {});
    } else {
      this.senders.splice(0, this.senders.length, ...this.senders.filter((s) => s !== this.telegramRelay));
      await this.telegramRelay.unregister();
      if (token) void this.telegramSup.connect(token).catch(() => {});
    }
    this.emit('run');
  }

  /**
   * A pairing code to send to the bot with /start. Relay mode asks the relay for it; direct mode uses the local bot.
   * Throws a readable error when Telegram is not set up.
   */
  async pairingCode(): Promise<{ code: string; bot: string }> {
    if (this.telegramMode() === 'relay') return { code: await this.telegramRelay.pairingCode(), bot: this.telegramInfo().bot };
    if (!this.telegram) throw new Error('Telegram is not connected yet. Check the bot token, or press Retry now.');
    return { code: this.telegram.newPairingCode(), bot: '' };
  }

  /**
   * Send one test line to every paired chat. It goes through the outbox like any message, so the approval and the
   * audit log apply. Returns what happened, never the token.
   */
  async testTelegram(): Promise<{ ok: boolean; note: string }> {
    if (this.cfg.telegram.chats.length === 0) return { ok: false, note: 'No chat is paired yet. Get a pairing code and send it to the bot.' };
    const text = 'Beacon Hub test: if you can read this, Telegram alerts reach this chat.';
    const alert: Alert = { id: `test-${Date.now().toString(36)}`, severity: 'info', title: 'Telegram test', body: text, channels: ['telegram'], signals: [], at: Date.now(), status: 'pending-approval' };
    const done = await this.outbox.deliver(alert, text);
    return done.status === 'sent' ? { ok: true, note: 'Sent to your paired chats.' } : { ok: false, note: done.note ?? 'Telegram did not take the message.' };
  }

  /** A text message from a paired chat (relay mode). The one handler for chat text; nothing acts on it yet. */
  private onTelegramText(m: TelegramInbound) {
    this.telegramInbox = [m, ...this.telegramInbox].slice(0, 50);
  }

  telegramInfo() {
    const mode = this.telegramMode();
    const paired = this.cfg.telegram.chats.length;
    const saved = !!this.cfg.telegramToken;
    const hint = keyHint(this.cfg.telegramToken);
    if (mode === 'relay') {
      const s = this.telegramRelay.status;
      return {
        mode,
        state: s.state,
        connected: s.state === 'connected',
        bot: s.state === 'connected' ? s.bot : '',
        message: 'message' in s ? s.message : '',
        attempt: 0,
        paired,
        saved,
        hint,
        chats: this.telegramRelay.chatList(),
      };
    }
    const s = this.telegramSup.status;
    return {
      mode,
      state: s.state,
      connected: s.state === 'connected',
      bot: s.state === 'connected' ? s.bot : '',
      message: s.state === 'reconnecting' || s.state === 'rejected' || s.state === 'unreachable' ? s.message : '',
      attempt: s.state === 'reconnecting' ? s.attempt : 0,
      paired,
      saved,
      hint,
      chats: this.cfg.telegram.chats.map((id) => ({ id, name: '' })),
    };
  }

  /** Where the hub stands right now: calm, watch, alert or recovering. */
  situation(now = Date.now()): Situation {
    return computeSituation({ alerts: this.hub.alerts(), runs: this.hub.runs(), now, agents: this.hub.agents() });
  }

  state() {
    return {
      situation: this.situation(),
      agents: this.hub.agents(),
      templates: TEMPLATES,
      personas: PERSONAS,
      runs: this.hub.runs().slice(-50).reverse(),
      alerts: this.hub.alerts().slice(-30).reverse(),
      audit: this.audit.read(50).reverse(),
      connections: {
        telegram: this.telegramInfo(),
        beacon: { paired: this.phonesPaired, relayUrl: this.cfg.relayUrl },
        brain: this.brainInfo(),
        haiku: this.haiku(),
        openWeather: this.openWeatherInfo(),
      },
      pending: this.pending,
      members: this.health.members(),
      feed: this.feedItems,
      group: {
        members: this.members.list(),
        messages: this.members.recent(200),
        pendingJoins: this.joins,
        asks: this.asks,
        allowAdultAsks: this.cfg.allowAdultAsks,
      },
      gateway: { routes: this.gateway.routes(), digests: this.gateway.digestStatus() },
      mcp: { servers: this.mcp.list(), status: this.mcp.status(), tools: this.mcp.tools() },
      nodeKinds: NODE_KINDS,
    };
  }
}
