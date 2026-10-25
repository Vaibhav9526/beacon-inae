// Community road status: how much to trust a mesh road report, which reports are still live, and what they cost a route.
// Pure (no react-native, no store) so it runs in node tests and inside the routing code.
// Limits: the attester count is what the mesh reports; fake nodes can inflate it. Reports are points, not road names.
import type { RoadEvent, RoadStatus } from '../mesh/appTypes';

export type TrustLevel = 'low' | 'medium' | 'high';
export interface Trust {
  level: TrustLevel;
  /** 0..1: base trust for the level, halved every half-life; 0 once the report is older than 24 hours */
  weight: number;
}
export type ObstacleStatus = Exclude<RoadStatus, 'clear'>;
export interface Obstacle {
  lat: number;
  lon: number;
  status: ObstacleStatus;
  weight: number;
  id: string;
  attesters: number;
  /** trust level when known; left out means 'medium' */
  level?: TrustLevel;
}
export interface RoutePenalty {
  /** the road must not be used at all */
  impassable: boolean;
  /** extra cost in minutes at the speed of the travel mode, when it is not impassable */
  minutes: number;
}

export const HOUR_MS = 3600_000;
export const MAX_AGE_MS = 24 * HOUR_MS;
/** A clear report only cancels an older problem within this distance. */
export const CLEAR_RADIUS_M = 300;
export const DEFAULT_MIN_WEIGHT = 0.15;

const HALF_LIFE_H: Record<RoadStatus, number> = { flooded: 3, blocked: 6, damaged: 6, crowded: 1, clear: 6 };
const BASE: Record<TrustLevel, number> = { high: 1, medium: 0.7, low: 0.4 };

const RAD = Math.PI / 180;
function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(q)));
}

export const levelOf = (ev: Pick<RoadEvent, 'attesters' | 'verified'>): TrustLevel => (ev.verified || ev.attesters >= 2 ? 'high' : ev.attesters === 1 ? 'medium' : 'low');

/** Trust in one report right now. Older than 24 hours (or dated in the far future) means weight 0. */
export function trustOf(ev: RoadEvent, now: number): Trust {
  const level = levelOf(ev);
  const age = now - ev.report.seenAt;
  if (!Number.isFinite(age) || age > MAX_AGE_MS) return { level, weight: 0 };
  const hours = Math.max(0, age) / HOUR_MS;
  return { level, weight: BASE[level] * Math.pow(0.5, hours / HALF_LIFE_H[ev.report.status]) };
}

const rank = (l: TrustLevel) => (l === 'high' ? 2 : l === 'medium' ? 1 : 0);

/**
 * Live problems after the rules: reports older than 24 h drop out, a newer 'clear' within 300 m cancels an older problem
 * (when the clear has medium trust or better, or comes from the same sender), and faded reports (weight below minWeight) drop out.
 * Low-trust reports stay in the list so the map can draw them; routing treats them softly (see routePenalty).
 */
export function activeObstacles(roads: RoadEvent[], now: number, opts: { minWeight?: number } = {}): Obstacle[] {
  const minWeight = opts.minWeight ?? DEFAULT_MIN_WEIGHT;
  const live = roads
    .map((ev) => ({ ev, trust: trustOf(ev, now) }))
    .filter((x) => x.trust.weight > 0);
  const clears = live.filter((x) => x.ev.report.status === 'clear');
  const out: Obstacle[] = [];
  const seen = new Set<string>();
  for (const { ev, trust } of live) {
    const r = ev.report;
    if (r.status === 'clear' || trust.weight < minWeight || seen.has(r.id)) continue;
    const cancelled = clears.some(
      (c) => c.ev.report.seenAt > r.seenAt && metres(c.ev.report, r) <= CLEAR_RADIUS_M && (c.ev.from === ev.from || rank(c.trust.level) >= 1),
    );
    if (cancelled) continue;
    seen.add(r.id);
    out.push({ lat: r.lat, lon: r.lon, status: r.status, weight: trust.weight, id: r.id, attesters: ev.attesters, level: trust.level });
  }
  return out;
}

/** The share of the base weight left after ageing: 1 when fresh, towards 0 as it fades. */
const freshness = (o: Obstacle) => Math.min(1, o.weight / BASE[o.level ?? 'medium']);

/**
 * What each obstacle costs a route in the given mode (same order as the input).
 * blocked + high trust: impassable while fresh (decay under half, it becomes a 20 minute penalty); blocked + medium: +10 minutes.
 * flooded + high trust: impassable for driving, +8 minutes walking; medium: +10 driving, +4 walking.
 * damaged +3 minutes, crowded +2 minutes. A low-trust report costs half of the medium figure and is never impassable.
 * Every figure fades with the report's age.
 */
export function routePenalty(obstacles: Obstacle[], mode: 'walk' | 'drive' = 'walk'): RoutePenalty[] {
  return obstacles.map((o) => {
    const level = o.level ?? 'medium';
    const f = freshness(o);
    const soft = level === 'low' ? 0.5 : 1;
    const fresh = f >= 0.5;
    let impassable = false;
    let minutes = 0;
    switch (o.status) {
      case 'blocked':
        if (level === 'high') {
          if (fresh) impassable = true;
          else minutes = 20 * f;
        } else minutes = 10 * soft * f;
        break;
      case 'flooded':
        if (level === 'high') {
          if (mode === 'drive') {
            if (fresh) impassable = true;
            else minutes = 15 * f;
          } else minutes = 8 * f;
        } else minutes = (mode === 'drive' ? 10 : 4) * soft * f;
        break;
      case 'damaged':
        minutes = 3 * soft * f;
        break;
      case 'crowded':
        minutes = 2 * soft * f;
        break;
    }
    return { impassable, minutes };
  });
}
