// Google Maps Platform Weather API (weather.googleapis.com). Pure builders and mapping, plus one network helper.
// Field names follow https://developers.google.com/maps/documentation/weather (current conditions, hourly, daily).
// Any field or unit this module does not recognise makes the parse fail, so the caller falls back to Open-Meteo.

import { compassFrom, type DayPoint, type Forecast, type HourPoint, type WeatherNow } from './weatherLogic';

const BASE = 'https://weather.googleapis.com/v1';
const TIMEOUT_MS = 8000;
const HOUR_MS = 3_600_000;

/**
 * Google WeatherCondition.type mapped to the app's WMO-like codes (see conditionLabel/conditionIcon in weatherLogic).
 * Closest match only: the app has no code for sleet, hail showers or wind alone, so those use the nearest code.
 * Unknown or unspecified types map to -1, which shows as "Unsettled".
 */
export const GOOGLE_CONDITION_CODES: Record<string, number> = {
  CLEAR: 0,
  MOSTLY_CLEAR: 1,
  PARTLY_CLOUDY: 2,
  MOSTLY_CLOUDY: 2,
  CLOUDY: 3,
  WINDY: 2,
  WIND_AND_RAIN: 61,
  LIGHT_RAIN_SHOWERS: 80,
  CHANCE_OF_SHOWERS: 80,
  SCATTERED_SHOWERS: 80,
  RAIN_SHOWERS: 81,
  HEAVY_RAIN_SHOWERS: 82,
  LIGHT_TO_MODERATE_RAIN: 61,
  MODERATE_TO_HEAVY_RAIN: 65,
  RAIN: 63,
  LIGHT_RAIN: 61,
  HEAVY_RAIN: 65,
  RAIN_PERIODICALLY_HEAVY: 65,
  LIGHT_SNOW_SHOWERS: 85,
  CHANCE_OF_SNOW_SHOWERS: 85,
  SCATTERED_SNOW_SHOWERS: 85,
  SNOW_SHOWERS: 85,
  HEAVY_SNOW_SHOWERS: 86,
  LIGHT_TO_MODERATE_SNOW: 73,
  MODERATE_TO_HEAVY_SNOW: 75,
  SNOW: 73,
  LIGHT_SNOW: 71,
  HEAVY_SNOW: 75,
  SNOWSTORM: 75,
  SNOW_PERIODICALLY_HEAVY: 75,
  HEAVY_SNOW_STORM: 75,
  BLOWING_SNOW: 75,
  RAIN_AND_SNOW: 73,
  HAIL: 96,
  HAIL_SHOWERS: 96,
  THUNDERSTORM: 95,
  THUNDERSHOWER: 95,
  LIGHT_THUNDERSTORM_RAIN: 95,
  SCATTERED_THUNDERSTORMS: 95,
  HEAVY_THUNDERSTORM: 95,
};

/** The app code for a Google condition type. -1 when the type is missing or not in the table. */
export function wmoCodeFor(type: unknown): number {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(GOOGLE_CONDITION_CODES, type)
    ? GOOGLE_CONDITION_CODES[type]
    : -1;
}

// ---- request builders (return URLs; no network) ----

function query(key: string, lat: number, lon: number, extra: string[]): string {
  return [`key=${encodeURIComponent(key)}`, `location.latitude=${lat}`, `location.longitude=${lon}`, ...extra].join('&');
}

/** Current conditions. Metric units requested explicitly (unitsSystem is documented for this endpoint). */
export function googleCurrentUrl(key: string, lat: number, lon: number): string {
  return `${BASE}/currentConditions:lookup?${query(key, lat, lon, ['unitsSystem=METRIC'])}`;
}

/** Hourly forecast starting at the current hour. One page of up to 24 hours. */
export function googleHoursUrl(key: string, lat: number, lon: number, hours = 24): string {
  return `${BASE}/forecast/hours:lookup?${query(key, lat, lon, [`hours=${hours}`])}`;
}

/** Daily forecast for the next `days` days (1 to 10 per the docs). One page, so pageSize matches the day count. */
export function googleDaysUrl(key: string, lat: number, lon: number, days = 7): string {
  return `${BASE}/forecast/days:lookup?${query(key, lat, lon, [`days=${days}`, `pageSize=${days}`, 'unitsSystem=METRIC'])}`;
}

