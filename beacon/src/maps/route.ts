// Road routing on a saved OpenStreetMap area. Pure: no react-native imports, so the same code runs in node tests.
// The road graph is built once per area object (cached in a WeakMap) and reused for every route.
// Limits: no one-way rules, no turn restrictions, no speed limits; only roads inside the saved radius exist.
import { distanceKm } from '../alerts/sources';
import { type Obstacle, type RoutePenalty, routePenalty } from '../services/roadStatus';
import { type OfflineArea, type RoadClass, bearingDeg, compassWord, vertexKey } from './osm';

export type Mode = 'walk' | 'drive';
export interface Ll {
  lat: number;
  lon: number;
}
export interface RouteResult {
  /** real start, snapped start, road nodes..., snapped end, real end */
  points: Ll[];
  distanceM: number;
  minutes: number;
  snappedStartM: number;
  snappedEndM: number;
  /** distance plus the penalty of reported problems, in metres: what the search minimised */
  costM: number;
  /** reported problems the route goes around or pays a penalty to avoid */
  avoided: number;
  /** reported problems that lie on this route */
  blockedAhead: Obstacle[];
  /** true when avoiding every closed road was impossible and this route ignores the penalties */
  unsafe: boolean;
}
export interface RoadRoute {
  roadM: number;
  minutes: number;
  points: Ll[];
  costM?: number;
  avoided?: number;
  blockedAhead?: Obstacle[];
  unsafe?: boolean;
}
export interface AvoidOptions {
  obstacles: Obstacle[];
}
export interface RouteOption<T extends Ll> {
  place: T;
  straightM: number;
  road: RoadRoute | null;
}
export interface Leg {
  compass: string;
  bearing: number;
  meters: number;
  /** how to turn from this leg into the next one; null on the last leg */
  turn: 'left' | 'right' | 'around' | null;
}

/** Walking 4.8 km/h. Driving 25 km/h (city average). */
const SPEED_M_PER_MIN: Record<Mode, number> = { walk: 4800 / 60, drive: 25000 / 60 };
const SNAP_MAX_M = 400;
const RAD = Math.PI / 180;
const M_PER_DEG = 111320;

interface Edge {
  a: number;
  b: number;
  len: number;
  c: RoadClass;
  foot: boolean;
}
export interface RoadGraph {
  lat: number[];
  lon: number[];
  edges: Edge[];
  /** edge indices touching each node */
  adj: number[][];
}

const graphs = new WeakMap<OfflineArea, RoadGraph>();

export const dist = (a: Ll, b: Ll) => distanceKm(a, b) * 1000;

/** Walking may not use motorways or trunk roads (class 0). Driving may not use footpaths. */
const allowed = (mode: Mode, c: RoadClass, foot: boolean) => (mode === 'walk' ? c !== 0 : !foot);

export function buildGraph(area: OfflineArea): RoadGraph {
  const cached = graphs.get(area);
  if (cached) return cached;
  const index = new Map<string, number>();
  const lat: number[] = [];
  const lon: number[] = [];
  const edges: Edge[] = [];
  const adj: number[][] = [];
  const node = (la: number, lo: number) => {
    const k = vertexKey(la, lo);
    let id = index.get(k);
    if (id === undefined) {
      id = lat.length;
      index.set(k, id);
      lat.push(la);
      lon.push(lo);
      adj.push([]);
    }
    return id;
  };
  for (const road of area.roads) {
    const p = road.p;
    let prev = -1;
    for (let i = 0; i + 1 < p.length; i += 2) {
      const id = node(p[i], p[i + 1]);
      if (prev >= 0 && prev !== id) {
        const e = edges.length;
        const len = dist({ lat: lat[prev], lon: lon[prev] }, { lat: lat[id], lon: lon[id] });
        edges.push({ a: prev, b: id, len, c: road.c, foot: road.f === 1 });
        adj[prev].push(e);
        adj[id].push(e);
      }
      prev = id;
    }
  }
  const g: RoadGraph = { lat, lon, edges, adj };
  graphs.set(area, g);
  return g;
}

/** Saves made before v 2 have no footpaths or junction data; they can draw, but cannot route well. */
export const isRoutable = (area: OfflineArea) => (area.v ?? 1) >= 2;

interface Snap {
  edge: number;
  lat: number;
  lon: number;
  distM: number;
}

