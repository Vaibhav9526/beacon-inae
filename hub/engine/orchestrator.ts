import { SEVERITY_RANK } from './types.ts';
import type { Alert, Channel, Severity, Signal } from './types.ts';

export interface OrchestratorState {
  /** fingerprint -> last time an alert for it went out */
  sent: Record<string, number>;
  /** last severity sent per fingerprint, so a rise in severity breaks the quiet period */
  sentSeverity: Record<string, Severity>;
}

export const emptyState = (): OrchestratorState => ({ sent: {}, sentSeverity: {} });

const QUIET_MS = 3 * 60 * 60 * 1000;

const worst = (xs: Severity[]): Severity => xs.reduce((a, b) => (SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a), 'info' as Severity);

/** Signals that share a tag-cluster (same place + hazard family) are one story. */
function clusterKey(s: Signal): string {
  const place = s.fingerprint.split(':')[1] ?? 'home';
  const family = s.tags.includes('health') ? 'health' : 'hazard';
  return `${family}:${place}`;
}

/**
 * Turn the signals of one run into at most one alert per cluster: drop anything already told recently
 * (unless it got worse), merge the rest, pick the severity, and write a short message.
 * Pure: the caller stores the returned state.
 */
export function combine(signals: Signal[], state: OrchestratorState, channels: Channel[], now: number): { alerts: Alert[]; state: OrchestratorState } {
  const next: OrchestratorState = { sent: { ...state.sent }, sentSeverity: { ...state.sentSeverity } };
  const fresh = signals.filter((s) => {
    const last = state.sent[s.fingerprint];
    if (last === undefined || now - last > QUIET_MS) return true;
    return SEVERITY_RANK[s.severity] > SEVERITY_RANK[state.sentSeverity[s.fingerprint] ?? 'info'];
  });

  const groups = new Map<string, Signal[]>();
  for (const s of fresh) groups.set(clusterKey(s), [...(groups.get(clusterKey(s)) ?? []), s]);

  const alerts: Alert[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
    const severity = worst(sorted.map((s) => s.severity));
    // identical bodies from different agents are one line
    const lines = [...new Set(sorted.map((s) => s.body.trim()))];
    const body = lines.join(' ').slice(0, 320);
    alerts.push({
      id: `${now.toString(36)}-${alerts.length}`,
      severity,
      title: sorted[0].title,
      body,
      channels,
      signals: sorted,
      at: now,
      status: 'pending-approval',
    });
    for (const s of sorted) {
      next.sent[s.fingerprint] = now;
      next.sentSeverity[s.fingerprint] = s.severity;
    }
  }
  alerts.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  return { alerts, state: next };
}

/** Plain deterministic wording for an alert; the Haiku writer may replace it, never the facts. */
export function plainText(a: Alert): string {
  const tag = a.severity === 'severe' ? 'Urgent' : a.severity === 'warning' ? 'Warning' : a.severity === 'watch' ? 'Heads up' : 'Note';
  return `${tag}: ${a.body}`;
}
