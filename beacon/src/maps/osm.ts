// Offline map data from OpenStreetMap (via the Overpass API). One download of a ~4 km square around the user
// gives roads, water and emergency places, stored as a compact JSON file and drawn as vector graphics.
import { distanceKm } from '../alerts/sources';

export type PlaceKind = 'shelter' | 'hospital' | 'water' | 'police' | 'pharmacy' | 'fire' | 'school';

export interface Place {
  kind: PlaceKind;
  name: string;
  lat: number;
  lon: number;
}

export type RoadClass = 0 | 1 | 2 | 3; // 0 major, 1 main, 2 street, 3 minor (includes footpaths)

export interface OfflineArea {
  /** 1 = drawing only (old saves, no road graph). 2 = has footpaths, junctions and road routing. */
  v: 1 | 2;
  center: { lat: number; lon: number };
  /** half-width in km */
  radiusKm: number;
  savedAt: number;
  /** each line is [lat0, lon0, lat1, lon1, ...]. f = 1 marks footpaths (walking only, never driving). */
  roads: { c: RoadClass; p: number[]; f?: 1 }[];
  water: { p: number[]; area: boolean }[];
  places: Place[];
}

/** Old saves (v 1, or no v at all) still draw, but road routing needs a refresh. */
export const needsRefresh = (area: OfflineArea) => (area.v ?? 1) < 2;

/**
 * Minor ways (class 3, which includes footpaths and service roads) are the bulk of a dense download.
 * Every class 0-2 way is kept; of the minor ones only this many nearest the centre are stored.
 */
export const MAX_MINOR_ROADS = 6000;

export const overpassQuery = (lat: number, lon: number, radiusKm: number) => {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  const bbox = `${(lat - dLat).toFixed(5)},${(lon - dLon).toFixed(5)},${(lat + dLat).toFixed(5)},${(lon + dLon).toFixed(5)}`;
  // service|pedestrian|footway|path|steps|track are walking connectivity (class 3); parseOverpass caps how many are stored.
  return `[out:json][timeout:40];(
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|service|pedestrian|footway|path|steps|track)$"](${bbox});
way["waterway"~"^(river|stream|canal)$"](${bbox});
way["natural"="water"](${bbox});
node["amenity"~"^(hospital|clinic|doctors|pharmacy|police|fire_station|drinking_water|shelter|community_centre|school)$"](${bbox});
way["amenity"~"^(hospital|clinic|pharmacy|police|fire_station|shelter|community_centre|school)$"](${bbox});
node["emergency"~"^(assembly_point|water_tank)$"](${bbox});
);out geom tags;`;
};

const ROAD_CLASS: Record<string, RoadClass> = {
  motorway: 0, trunk: 0, motorway_link: 0, trunk_link: 0,
  primary: 1, primary_link: 1, secondary: 1,
  tertiary: 2, unclassified: 2,
  residential: 3, living_street: 3, service: 3, track: 3,
  pedestrian: 3, footway: 3, path: 3, steps: 3,
};
/** Walkable only: never used for driving routes. */
const FOOT_ONLY = new Set(['pedestrian', 'footway', 'path', 'steps']);

const AMENITY_KIND: Record<string, PlaceKind> = {
  hospital: 'hospital', clinic: 'hospital', doctors: 'hospital',
  pharmacy: 'pharmacy', police: 'police', fire_station: 'fire',
  drinking_water: 'water', shelter: 'shelter', community_centre: 'shelter', school: 'school',
};

