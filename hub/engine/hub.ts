import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { healthMetrics } from './healthMetrics.ts';
import type { HealthStore } from './healthStore.ts';
import { combine, emptyState, plainText } from './orchestrator.ts';
import type { OrchestratorState } from './orchestrator.ts';
import { Outbox } from './outbox.ts';
import { personaById } from './personas.ts';
import { evaluateAgent } from './rules.ts';
import { sampleMetrics } from './sample.ts';
import { fetchMetrics } from './sources.ts';
import type { Agent, Alert, FeedItem, Metrics, NodeRunResult, Persona, RunLogEntry, Signal, SourceOptions } from './types.ts';

interface Persisted {
  agents: Agent[];
  orch: OrchestratorState;
  lastFired: Record<string, number>;
  runs: RunLogEntry[];
  alerts: Alert[];
}

export interface HubOptions {
  dir: string;
  health: HealthStore;
  outbox: Outbox;
  source?: SourceOptions;
  /** Optional wording pass (Haiku). Gets the deterministic text and facts; must return short plain text or null. */
  rewrite?: (alert: Alert, fallback: string, persona?: Persona) => Promise<string | null>;
  now?: () => number;
  /** Runs an agent's node pipeline (sources and filters). Absent = agents only use their rules. */
  pipeline?: (agent: Agent) => Promise<{ items: FeedItem[]; results: NodeRunResult[] }>;
  /** Where items found by pipelines (and alerts turned into items) go: the feed and the gateway. */
  onItems?: (items: FeedItem[]) => void | Promise<void>;
}

/** Owns the agents, runs them on their timers, combines their signals and hands alerts to the outbox. */
export class Hub {
  private d: Persisted;
  private file: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastRun: Record<string, number> = {};
  private detail: Record<string, { items: number; results: NodeRunResult[] }> = {};
  private now: () => number;

  constructor(private o: HubOptions) {
    mkdirSync(o.dir, { recursive: true });
    this.file = join(o.dir, 'hub.json');
    this.now = o.now ?? Date.now;
    this.d = existsSync(this.file)
      ? { agents: [], orch: emptyState(), lastFired: {}, runs: [], alerts: [], ...(JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Persisted>) }
      : { agents: [], orch: emptyState(), lastFired: {}, runs: [], alerts: [] };
  }

