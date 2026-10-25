import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BeaconLink } from './beaconLink.ts';
import { anthropicBrain, cliBrain, haikuWriter, ruleFromText } from './brains.ts';
import type { Brain } from './brains.ts';
import { parseHealthCsv } from './csvImport.ts';
import { Gateway } from './gateway.ts';
import { HealthStore, newKey } from './healthStore.ts';
import { Hub } from './hub.ts';
import { McpClients } from './mcpClients.ts';
import type { McpSpecInput } from './mcpClients.ts';
import { Members } from './members.ts';
import { cleanPipeline, NODE_KINDS } from './nodeCatalog.ts';
import { runPipeline } from './nodes.ts';
import { AuditLog, Outbox } from './outbox.ts';
import type { Sender } from './outbox.ts';
import { PERSONAS, personaById } from './personas.ts';
import { computeSituation } from './situation.ts';
import type { Situation } from './situation.ts';
import { instantiate, templateById, TEMPLATES } from './templates.ts';
import { TelegramLink } from './telegram.ts';
import type { TelegramState } from './telegram.ts';
import type { Agent, Alert, Channel, FeedItem, GatewayRoute, GroupMessage, Member, MemberRole, NodeSpec, WireMessage } from './types.ts';
import { chunkFeed, decodeWire, encodeWire, newGroupKey } from './wire.ts';

interface Config {
  brain: 'none' | 'claude' | 'codex' | 'gemini' | 'api';
  allowed: Channel[];
  telegram: TelegramState;
  telegramToken?: string;
  anthropicKey?: string;
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

  constructor(opts: { dir?: string; offline?: boolean; extraSenders?: Sender[]; interactive?: boolean; link?: BeaconLink } = {}) {
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
      sendTelegram: async (text) => {
        const alert: Alert = { id: `feed-${Date.now().toString(36)}`, severity: 'warning', title: 'Feed', body: text, channels: ['telegram'], signals: [], at: Date.now(), status: 'pending-approval' };
        await this.outbox.deliver(alert, text);
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
      onItems: (items) => this.takeItems(items),
    });
    this.setBrain(this.cfg.brain, this.cfg.anthropicKey);
    if (this.cfg.telegramToken) void this.connectTelegram(this.cfg.telegramToken).catch(() => {});
  }

  // ---- config ---------------------------------------------------------
  private cfgFile = () => join(this.dir, 'secrets.json');
  private readCfg(): Config {
    const base: Config = { brain: 'none', allowed: [], telegram: { chats: [] }, relayUrl: process.env.BEACON_SERVER ?? 'http://127.0.0.1:8787', allowAdultAsks: false, inboxSince: 0 };
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
  /**
   * Save the Beacon server address the hub talks to (phones pair and get alerts through it). Must be an http or https
   * address. Trailing slashes and any query or fragment are dropped. Takes effect at once.
   */
  setRelayUrl(input: string): string {
    const url = cleanRelayUrl(input);
    this.cfg.relayUrl = url;
    this.writeCfg();
    this.link.setUrl(url);
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
  async runOne(id: string) {
    const a = this.hub.agents().find((x) => x.id === id);
    if (!a) return null;
    const signals = (await this.hub.runAgent(a)).length;
    this.emit('run');
    return { signals, ...this.hub.lastDetail(id) };
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

  /** New items from agents: keep the newest 100 for the UI and pass them to the gateway for the phones. */
  async takeItems(items: FeedItem[]): Promise<void> {
    if (!items.length) return;
    const have = new Set(this.feedItems.map((i) => i.id));
    const fresh = items.filter((i) => !have.has(i.id));
    if (fresh.length) {
      this.feedItems = [...fresh, ...this.feedItems].sort((a, b) => b.at - a.at).slice(0, FEED_MAX);
      this.saveFeed();
      this.emit('feed');
    }
    // the gateway keeps its own seen-list, so a repeat never reaches a phone twice
    try {
      await this.gateway.dispatch(items);
    } catch {
      /* delivery trouble is counted by the gateway; the run goes on */
    }
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
    }
    const tick = () => {
      void this.pollInbox().catch(() => {});
      void this.link.phones().then((p) => (this.phonesPaired = p.length)).catch(() => {});
    };
    tick();
    this.relayTimer = setInterval(tick, everyMs);
    this.relayTimer.unref?.();
  }
  stopRelay() {
    if (this.relayTimer) clearInterval(this.relayTimer);
    this.relayTimer = null;
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
      gateway: { routes: this.gateway.routes() },
      mcp: { servers: this.mcp.list(), status: this.mcp.status(), tools: this.mcp.tools() },
      nodeKinds: NODE_KINDS,
    };
  }
}