/** Nearest allowed road segment (not just vertices), within SNAP_MAX_M. */
function snap(g: RoadGraph, p: Ll, mode: Mode): Snap | null {
  const kx = M_PER_DEG * Math.cos(p.lat * RAD);
  const ky = M_PER_DEG;
  let best = -1;
  let bestD2 = Infinity;
  let bx = 0;
  let by = 0;
  for (let i = 0; i < g.edges.length; i++) {
    const e = g.edges[i];
    if (!allowed(mode, e.c, e.foot)) continue;
    const ax = (g.lon[e.a] - p.lon) * kx;
    const ay = (g.lat[e.a] - p.lat) * ky;
    const dx = (g.lon[e.b] - p.lon) * kx - ax;
    const dy = (g.lat[e.b] - p.lat) * ky - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? -(ax * dx + ay * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d2 = px * px + py * py;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
      bx = px;
      by = py;
    }
  }
  if (best < 0) return null;
  const s = { lat: p.lat + by / ky, lon: p.lon + bx / kx };
  const distM = dist(p, s);
  return distM <= SNAP_MAX_M ? { edge: best, lat: s.lat, lon: s.lon, distM } : null;
}

class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number) {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (k[parent] <= key) break;
      k[i] = k[parent];
      v[i] = v[parent];
      i = parent;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): number {
    const k = this.k;
    const v = this.v;
    const top = v[0];
    const lastK = k.pop()!;
    const lastV = v.pop()!;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && k[r] < k[l] ? r : l;
        if (k[c] >= lastK) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return top;
  }
}

interface Ext {
  to: number;
  w: number;
  c: RoadClass;
  foot: boolean;
  /** extra cost in metres from reported problems on this stretch */
  pen: number;
  /** a reported impassable problem lies on this stretch */
  imp: boolean;
  hits: number[] | null;
}

const OBSTACLE_RADIUS_M = 35;
const CELL_DEG = 0.001; // about 111 m
const cellKey = (ix: number, iy: number) => (iy + 90000) * 400000 + (ix + 180000);
const gridCache = new WeakMap<RoadGraph, Map<number, number[]>>();

/** Coarse grid of edge indices by bounding box, built once per graph. */
function edgeGrid(g: RoadGraph): Map<number, number[]> {
  const hit = gridCache.get(g);
  if (hit) return hit;
  const grid = new Map<number, number[]>();
  for (let i = 0; i < g.edges.length; i++) {
    const e = g.edges[i];
    const x0 = Math.floor(Math.min(g.lon[e.a], g.lon[e.b]) / CELL_DEG);
    const x1 = Math.floor(Math.max(g.lon[e.a], g.lon[e.b]) / CELL_DEG);
    const y0 = Math.floor(Math.min(g.lat[e.a], g.lat[e.b]) / CELL_DEG);
    const y1 = Math.floor(Math.max(g.lat[e.a], g.lat[e.b]) / CELL_DEG);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const k = cellKey(x, y);
        const arr = grid.get(k);
        if (arr) arr.push(i);
        else grid.set(k, [i]);
      }
  }
  gridCache.set(g, grid);
  return grid;
}

/** Penalties of reported problems laid onto the edges of one graph for one travel mode. */
interface AvoidCtx {
  obstacles: Obstacle[];
  /** extra cost per edge in metres (for impassable edges: a stand-in used only on the partial edges next to the start and end) */
  pen: Float64Array;
  imp: Uint8Array;
  pens: RoutePenalty[];
  /** extra cost in metres for each obstacle */
  penM: Float64Array;
  /** obstacle indices matched to each edge */
  hits: Map<number, number[]>;
  /** obstacles that touch at least one road usable in this mode */
  touching: Set<number>;
  anyImpassable: boolean;
}

