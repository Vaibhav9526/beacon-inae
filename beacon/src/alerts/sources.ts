// Free public early-warning sources. Pure fetch + normalise, no React Native imports, so the same
// code runs on the phone (when online) and on the Beacon server.
import type { AlertBody } from '../mesh/node';
import { relevantHere } from './india';

export interface Point {
  lat: number;
  lon: number;
}

export function distanceKm(a: Point, b: Point): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

type Fetcher = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown>; text(): Promise<string> }>;
const defaultFetch: Fetcher = (u) => fetch(u) as never;

// ---------- USGS earthquakes ----------

interface UsgsFeature {
  id: string;
  properties: { mag: number; place: string; time: number; url: string; tsunami?: number };
  geometry: { coordinates: [number, number, number] };
}

/** Quakes M4.5+ from the past day, kept when strong enough for how far away they are. */
export async function fetchEarthquakes(near: Point | null, f: Fetcher = defaultFetch): Promise<AlertBody[]> {
  const res = await f('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson');
  if (!res.ok) return [];
  const data = (await res.json()) as { features: UsgsFeature[] };
  const out: AlertBody[] = [];
  for (const q of data.features) {
    const [lon, lat, depth] = q.geometry.coordinates;
    const mag = q.properties.mag;
    const dist = near ? distanceKm(near, { lat, lon }) : 0;
    let severity: AlertBody['severity'] | null = null;
    if (!near) severity = mag >= 6 ? 'severe' : null; // no position (server): keep only the big ones
    else if (mag >= 6 && dist <= 600) severity = 'severe';
    else if (mag >= 5 && dist <= 300) severity = 'warning';
    else if (mag >= 4.5 && dist <= 150) severity = 'watch';
    if (!severity) continue;
    const ago = Math.max(1, Math.round((Date.now() - q.properties.time) / 60000));
    out.push({
      id: `usgs-${q.id}`,
      title: `Earthquake M${mag.toFixed(1)}`,
      body: `${q.properties.place}, depth ${Math.round(depth)} km, ${ago} min ago.${near ? ` About ${Math.round(dist)} km from you.` : ''} Drop, cover and hold on. Expect aftershocks.`,
      severity,
      source: 'USGS',
      lat,
      lon,
      radiusKm: mag >= 6 ? 400 : 200,
      expires: Date.now() + 6 * 3600_000,
    });
  }
  return out;
}

// ---------- Open-Meteo weather ----------

interface MeteoForecast {
  current?: { temperature_2m: number; weather_code: number; wind_speed_10m: number };
  daily?: {
    time: string[];
    precipitation_sum: number[];
    wind_gusts_10m_max: number[];
    temperature_2m_max: number[];
    weather_code: number[];
  };
}

