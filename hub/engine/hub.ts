import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { healthMetrics } from './healthMetrics.ts';
import type { HealthStore } from './healthStore.ts';
import { combine, emptyState, plainText } from './orchestrator.ts';
import type { OrchestratorState } from './orchestrator.ts';
import { Outbox } from './outbox.ts';
import { evaluateAgent } from './rules.ts';
import { sampleMetrics } from './sample.ts';
import { fetchMetrics } from './sources.ts';
import type { Agent, Alert, Metrics, RunLogEntry, Signal, SourceOptions } from './types.ts';

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
  rewrite?: (alert: Alert, fallback: string) => Promise<string | null>;
  now?: () => number;
}

/** Owns the agents, runs them on their timers, combines their signals and hands alerts to the outbox. */
export class Hub {
  private d: Persisted;
  private file: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastRun: Record<string, number> = {};
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
      this.d.runs.push({ at, agentId: a.id, ok: true, message: signals.length ? `${signals.length} signal(s)` : 'nothing to report', metrics: m, signals: signals.length });
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
      let text = base;
      try {
        text = (await this.o.rewrite?.(al, base)) ?? base;
      } catch {
        /* keep the plain wording */
      }
      const done = await this.o.outbox.deliver(al, text.slice(0, 400));
      this.d.alerts.push(done);
      out.push(done);
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