function buildAvoid(g: RoadGraph, avoid: AvoidOptions | undefined, mode: Mode): AvoidCtx | null {
  const obstacles = avoid?.obstacles ?? [];
  if (obstacles.length === 0) return null;
  const grid = edgeGrid(g);
  const pens = routePenalty(obstacles, mode);
  const ctx: AvoidCtx = { obstacles, pen: new Float64Array(g.edges.length), imp: new Uint8Array(g.edges.length), pens, penM: Float64Array.from(pens, (x) => (x.impassable ? 30 : x.minutes) * SPEED_M_PER_MIN[mode]), hits: new Map(), touching: new Set(), anyImpassable: false };
  for (let k = 0; k < obstacles.length; k++) {
    const o = obstacles[k];
    const kx = M_PER_DEG * Math.cos(o.lat * RAD);
    const dLat = OBSTACLE_RADIUS_M / M_PER_DEG;
    const dLon = OBSTACLE_RADIUS_M / Math.max(1, kx);
    const x0 = Math.floor((o.lon - dLon) / CELL_DEG);
    const x1 = Math.floor((o.lon + dLon) / CELL_DEG);
    const y0 = Math.floor((o.lat - dLat) / CELL_DEG);
    const y1 = Math.floor((o.lat + dLat) / CELL_DEG);
    const seen = new Set<number>();
    const pm = ctx.penM[k];
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const cell = grid.get(cellKey(x, y));
        if (!cell) continue;
        for (const ei of cell) {
          if (seen.has(ei)) continue;
          seen.add(ei);
          const e = g.edges[ei];
          if (!allowed(mode, e.c, e.foot)) continue;
          const ax = (g.lon[e.a] - o.lon) * kx;
          const ay = (g.lat[e.a] - o.lat) * M_PER_DEG;
          const dx = (g.lon[e.b] - o.lon) * kx - ax;
          const dy = (g.lat[e.b] - o.lat) * M_PER_DEG - ay;
          const l2 = dx * dx + dy * dy;
          let t = l2 > 0 ? -(ax * dx + ay * dy) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = ax + t * dx;
          const py = ay + t * dy;
          if (px * px + py * py > OBSTACLE_RADIUS_M * OBSTACLE_RADIUS_M) continue;
          ctx.touching.add(k);
          const list = ctx.hits.get(ei);
          if (list) list.push(k);
          else ctx.hits.set(ei, [k]);
          if (pens[k].impassable) {
            ctx.imp[ei] = 1;
            ctx.anyImpassable = true;
          }
          ctx.pen[ei] = Math.max(ctx.pen[ei], pm);
        }
      }
  }
  return ctx;
}