export async function fetchWeatherAlerts(p: Point, f: Fetcher = defaultFetch): Promise<AlertBody[]> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}` +
    `&current=temperature_2m,wind_speed_10m,weather_code` +
    `&daily=precipitation_sum,wind_gusts_10m_max,temperature_2m_max,weather_code&forecast_days=2&timezone=auto`;
  const res = await f(url);
  if (!res.ok) return [];
  const d = (await res.json()) as MeteoForecast;
  const out: AlertBody[] = [];
  const day = d.daily;
  if (!day) return out;
  const expires = Date.now() + 12 * 3600_000;
  const base = { source: 'Open-Meteo', lat: p.lat, lon: p.lon, radiusKm: 50, expires };
  for (let i = 0; i < day.time.length; i++) {
    const when = i === 0 ? 'today' : 'tomorrow';
    const rain = day.precipitation_sum[i] ?? 0;
    const gust = day.wind_gusts_10m_max[i] ?? 0;
    const hot = day.temperature_2m_max[i] ?? 0;
    const code = day.weather_code[i] ?? 0;
    // thresholds follow IMD rainfall classes: heavy 64.5 mm, very heavy 115.6 mm, extremely heavy 204.5 mm per day
    if (rain >= 115.6) out.push({ ...base, id: `rain-${day.time[i]}`, title: 'Very heavy rain', body: `${Math.round(rain)} mm of rain expected ${when}. Flooding likely: avoid low-lying roads and underpasses, move valuables up.`, severity: 'severe' });
    else if (rain >= 64.5) out.push({ ...base, id: `rain-${day.time[i]}`, title: 'Heavy rain', body: `${Math.round(rain)} mm of rain expected ${when}. Waterlogging possible.`, severity: 'warning' });
    if (gust >= 90) out.push({ ...base, id: `wind-${day.time[i]}`, title: 'Damaging winds', body: `Gusts up to ${Math.round(gust)} km/h ${when}. Stay indoors, secure loose objects, stay away from trees and hoardings.`, severity: 'severe' });
    else if (gust >= 60) out.push({ ...base, id: `wind-${day.time[i]}`, title: 'Strong winds', body: `Gusts up to ${Math.round(gust)} km/h ${when}.`, severity: 'watch' });
    if (hot >= 45) out.push({ ...base, id: `heat-${day.time[i]}`, title: 'Severe heat', body: `Up to ${Math.round(hot)} °C ${when}. Stay indoors at midday, drink water or ORS often, check on elders and children.`, severity: 'severe' });
    else if (hot >= 41) out.push({ ...base, id: `heat-${day.time[i]}`, title: 'Heat wave', body: `Up to ${Math.round(hot)} °C ${when}. Drink plenty of water and avoid the afternoon sun.`, severity: 'warning' });
    if (code >= 95) out.push({ ...base, id: `storm-${day.time[i]}`, title: 'Thunderstorm', body: `Thunderstorms forecast ${when}${code >= 96 ? ' with hail' : ''}. Stay indoors, keep away from windows and open ground.`, severity: 'warning' });
  }
  return out;
}

// ---------- Open-Meteo air quality ----------

export async function fetchAirQuality(p: Point, f: Fetcher = defaultFetch): Promise<AlertBody[]> {
  const res = await f(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${p.lat}&longitude=${p.lon}&current=us_aqi,pm2_5`);
  if (!res.ok) return [];
  const d = (await res.json()) as { current?: { us_aqi: number; pm2_5: number } };
  const aqi = d.current?.us_aqi;
  if (aqi == null || aqi < 150) return [];
  const severity: AlertBody['severity'] = aqi >= 300 ? 'severe' : aqi >= 200 ? 'warning' : 'watch';
  const label = aqi >= 300 ? 'Hazardous' : aqi >= 200 ? 'Very unhealthy' : 'Unhealthy';
  return [
    {
      // one alert per place: a newer reading replaces the older one instead of piling up every hour
      id: `aqi-${p.lat.toFixed(1)},${p.lon.toFixed(1)}`,
      title: `${label} air (AQI ${Math.round(aqi)})`,
      body: `PM2.5 is ${Math.round(d.current!.pm2_5)} µg/m³. Limit outdoor activity, wear an N95 mask outside, keep windows closed.`,
      severity,
      source: 'Open-Meteo',
      lat: p.lat,
      lon: p.lon,
      radiusKm: 30,
      expires: Date.now() + 3 * 3600_000,
    },
  ];
}

// ---------- NDMA SACHET (India's Common Alerting Protocol feed) ----------

