import { SEVERITY_RANK } from './types.ts';
import type { Agent, Alert, RunLogEntry, Severity, Signal } from './types.ts';

/** One line for the whole hub: is anything happening near the family right now, and what to do about it. */
export type Phase = 'calm' | 'watch' | 'alert' | 'recovering';

export interface Situation {
  phase: Phase;
  /** 0 calm, 1 watch (or recovering), 2 watch with a warning in it, 3 alert */
  level: 0 | 1 | 2 | 3;
  /** ms since epoch: when this phase began (calm: when the last alert went out, 0 if none) */
  since: number;
  headline: string;
  reasons: string[];
  actions: string[];
}

export interface SituationInput {
  alerts: Alert[];
  runs: RunLogEntry[];
  now: number;
  agents: Agent[];
}

const HOUR = 3_600_000;
const WINDOW_MS = 3 * HOUR;
const RECOVERY_MS = 72 * HOUR;
/** Alerts that actually went out or are waiting for the person to approve. Failed and suppressed ones do not count. */
const LIVE: ReadonlySet<Alert['status']> = new Set<Alert['status']>(['sent', 'pending-approval']);
const HAZARD_TAGS = ['health', 'quake', 'heat', 'flood', 'air'] as const;

const ACTIONS: Record<string, string[]> = {
  heat: ['Move to a cool room and drink water.', 'Check on elders and anyone on heart medicine.', 'Stay out of the sun until evening.'],
  quake: ['Drop, cover and hold on if shaking starts.', 'Keep away from windows and heavy shelves.', 'Check for gas smell and damage once shaking stops.'],
  flood: ['Move to higher ground now if water is rising.', 'Keep documents and the go-bag in a dry bag.', 'Never walk or drive through flood water.'],
  air: ['Keep windows shut and wear a mask outdoors.', 'Keep children and elders indoors.', 'Run an air purifier if you have one.'],
  health: ['Call a doctor or 112 if breathing is hard.', 'Check on the family member flagged in the alert.', 'Keep the medicine list and doses handy.'],
};
const DEFAULT_ACTIONS: Record<Phase, string[]> = {
  alert: ['Follow instructions from local authorities.', 'Keep your phone charged and tell family where you are.'],
  watch: ['Follow instructions from local authorities.', 'Keep your phone charged and check the hub again soon.'],
  recovering: ['Check in with family and neighbours.', 'Keep documents, medicines and water together.'],
  calm: ['Keep the go-bag and a week of water and medicine ready.'],
};

/** Turns the first sentence of an alert title into a bare phrase, falling back when it is empty. */
function phrase(text: string, fallback: string): string {
  const first = (text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] ?? '';
  const core = first.replace(/[.!?:;\s]+$/, '');
  return core || fallback;
}

function newestFirst(xs: Alert[]): Alert[] {
  return [...xs].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.at - a.at);
}

/**
 * Pure: reads the alert log, the run log and the agents, and says which phase the hub is in.
 * Alert: a severe alert, or two distinct warning-level fingerprints, in the last 3 hours.
 * Watch: any watch or warning alert in the last 3 hours.
 * Recovering: 72 hours after the last severe or warning alert, once nothing new arrived in the last 3 hours.
 * Otherwise calm. Never throws on odd input: missing fields are skipped.
 */
export function computeSituation(input: SituationInput): Situation {
  const { alerts, runs, now, agents } = input;
  const live = alerts.filter((a) => LIVE.has(a.status) && Number.isFinite(a.at) && a.at <= now);
  const recent = live.filter((a) => now - a.at <= WINDOW_MS);
  const severe = recent.filter((a) => a.severity === 'severe');
  const warnFps = new Set<string>();
  for (const a of recent) for (const s of a.signals ?? []) if (s.severity === 'warning') warnFps.add(s.fingerprint);
  const watchish = recent.filter((a) => a.severity === 'watch' || a.severity === 'warning');
  const warnings = recent.filter((a) => a.severity === 'warning');
  const failedRuns = runs.filter((r) => !r.ok && now - r.at <= WINDOW_MS && r.at <= now);
  const enabled = agents.filter((a) => a.enabled).length;
  const lastSerious = live
    .filter((a) => a.severity === 'severe' || a.severity === 'warning')
    .reduce<Alert | null>((best, a) => (!best || a.at > best.at ? a : best), null);
  const top = newestFirst(recent)[0];

  let phase: Phase;
  let level: Situation['level'];
  let since: number;
  const reasons: string[] = [];

  if (severe.length > 0 || warnFps.size >= 2) {
    phase = 'alert';
    level = 3;
    const contributing = recent.filter((a) => a.severity === 'severe' || (a.signals ?? []).some((s) => s.severity === 'warning'));
    since = Math.min(...contributing.map((a) => a.at));
    if (severe.length) reasons.push(`${severe.length} severe alert${severe.length > 1 ? 's' : ''} in the last 3 hours`);
    if (warnFps.size >= 2) reasons.push(`${warnFps.size} separate warnings in the last 3 hours`);
  } else if (watchish.length > 0) {
    phase = 'watch';
    level = warnings.length > 0 ? 2 : 1;
    since = Math.min(...watchish.map((a) => a.at));
    reasons.push(`${watchish.length} heads-up alert${watchish.length > 1 ? 's' : ''} in the last 3 hours`);
  } else if (lastSerious && now - lastSerious.at <= RECOVERY_MS && recent.length === 0) {
    phase = 'recovering';
    level = 1;
    since = lastSerious.at;
    const hours = Math.floor((now - lastSerious.at) / HOUR);
    reasons.push(`Last serious alert ${hours} h ago; the recovery window is open`);
  } else {
    phase = 'calm';
    level = 0;
    since = live.length ? Math.max(...live.map((a) => a.at)) : 0;
    reasons.push('No serious alerts in the last 3 hours');
  }

  if (failedRuns.length) reasons.push(`${failedRuns.length} agent check${failedRuns.length > 1 ? 's' : ''} failed in the last 3 hours`);
  if (enabled === 0) reasons.push('No agent is awake, so nothing is being watched');

  // Actions come from the loudest signal that carries a hazard tag; otherwise the phase default.
  const signals: Signal[] = recent
    .flatMap((a) => a.signals ?? [])
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.at - a.at);
  let hazard: string | undefined;
  for (const s of signals) {
    hazard = HAZARD_TAGS.find((t) => (s.tags ?? []).includes(t));
    if (hazard) break;
  }
  const actions = ((phase === 'alert' || phase === 'watch') && hazard ? ACTIONS[hazard] : DEFAULT_ACTIONS[phase]).slice(0, 3);

  let headline: string;
  if (phase === 'alert') headline = `Act now: ${phrase(top?.title ?? '', 'follow the instructions for the alert')}.`;
  else if (phase === 'watch') headline = `Heads up: ${phrase(top?.title ?? '', 'an alert is active nearby')}.`;
  else if (phase === 'recovering') headline = 'The alert has passed, so check in with family and keep recovery steps going.';
  else headline = 'All quiet: nothing needs your attention right now.';

  return { phase, level, since, headline, reasons, actions: [...actions] };
}