/** Distance in metres from an obstacle to the segment a-b. */
function obstacleToSegM(o: Ll, a: Ll, b: Ll): number {
  const kx = M_PER_DEG * Math.cos(o.lat * RAD);
  const ax = (a.lon - o.lon) * kx;
  const ay = (a.lat - o.lat) * M_PER_DEG;
  const dx = (b.lon - o.lon) * kx - ax;
  const dy = (b.lat - o.lat) * M_PER_DEG - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? -(ax * dx + ay * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/**
 * Problems on one stretch next to the start or end (a snapped point to a junction, or start to end on one edge).
 * A problem right where the person stands or is going (within 35 m of the start or end) never makes the stretch impassable.
 */
function linkAvoid(ctx: AvoidCtx | null, ei: number, a: Ll, b: Ll, s: Ll, e: Ll): { pen: number; imp: boolean; hits: number[] | null } {
  const list = ctx?.hits.get(ei);
  if (!ctx || !list) return { pen: 0, imp: false, hits: null };
  let pen = 0;
  let imp = false;
  const hits: number[] = [];
  for (const k of list) {
    const o = ctx.obstacles[k];
    if (obstacleToSegM(o, a, b) > OBSTACLE_RADIUS_M) continue;
    hits.push(k);
    const here = dist(o, s) <= OBSTACLE_RADIUS_M || dist(o, e) <= OBSTACLE_RADIUS_M;
    if (ctx.pens[k].impassable && !here) imp = true;
    pen = Math.max(pen, ctx.penM[k]);
  }
  return { pen, imp, hits: hits.length ? hits : null };
}

/** A* between two snapped points. Virtual nodes N (start) and N+1 (end) sit on their snapped segments. */
function search(g: RoadGraph, s: Snap, e: Snap, mode: Mode, ctx: AvoidCtx | null, penalise: boolean): { ids: number[]; pathM: number; costM: number; hits: number[] } | null {
  const N = g.lat.length;
  const S = N;
  const T = N + 1;
  // haversine straight line to the end: admissible (never overestimates), and allocation-free because A* calls it often
  const tLat = e.lat * RAD;
  const tCos = Math.cos(tLat);
  const h = (id: number) => {
    const la = id === S ? s.lat : id === T ? e.lat : g.lat[id];
    const lo = id === S ? s.lon : id === T ? e.lon : g.lon[id];
    const dLat = (e.lat - la) * RAD;
    const dLon = (e.lon - lo) * RAD;
    const q = Math.sin(dLat / 2) ** 2 + Math.cos(la * RAD) * tCos * Math.sin(dLon / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(q)));
  };

  const extra = new Map<number, Ext[]>();
  const add = (k: number, x: Ext) => {
    const arr = extra.get(k);
    if (arr) arr.push(x);
    else extra.set(k, [x]);
  };
  const attach = (v: number, sn: Snap) => {
    const ed = g.edges[sn.edge];
    for (const end of [ed.a, ed.b]) {
      const w = dist({ lat: sn.lat, lon: sn.lon }, { lat: g.lat[end], lon: g.lon[end] });
      const x = linkAvoid(ctx, sn.edge, sn, { lat: g.lat[end], lon: g.lon[end] }, s, e);
      add(v, { to: end, w, c: ed.c, foot: ed.foot, ...x });
      add(end, { to: v, w, c: ed.c, foot: ed.foot, ...x });
    }
  };
  attach(S, s);
  attach(T, e);
  if (s.edge === e.edge) {
    const ed = g.edges[s.edge];
    const w = dist({ lat: s.lat, lon: s.lon }, { lat: e.lat, lon: e.lon });
    const x = linkAvoid(ctx, s.edge, s, e, s, e);
    add(S, { to: T, w, c: ed.c, foot: ed.foot, ...x });
    add(T, { to: S, w, c: ed.c, foot: ed.foot, ...x });
  }

  const gScore = new Float64Array(N + 2).fill(Infinity);
  const prev = new Int32Array(N + 2).fill(-1);
  const prevHit: (number[] | null)[] = ctx ? new Array(N + 2).fill(null) : [];
  const realM = new Float64Array(N + 2);
  const closed = new Uint8Array(N + 2);
  const heap = new MinHeap();
  gScore[S] = 0;
  heap.push(h(S), S);
  while (heap.size > 0) {
    const n = heap.pop();
    if (closed[n]) continue;
    closed[n] = 1;
    if (n === T) break;
    const gn = gScore[n];
    const visit = (to: number, w: number, c: RoadClass, foot: boolean, pen: number, imp: boolean, hits: number[] | null | undefined) => {
      if (closed[to] || !allowed(mode, c, foot)) return;
      let cost = w;
      if (penalise) {
        if (imp) return;
        cost += pen;
      }
      const ng = gn + cost;
      if (ng < gScore[to]) {
        gScore[to] = ng;
        realM[to] = realM[n] + w;
        prev[to] = n;
        if (ctx) prevHit[to] = hits ?? null;
        heap.push(ng + h(to), to);
      }
    };
    if (n < N) {
      for (const ei of g.adj[n]) {
        const ed = g.edges[ei];
        if (ctx) visit(ed.a === n ? ed.b : ed.a, ed.len, ed.c, ed.foot, ctx.pen[ei], ctx.imp[ei] === 1, ctx.hits.get(ei));
        else visit(ed.a === n ? ed.b : ed.a, ed.len, ed.c, ed.foot, 0, false, null);
      }
    }
    const ex = extra.get(n);
    if (ex) for (const x of ex) visit(x.to, x.w, x.c, x.foot, x.pen, x.imp, x.hits);
  }
  if (!closed[T]) return null;
  const ids: number[] = [];
  const hits: number[] = [];
  for (let v = T; v !== -1; v = prev[v]) {
    ids.push(v);
    const h = ctx ? prevHit[v] : null;
    if (h) hits.push(...h);
  }
  ids.reverse();
  return { ids, pathM: realM[T], costM: gScore[T], hits };
}

const minutesFor = (m: number, mode: Mode) => (m <= 0 ? 0 : Math.max(1, Math.round(m / SPEED_M_PER_MIN[mode])));

function finish(g: RoadGraph, s: Snap, e: Snap, mode: Mode, from: Ll, to: Ll, ctx: AvoidCtx | null): RouteResult | null {
  let res = search(g, s, e, mode, ctx, true);
  let unsafe = false;
  if (!res && ctx?.anyImpassable) {
    res = search(g, s, e, mode, ctx, false);
    unsafe = res != null;
  }
  if (!res) return null;
  const ahead = new Set<number>();
  for (const k of res.hits) ahead.add(k);
  const blockedAhead = [...ahead].map((k) => ctx!.obstacles[k]);
  const N = g.lat.length;
  const road = res.ids.map((id) => (id === N ? { lat: s.lat, lon: s.lon } : id === N + 1 ? { lat: e.lat, lon: e.lon } : { lat: g.lat[id], lon: g.lon[id] }));
  const distanceM = s.distM + res.pathM + e.distM;
  return {
    points: [{ lat: from.lat, lon: from.lon }, ...road, { lat: to.lat, lon: to.lon }],
    distanceM,
    minutes: minutesFor(distanceM, mode),
    snappedStartM: s.distM,
    snappedEndM: e.distM,
    costM: s.distM + res.costM + e.distM,
    avoided: ctx && !unsafe ? [...ctx.touching].filter((k) => !ahead.has(k)).length : 0,
    blockedAhead,
    unsafe,
  };
}

/** Shortest road route between two real positions, or null when either is more than 400 m from a usable road or they are not connected. */
export function routeTo(area: OfflineArea, from: Ll, to: Ll, mode: Mode = 'walk', avoid?: AvoidOptions): RouteResult | null {
  const g = buildGraph(area);
  const s = snap(g, from, mode);
  const e = s ? snap(g, to, mode) : null;
  if (!s || !e) return null;
  return finish(g, s, e, mode, from, to, buildAvoid(g, avoid, mode));
}

/** Road routes to the nearest `limit` places (by straight line). Routes sort first, nearest by road; failures follow, nearest by straight line. */
export function routesTo<T extends Ll>(area: OfflineArea, from: Ll, places: T[], mode: Mode = 'walk', limit = 8, avoid?: AvoidOptions): RouteOption<T>[] {
  const g = buildGraph(area);
  const ctx = buildAvoid(g, avoid, mode);
  const s = snap(g, from, mode);
  const picked = places
    .map((p) => ({ p, straightM: dist(from, p) }))
    .sort((a, b) => a.straightM - b.straightM)
    .slice(0, limit);
  const out: RouteOption<T>[] = picked.map(({ p, straightM }) => {
    const e = s ? snap(g, p, mode) : null;
    const r = s && e ? finish(g, s, e, mode, from, p, ctx) : null;
    return { place: p, straightM, road: r ? { roadM: r.distanceM, minutes: r.minutes, points: r.points, costM: r.costM, avoided: r.avoided, blockedAhead: r.blockedAhead, unsafe: r.unsafe } : null };
  });
  // rank by what the search minimised (distance plus penalties); routes that had to ignore closures go after the safe ones
  const key = (r: RoadRoute) => (r.unsafe ? 1e9 : 0) + (r.costM ?? r.roadM);
  return out.sort((a, b) => (a.road && b.road ? key(a.road) - key(b.road) : a.road ? -1 : b.road ? 1 : a.straightM - b.straightM));
}

/** Bearing of the first road segment (from the snapped start, not the real position). */
export function firstBearingDeg(points: Ll[]): number | null {
  if (points.length < 3) return null;
  const anchor = points[1];
  for (let i = 2; i < points.length; i++) if (dist(anchor, points[i]) >= 5) return bearingDeg(anchor, points[i]);
  return null;
}

/** Legs of the road part of a route: drops the straight last mile at each end, merges gentle bends (under 25 degrees). */
export function turnHints(points: Ll[]): Leg[] {
  const rp = points.slice(1, -1);
  const legs: Leg[] = [];
  let cur: Leg | null = null;
  for (let i = 0; i + 1 < rp.length; i++) {
    const m = dist(rp[i], rp[i + 1]);
    if (m < 1) continue;
    const b = bearingDeg(rp[i], rp[i + 1]);
    if (!cur) {
      cur = { compass: compassWord(b), bearing: b, meters: m, turn: null };
      continue;
    }
    const d = ((b - cur.bearing + 540) % 360) - 180; // signed, positive = clockwise (right)
    if (Math.abs(d) < 25) {
      cur.meters += m;
      continue;
    }
    cur.turn = Math.abs(d) >= 150 ? 'around' : d > 0 ? 'right' : 'left';
    legs.push({ ...cur, meters: Math.round(cur.meters) });
    cur = { compass: compassWord(b), bearing: b, meters: m, turn: null };
  }
  if (cur) legs.push({ ...cur, meters: Math.round(cur.meters) });
  return legs;
}