const unescapeXml = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const tag = (xml: string, name: string) => {
  // CAP documents use a namespace prefix (<cap:info>); RSS does not
  const m = xml.match(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`));
  return m ? unescapeXml(m[1]).trim() : '';
};

export interface NdmaItem {
  id: string;
  title: string;
  category: string;
  author: string;
  link: string;
  published: number;
}

export function parseNdmaRss(xml: string): NdmaItem[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items.map((it) => ({
    id: tag(it, 'guid'),
    title: tag(it, 'title'),
    category: tag(it, 'category'),
    author: tag(it, 'author'),
    link: tag(it, 'link'),
    published: Date.parse(tag(it, 'pubDate')) || Date.now(),
  }));
}

const CAP_SEVERITY: Record<string, AlertBody['severity']> = {
  Extreme: 'severe',
  Severe: 'severe',
  Moderate: 'warning',
  Minor: 'watch',
  Unknown: 'watch',
};

export interface CapInfo {
  severity: AlertBody['severity'];
  headline: string;
  description: string;
  instruction: string;
  areaDesc: string;
  center?: Point;
  radiusKm?: number;
  expires?: number;
}

/** Pull the useful parts out of a CAP 1.2 document (severity, area centre, expiry). */
export function parseCap(xml: string): CapInfo {
  // one <info> block per language: prefer English, else the first
  const infos = xml.match(/<(?:\w+:)?info>[\s\S]*?<\/(?:\w+:)?info>/g) ?? [xml];
  const info = infos.find((i) => /^en/i.test(tag(i, 'language'))) ?? infos[0];
  const sev = tag(info, 'severity');
  let center: Point | undefined;
  let radiusKm: number | undefined;
  const circle = tag(info, 'circle');
  const polygon = tag(info, 'polygon');
  if (circle) {
    const [pt, r] = circle.split(' ');
    const [lat, lon] = pt.split(',').map(Number);
    center = { lat, lon };
    radiusKm = Number(r);
  } else if (polygon) {
    const pts = polygon.split(/\s+/).map((s) => s.split(',').map(Number)).filter((a) => a.length === 2 && !a.some(Number.isNaN));
    if (pts.length) {
      const lat = pts.reduce((s, a) => s + a[0], 0) / pts.length;
      const lon = pts.reduce((s, a) => s + a[1], 0) / pts.length;
      center = { lat, lon };
      radiusKm = Math.max(10, ...pts.map((a) => distanceKm(center!, { lat: a[0], lon: a[1] })));
    }
  }
  const exp = Date.parse(tag(info, 'expires'));
  return {
    severity: CAP_SEVERITY[sev] ?? 'warning',
    headline: tag(info, 'headline'),
    description: tag(info, 'description'),
    instruction: tag(info, 'instruction'),
    areaDesc: tag(info, 'areaDesc'),
    center,
    radiusKm,
    expires: Number.isNaN(exp) ? undefined : exp,
  };
}

/**
 * NDMA alerts. With `enrich` each item's CAP document is fetched to learn its area and severity, so
 * it can be filtered to the user's location; without it we return the latest items unfiltered.
 */
export async function fetchNdmaAlerts(
  near: Point | null,
  opts: { enrich?: boolean; limit?: number } = {},
  f: Fetcher = defaultFetch,
): Promise<AlertBody[]> {
  const res = await f('https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml');
  if (!res.ok) return [];
  const items = parseNdmaRss(await res.text()).slice(0, opts.limit ?? 40);
  const out: AlertBody[] = [];
  for (const it of items) {
    let cap: CapInfo | null = null;
    if (opts.enrich && it.link) {
      try {
        const r = await f(it.link);
        if (r.ok) cap = parseCap(await r.text());
      } catch {
        /* keep the RSS-only version */
      }
    }
    if (near) {
      if (cap?.center) {
        if (distanceKm(near, cap.center) > (cap.radiusKm ?? 50) + 25) continue;
      } else if (!relevantHere(it.author, near, `${cap?.areaDesc ?? ''} ${cap?.headline ?? ''} ${cap?.description ?? ''} ${it.title}`)) continue; // state-level match
    }
    out.push({
      id: `ndma-${it.id}`,
      title: cap?.headline || it.title.slice(0, 80),
      body: [cap?.areaDesc && `Area: ${cap.areaDesc}.`, cap?.description || (cap?.headline ? '' : it.title), cap?.instruction]
        .filter(Boolean)
        .join(' ')
        .slice(0, 600),
      severity: cap?.severity ?? 'warning',
      source: `NDMA · ${it.author.replace(/^.*\((.*)\)$/, '$1') || 'SACHET'}`,
      lat: cap?.center?.lat,
      lon: cap?.center?.lon,
      radiusKm: cap?.radiusKm,
      expires: cap?.expires ?? it.published + 24 * 3600_000,
    });
  }
  return out;
}

// ---------- all together ----------

export async function fetchAllAlerts(near: Point): Promise<AlertBody[]> {
  const results = await Promise.allSettled([
    fetchEarthquakes(near),
    fetchWeatherAlerts(near),
    fetchAirQuality(near),
    fetchNdmaAlerts(near, { enrich: true, limit: 25 }),
  ]);
  const all = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  const rank = { severe: 0, warning: 1, watch: 2, info: 3 } as const;
  return all.filter((a) => !a.expires || a.expires > Date.now()).sort((a, b) => rank[a.severity] - rank[b.severity]);
}