  private save() {
    this.d.runs = this.d.runs.slice(-300);
    this.d.alerts = this.d.alerts.slice(-100);
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.d));
    renameSync(tmp, this.file);
  }

  agents = () => this.d.agents;
  runs = () => this.d.runs;
  alerts = () => this.d.alerts;

  upsert(a: Agent) {
    const i = this.d.agents.findIndex((x) => x.id === a.id);
    if (i >= 0) this.d.agents[i] = a;
    else this.d.agents.push(a);
    this.save();
  }

  remove(id: string) {
    this.d.agents = this.d.agents.filter((a) => a.id !== id);
    this.save();
  }

  /** What the last run of an agent found, for the UI. */
  lastDetail = (id: string) => this.detail[id] ?? { items: 0, results: [] };

  /** The readings the rules of an agent look at (also used by weather, air and quake nodes). */
  metricsOf = (a: Agent) => this.metricsFor(a);

  private async metricsFor(a: Agent): Promise<Metrics> {
    const net = a.watch.filter((k) => k !== 'health' && k !== 'schedule' && k !== 'supply');
    const m: Metrics = { ...(net.length ? await fetchMetrics(net, a.place, this.o.source) : {}) };
    if (a.watch.includes('health')) Object.assign(m, healthMetrics(this.o.health, a.members ?? [], this.now()));
    // supply / schedule have no live feed yet: use the user's own numbers when present, sample otherwise only in offline mode
    if (this.o.source?.offline) {
      const sample = sampleMetrics(a.watch, a.members);
      for (const [k, v] of Object.entries(sample)) if (!(k in m)) m[k] = v;
    }
    return m;
  }

  /** Run one agent now. Returns the signals; does not send anything. */
  async runAgent(a: Agent): Promise<Signal[]> {
    const at = this.now();
    this.lastRun[a.id] = at;
    try {
      const m = await this.metricsFor(a);
      const member = a.members?.[0] ?? 'your family';
      // {member} is not a reading, so name the person before the rules render their messages
      const named = { ...a, rules: a.rules.map((r) => ({ ...r, message: r.message.replaceAll('{member}', member) })) };
      const signals = evaluateAgent(named, m, at, this.d.lastFired);
      for (const s of signals) this.d.lastFired[s.ruleId] = at;
      let found = '';
      this.detail[a.id] = { items: 0, results: [] };
      if (a.pipeline?.length && this.o.pipeline) {
        try {
          const r = await this.o.pipeline(a);
          this.detail[a.id] = { items: r.items.length, results: r.results };
          const failed = r.results.filter((x) => !x.ok).length;
          found = `${r.items.length} item(s) from ${r.results.length} node(s)${failed ? `, ${failed} failed` : ''}`;
          if (r.items.length) await this.o.onItems?.(r.items);
        } catch (e) {
          found = `nodes failed: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      const said = signals.length ? `${signals.length} signal(s)` : 'nothing to report';
      this.d.runs.push({ at, agentId: a.id, ok: true, message: found ? `${said}; ${found}` : said, metrics: m, signals: signals.length });
      return signals;
    } catch (e) {
      this.d.runs.push({ at, agentId: a.id, ok: false, message: e instanceof Error ? e.message : String(e) });
      return [];
    }
  }

  /** One pass over every enabled agent that is due (or all when `force`). */
  async tick(force = false): Promise<Alert[]> {
    const at = this.now();
    const due = this.d.agents.filter((a) => a.enabled && (force || at - (this.lastRun[a.id] ?? 0) >= a.everyMin * 60_000));
    const signals = (await Promise.all(due.map((a) => this.runAgent(a)))).flat();
    const channels = [...new Set(due.flatMap((a) => a.channels))];
    const { alerts, state } = combine(signals, this.d.orch, channels, at);
    this.d.orch = state;
    const out: Alert[] = [];
    for (const al of alerts) {
      const base = plainText(al);
      // the loudest signal's agent speaks: its persona sets the voice and the sign-off
      const speaker = personaById(this.d.agents.find((a) => a.id === al.signals[0]?.agentId)?.personaId);
      let text = base;
      try {
        text = (await this.o.rewrite?.(al, base, speaker)) ?? base;
      } catch {
        /* keep the plain wording */
      }
      if (speaker) text = `${text} - ${speaker.signature}`;
      const done = await this.o.outbox.deliver(al, text.slice(0, 400));
      this.d.alerts.push(done);
      out.push(done);
      // phones that follow the feed get the alert too, through the gateway's routes
      try {
        await this.o.onItems?.([alertToFeed(done, text)]);
      } catch {
        /* a feed problem must not stop the alert loop */
      }
    }
    this.save();
    return out;
  }

  start(everyMs = 60_000) {
    this.stop();
    this.timer = setInterval(() => void this.tick(), everyMs);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

const KIND_BY_TAG: Array<[string, FeedItem['kind']]> = [
  ['health', 'health'],
  ['quake', 'quake'],
  ['flood', 'flood'],
  ['wind', 'wind'],
  ['weather', 'weather'],
  ['supply', 'supply'],
];

/** An alert the hub sent (or declined to send), as a feed item for the phones. */
export function alertToFeed(al: Alert, text: string): FeedItem {
  const tags = [...new Set(al.signals.flatMap((s) => s.tags))];
  const kind = KIND_BY_TAG.find(([t]) => tags.includes(t))?.[1] ?? 'alert';
  const first = al.signals[0];
  return {
    id: `alert-${al.id}`,
    agentId: first?.agentId ?? 'hub',
    agentName: first?.agentName ?? 'Hub',
    kind,
    title: al.title,
    body: text.split(/\s+/).slice(0, 60).join(' '),
    severity: al.severity,
    at: al.at,
    tags,
  };
}
