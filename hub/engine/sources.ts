// Free, keyless data sources for Beacon Hub: Open-Meteo (weather, air quality),
// USGS (earthquakes) and NDMA SACHET (official alerts). Every getter returns flat
// Metrics using the names documented in types.ts and never throws.

import type { Metrics, Place, SourceKind, SourceOptions } from './types.ts';

const UA = 'BeaconHub/0.1 (community disaster app)';
const TIMEOUT_MS = 8000;
const QUAKE_RADIUS_KM = 500;
const DELHI: Place = { name: 'Delhi', lat: 28.6139, lon: 77.209, state: 'delhi' };

const WEATHER_KEYS = [
  'temp_c', 'feels_like_c', 'humidity_pct', 'heat_index_c', 'wind_kmh',
  'wind_gust_kmh', 'rain_mm_24h', 'rain_mm_now', 'uv_index',
];
const AQI_KEYS = ['aqi', 'pm25'];
const QUAKE_KEYS = ['quake_max_mag', 'quake_nearest_km', 'quake_count'];
const ALERT_KEYS = ['official_alert_count', 'official_alert_max'];

const QUAKE_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson';
const ALERT_URL = 'https://sachet.ndma.gov.in/cap_public_website/FetchAllAlertDetails';

/** Used only if ./sample.ts cannot be loaded. */
const LOCAL_FALLBACK: Metrics = {
  temp_c: 32, feels_like_c: 36, humidity_pct: 55, heat_index_c: 38, wind_kmh: 12,
  wind_gust_kmh: 25, rain_mm_24h: 0, rain_mm_now: 0, uv_index: 7,
  aqi: 120, pm25: 45,
  quake_max_mag: 0, quake_nearest_km: 9999, quake_count: 0,
  official_alert_count: 0, official_alert_max: 0,
};

/** Sample readings for one source kind. Falls back to LOCAL_FALLBACK if sample.ts cannot be loaded. */
async function loadSample(kind: SourceKind): Promise<Metrics> {
  try {
    const m = await import('./sample.ts');
    return m.sampleMetrics([kind]);
  } catch {
    return LOCAL_FALLBACK;
  }
}