interface OverpassEl {
  type: 'node' | 'way';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;

/** Exact vertex identity used to find junctions (two ways that share a coordinate). */
export const vertexKey = (lat: number, lon: number) => `${lat.toFixed(6)},${lon.toFixed(6)}`;

/** Vertices used by two or more ways. Each way counts once per vertex, however often it repeats it. */
export function sharedVertices(ways: { lat: number; lon: number }[][]): Set<string> {
  const uses = new Map<string, number>();
  for (const g of ways) {
    const seen = new Set<string>();
    for (const p of g) seen.add(vertexKey(p.lat, p.lon));
    for (const k of seen) uses.set(k, (uses.get(k) ?? 0) + 1);
  }
  const shared = new Set<string>();
  for (const [k, n] of uses) if (n >= 2) shared.add(k);
  return shared;
}

/**
 * Keep the shape, drop points that add nothing at phone-screen scale.
 * The first and last points and every shared vertex (a junction) are always kept, so roads still meet.
 */
export function simplify(pts: { lat: number; lon: number }[], minStepM = 6, shared: Set<string> = new Set()): number[] {
  const out: number[] = [];
  let last: { lat: number; lon: number } | null = null;
  pts.forEach((p, i) => {
    const edge = i === 0 || i === pts.length - 1;
    if (edge || shared.has(vertexKey(p.lat, p.lon)) || !last || distanceKm(last, p) * 1000 >= minStepM) {
      out.push(round(p.lat), round(p.lon));
      last = p;
    }
  });
  return out;
}

const centroid = (g: { lat: number; lon: number }[]) => ({
  lat: g.reduce((s, p) => s + p.lat, 0) / g.length,
  lon: g.reduce((s, p) => s + p.lon, 0) / g.length,
});

export function parseOverpass(json: { elements: OverpassEl[] }, center: { lat: number; lon: number }, radiusKm: number, now = Date.now()): OfflineArea {
  const water: OfflineArea['water'] = [];
  const places: Place[] = [];
  const cands: { c: RoadClass; g: { lat: number; lon: number }[]; foot: boolean; d: number }[] = [];
  for (const el of json.elements) {
    const t = el.tags ?? {};
    const amenity = t.amenity ? AMENITY_KIND[t.amenity] : undefined;
    const emergency = t.emergency === 'assembly_point' ? 'shelter' : t.emergency === 'water_tank' ? 'water' : undefined;
    const kind = amenity ?? emergency;
    if (kind) {
      const pos = el.type === 'node' ? (el.lat != null && el.lon != null ? { lat: el.lat, lon: el.lon } : null) : el.geometry?.length ? centroid(el.geometry) : null;
      if (pos) {
        const fallback = kind === 'water' ? 'Drinking water' : kind === 'shelter' ? (t.emergency ? 'Assembly point' : t.amenity === 'community_centre' ? 'Community centre' : 'Shelter') : kind;
        places.push({ kind, name: (t.name ?? t['name:en'] ?? fallback).slice(0, 60), lat: round(pos.lat), lon: round(pos.lon) });
      }
      continue;
    }
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    if (t.highway && ROAD_CLASS[t.highway] !== undefined) {
      cands.push({ c: ROAD_CLASS[t.highway], g: el.geometry, foot: FOOT_ONLY.has(t.highway), d: distanceKm(center, centroid(el.geometry)) });
    } else if (t.waterway || t.natural === 'water') water.push({ p: simplify(el.geometry, 10), area: t.natural === 'water' });
  }
  // cap the minor ways: all class 0-2 roads stay, class 3 keeps only the MAX_MINOR_ROADS nearest the centre
  const keepMinor = new Set(cands.filter((c) => c.c === 3).sort((a, b) => a.d - b.d).slice(0, MAX_MINOR_ROADS));
  const kept = cands.filter((c) => c.c !== 3 || keepMinor.has(c));
  // junctions are counted over the ways actually stored, so simplify never merges two roads apart
  const shared = sharedVertices(kept.map((c) => c.g));
  const roads: OfflineArea['roads'] = kept.map((c) => (c.foot ? { c: c.c, p: simplify(c.g, 6, shared), f: 1 as const } : { c: c.c, p: simplify(c.g, 6, shared) }));
  // drop duplicate places (a school drawn as both a node and a building outline)
  const seen = new Set<string>();
  const unique = places.filter((p) => {
    const k = `${p.kind}:${p.lat.toFixed(4)}:${p.lon.toFixed(4)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { v: 2, center, radiusKm, savedAt: now, roads, water, places: unique };
}

export interface Nearby extends Place {
  distanceM: number;
  bearing: number; // degrees clockwise from north
}

export function bearingDeg(from: { lat: number; lon: number }, to: { lat: number; lon: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(r(to.lon - from.lon)) * Math.cos(r(to.lat));
  const x = Math.cos(r(from.lat)) * Math.sin(r(to.lat)) - Math.sin(r(from.lat)) * Math.cos(r(to.lat)) * Math.cos(r(to.lon - from.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Straight-line (as the crow flies) places, nearest first. Road distances come from route.ts. */
export function nearest(area: OfflineArea, from: { lat: number; lon: number }, kind?: PlaceKind | PlaceKind[], limit = 5): Nearby[] {
  const kinds = kind ? (Array.isArray(kind) ? kind : [kind]) : null;
  return area.places
    .filter((p) => !kinds || kinds.includes(p.kind))
    .map((p) => ({ ...p, distanceM: Math.round(distanceKm(from, p) * 1000), bearing: bearingDeg(from, p) }))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}

/** Equirectangular projection into a square viewport centred on `center`, `scale` px per km. */
export function project(p: { lat: number; lon: number }, center: { lat: number; lon: number }, scale: number, size: number): { x: number; y: number } {
  const kx = 111 * Math.cos((center.lat * Math.PI) / 180);
  return { x: size / 2 + (p.lon - center.lon) * kx * scale, y: size / 2 - (p.lat - center.lat) * 111 * scale };
}

export const compassWord = (deg: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}
