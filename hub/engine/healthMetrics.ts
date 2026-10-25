// Turns the newest fresh health readings into flat metrics for agent rules.

import type { HealthStore } from './healthStore.ts';
import type { Metrics } from './types.ts';

/** 0 ok, 1 attention, 2 urgent. */
function statusOf(hr: number | undefined, spo2: number | undefined): number {
  if ((hr !== undefined && hr > 120) || (spo2 !== undefined && spo2 < 90)) return 2;
  if ((hr !== undefined && (hr > 100 || hr < 45)) || (spo2 !== undefined && spo2 < 94)) return 1;
  return 0;
}

/**
 * Metrics for each listed member: hr:<m>, spo2:<m>, steps:<m>, sleep_h:<m>, health_status:<m>.
 * Members with no fresh data are omitted. Fields absent from the latest merged reading are omitted too.
 */
export function healthMetrics(store: HealthStore, members: string[], now: number = Date.now()): Metrics {
  const out: Metrics = {};
  for (const m of members) {
    const r = store.latest(m, now);
    if (!r) continue;
    if (r.hr !== undefined) out[`hr:${m}`] = r.hr;
    if (r.spo2 !== undefined) out[`spo2:${m}`] = r.spo2;
    if (r.steps !== undefined) out[`steps:${m}`] = r.steps;
    if (r.sleepHours !== undefined) out[`sleep_h:${m}`] = r.sleepHours;
    out[`health_status:${m}`] = statusOf(r.hr, r.spo2);
  }
  return out;
}