// ---- mapping (pure) ----

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Obj | undefined => (isObj(v) ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Unit mismatch or malformed value. parseGoogleForecast catches this and returns null. */
class UnitError extends Error {}

/** Google sends zero values without their unit in some cases, so a zero with no unit reads as zero. */
function celsius(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  const o = obj(v);
  if (!o) throw new UnitError('temperature');
  const d = num(o.degrees) ?? 0;
  if (o.unit === 'CELSIUS') return d;
  if (o.unit === 'FAHRENHEIT') return ((d - 32) * 5) / 9;
  if (d === 0 && o.unit === undefined) return 0;
  throw new UnitError('temperature unit');
}

function kmh(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  const o = obj(v);
  if (!o) throw new UnitError('speed');
  const s = num(o.value) ?? 0;
  if (o.unit === 'KILOMETERS_PER_HOUR' || (s === 0 && o.unit === undefined)) return s;
  throw new UnitError('speed unit');
}

/** precipitation.qpf: amount in mm or inches. Absent means no rain. */
function mm(v: unknown): number {
  if (v === undefined) return 0;
  const o = obj(v);
  if (!o) throw new UnitError('qpf');
  const q = num(o.quantity) ?? 0;
  if (q === 0) return 0;
  if (o.unit === 'MILLIMETERS') return q;
  if (o.unit === 'INCHES') return q * 25.4;
  throw new UnitError('qpf unit');
}

/** RFC 3339 time. Fractional seconds are trimmed to milliseconds because some JS engines reject more digits. */
function ms(s: unknown): number {
  if (typeof s !== 'string') return NaN;
  return Date.parse(s.replace(/(\.\d{3})\d+/, '$1'));
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Builds a Forecast from the three Google responses (the full JSON bodies). Returns null when the current
 * conditions, the daily list or any unit is unusable, so the caller falls back to Open-Meteo.
 */
export function parseGoogleForecast(
  current: unknown,
  hours: unknown,
  days: unknown,
  meta: { lat: number; lon: number; place: string; fetchedAt: number },
): Forecast | null {
  try {
    const cur = obj(current);
    const tempC = celsius(cur?.temperature);
    if (!cur || tempC === undefined) return null;
    const dir = obj(cur.wind)?.direction;
    const now: WeatherNow = {
      tempC,
      feelsC: celsius(cur.feelsLikeTemperature) ?? tempC,
      humidity: num(cur.relativeHumidity) ?? 0,
      windKmh: kmh(obj(cur.wind)?.speed) ?? 0,
      windDir: compassFrom(num(obj(dir)?.degrees) ?? (dir ? 0 : NaN)),
      uv: num(cur.uvIndex) ?? 0,
      code: wmoCodeFor(obj(cur.weatherCondition)?.type),
      isDay: cur.isDaytime === true,
    };

    const hourList: HourPoint[] = [];
    for (const item of arr(obj(hours)?.forecastHours)) {
      const h = obj(item);
      const t = ms(obj(h?.interval)?.startTime);
      const temp = celsius(h?.temperature);
      // keep the hour containing "now" and everything after it, as the Open-Meteo parser does
      if (!h || !Number.isFinite(t) || temp === undefined || t + HOUR_MS <= meta.fetchedAt) continue;
      hourList.push({
        t,
        tempC: temp,
        code: wmoCodeFor(obj(h.weatherCondition)?.type),
        isDay: h.isDaytime === true,
        rainMm: mm(obj(h.precipitation)?.qpf),
        windKmh: kmh(obj(h.wind)?.speed) ?? 0,
      });
      if (hourList.length >= 30) break;
    }

    const dayList: DayPoint[] = [];
    for (const item of arr(obj(days)?.forecastDays)) {
      const d = obj(item);
      const date = obj(d?.displayDate);
      if (!d || !date || num(date.year) === null || num(date.month) === null || num(date.day) === null) continue;
      const minC = celsius(d.minTemperature);
      const maxC = celsius(d.maxTemperature);
      if (minC === undefined || maxC === undefined) continue;
      const day = obj(d.daytimeForecast);
      const night = obj(d.nighttimeForecast);
      const sun = obj(d.sunEvents);
      const windMax = Math.max(kmh(obj(day?.wind)?.speed) ?? 0, kmh(obj(night?.wind)?.speed) ?? 0);
      dayList.push({
        date: `${num(date.year)}-${pad2(num(date.month) ?? 0)}-${pad2(num(date.day) ?? 0)}`,
        minC,
        maxC,
        code: wmoCodeFor(obj(day?.weatherCondition)?.type ?? obj(night?.weatherCondition)?.type),
        rainMm: mm(obj(day?.precipitation)?.qpf) + mm(obj(night?.precipitation)?.qpf),
        windMaxKmh: windMax,
        uvMax: num(day?.uvIndex) ?? 0,
        sunrise: ms(sun?.sunriseTime),
        sunset: ms(sun?.sunsetTime),
      });
      if (dayList.length >= 7) break;
    }
    if (dayList.length === 0) return null;

    return { place: meta.place, lat: meta.lat, lon: meta.lon, fetchedAt: meta.fetchedAt, now, hours: hourList, days: dayList, source: 'google' };
  } catch (e) {
    if (e instanceof UnitError) return null;
    throw e;
  }
}

// ---- network ----

async function getJson(url: string): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`Google Weather returned ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Fetches current, hourly and daily forecasts and maps them to a Forecast with source 'google'. Throws on any failure. */
export async function fetchGoogleForecast(key: string, lat: number, lon: number): Promise<Forecast> {
  const fetchedAt = Date.now();
  const [current, hours, days] = await Promise.all([
    getJson(googleCurrentUrl(key, lat, lon)),
    getJson(googleHoursUrl(key, lat, lon)),
    getJson(googleDaysUrl(key, lat, lon)),
  ]);
  const f = parseGoogleForecast(current, hours, days, { lat, lon, place: '', fetchedAt });
  if (!f) throw new Error('Unexpected Google weather data');
  return f;
}