function pick(src: Metrics, keys: readonly string[]): Metrics {
  const out: Metrics = {};
  for (const k of keys) {
    const v = src[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function put(out: Metrics, key: string, v: unknown): void {
  if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

async function getJson(url: string, opts: SourceOptions): Promise<unknown> {
  if (opts.fetch) {
    const res = await withTimeout(opts.fetch(url));
    if (!res.ok) throw new Error(`HTTP error for ${url}`);
    return res.json();
  }
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/**
 * Runs a live loader. Offline mode, or any error, falls back to sample values for
 * this source's keys. Real partial results are merged over the sample values.
 */
async function guarded(
  kind: SourceKind,
  keys: readonly string[],
  opts: SourceOptions,
  load: () => Promise<Metrics>,
  onFail?: () => Metrics,
): Promise<Metrics> {
  try {
    if (opts.offline) return pick(await loadSample(kind), keys);
    const real = await load();
    return { ...pick(await loadSample(kind), keys), ...real };
  } catch {
    if (onFail) return onFail();
    return pick(await loadSample(kind), keys);
  }
}

/** Rothfusz regression heat index, returned in Celsius. Below 80 F the air temperature is returned. */
export function heatIndexC(tC: number, rh: number): number {
  const T = tC * 9 / 5 + 32;
  if (T < 80) return tC;
  const R = rh;
  let hi = -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R
    - 0.00683783 * T * T - 0.05481717 * R * R + 0.00122874 * T * T * R
    + 0.00085282 * T * R * R - 0.00000199 * T * T * R * R;
  if (R < 13 && T >= 80 && T <= 112) hi -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
  if (R > 85 && T >= 80 && T <= 87) hi += ((R - 85) / 10) * ((87 - T) / 5);
  return Math.round(((hi - 32) * 5 / 9) * 10) / 10;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function getWeather(place: Place | undefined, opts: SourceOptions = {}): Promise<Metrics> {
  const p = place ?? DELHI;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}`
    + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,wind_gusts_10m,precipitation,uv_index'
    + '&daily=precipitation_sum&timezone=auto&past_days=1';
  return guarded('weather', WEATHER_KEYS, opts, async () => {
    const json = (await getJson(url, opts)) as {
      current?: Record<string, unknown>;
      daily?: { precipitation_sum?: unknown[] };
    };
    const cur = json?.current ?? {};
    const out: Metrics = {};
    put(out, 'temp_c', cur.temperature_2m);
    put(out, 'feels_like_c', cur.apparent_temperature);
    put(out, 'humidity_pct', cur.relative_humidity_2m);
    put(out, 'wind_kmh', cur.wind_speed_10m);
    put(out, 'wind_gust_kmh', cur.wind_gusts_10m);
    put(out, 'rain_mm_now', cur.precipitation);
    put(out, 'uv_index', cur.uv_index);
    // past_days=1 puts yesterday at index 0 and today at index 1.
    put(out, 'rain_mm_24h', json?.daily?.precipitation_sum?.[1]);
    if (out.temp_c !== undefined && out.humidity_pct !== undefined) {
      out.heat_index_c = heatIndexC(out.temp_c, out.humidity_pct);
    }
    return out;
  });
}

export async function getAqi(place: Place | undefined, opts: SourceOptions = {}): Promise<Metrics> {
  const p = place ?? DELHI;
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${p.lat}&longitude=${p.lon}&current=us_aqi,pm2_5`;
  return guarded('aqi', AQI_KEYS, opts, async () => {
    const json = (await getJson(url, opts)) as { current?: Record<string, unknown> };
    const out: Metrics = {};
    put(out, 'aqi', json?.current?.us_aqi);
    put(out, 'pm25', json?.current?.pm2_5);
    return out;
  });
}

export async function getQuakes(place: Place | undefined, opts: SourceOptions = {}): Promise<Metrics> {
  const p = place ?? DELHI;
  return guarded('quake', QUAKE_KEYS, opts, async () => {
    const json = (await getJson(QUAKE_URL, opts)) as { features?: unknown };
    if (!Array.isArray(json?.features)) throw new Error('unexpected USGS feed shape');
    let nearest = Infinity;
    let maxMag = 0;
    let count = 0;
    for (const f of json.features as Array<{
      properties?: { mag?: unknown };
      geometry?: { coordinates?: unknown[] };
    }>) {
      const coords = f?.geometry?.coordinates;
      const lon = coords?.[0];
      const lat = coords?.[1];
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;
      const d = haversineKm(p.lat, p.lon, lat, lon);
      if (d < nearest) nearest = d;
      if (d <= QUAKE_RADIUS_KM) {
        count++;
        const mag = f?.properties?.mag;
        if (typeof mag === 'number' && mag > maxMag) maxMag = mag;
      }
    }
    return {
      quake_max_mag: maxMag,
      quake_nearest_km: Number.isFinite(nearest) ? Math.round(nearest) : 9999,
      quake_count: count,
    };
  });
}

/** Severity words to the 0..3 scale used by types.ts. */
function severityLevel(text: string): number {
  const s = text.toLowerCase();
  if (/extreme|severe/.test(s)) return 3;
  if (/moderate/.test(s)) return 2;
  if (/minor|watch/.test(s)) return 1;
  return 0;
}

/** Concatenates all string values of an object, a few levels deep. */
function collectText(v: unknown, depth = 0): string {
  if (typeof v === 'string') return v;
  if (depth > 3 || v === null || typeof v !== 'object') return '';
  return Object.values(v as Record<string, unknown>).map((x) => collectText(x, depth + 1)).join(' ');
}

/** The feed may be a bare array or an object wrapping one. */
function findArray(json: unknown): unknown[] | undefined {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    for (const v of Object.values(json as Record<string, unknown>)) {
      if (Array.isArray(v)) return v;
    }
  }
  return undefined;
}

export async function getAlerts(place: Place | undefined, opts: SourceOptions = {}): Promise<Metrics> {
  const p = place ?? DELHI;
  const state = p.state?.toLowerCase();
  const zeros = (): Metrics => ({ official_alert_count: 0, official_alert_max: 0 });
  return guarded('alerts', ALERT_KEYS, opts, async () => {
    const items = findArray(await getJson(ALERT_URL, opts));
    if (!items) throw new Error('unexpected SACHET feed shape');
    let count = 0;
    let max = 0;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const text = collectText(item).toLowerCase();
      // Without a known state, every alert in the feed counts.
      if (state && !text.includes(state)) continue;
      const rec = item as Record<string, unknown>;
      const sevField = typeof rec.severity === 'string' ? rec.severity
        : typeof rec.Severity === 'string' ? rec.Severity : undefined;
      count++;
      max = Math.max(max, severityLevel(sevField ?? text));
    }
    return { official_alert_count: count, official_alert_max: max };
  }, zeros);
}

/** Fetches the requested kinds in parallel and merges their readings. Other kinds are ignored here. */
export async function fetchMetrics(
  kinds: SourceKind[],
  place: Place | undefined,
  opts: SourceOptions = {},
): Promise<Metrics> {
  const want = new Set(kinds);
  const tasks: Promise<Metrics>[] = [];
  if (want.has('weather')) tasks.push(getWeather(place, opts));
  if (want.has('aqi')) tasks.push(getAqi(place, opts));
  if (want.has('quake')) tasks.push(getQuakes(place, opts));
  if (want.has('alerts')) tasks.push(getAlerts(place, opts));
  const parts = await Promise.all(tasks);
  return Object.assign({}, ...parts);
}
