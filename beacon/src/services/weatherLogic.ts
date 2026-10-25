// Pure weather helpers. No react-native or device imports, so this runs under node:test.

export interface WeatherNow {
  tempC: number;
  feelsC: number;
  humidity: number;
  windKmh: number;
  windDir: string;
  uv: number;
  code: number;
  isDay: boolean;
}

export interface HourPoint {
  t: number; // ms epoch
  tempC: number;
  code: number;
  isDay: boolean;
  rainMm: number;
  windKmh: number;
}

export interface DayPoint {
  date: string; // YYYY-MM-DD, location-local
  minC: number;
  maxC: number;
  code: number;
  rainMm: number;
  windMaxKmh: number;
  uvMax: number;
  sunrise: number; // ms epoch
  sunset: number; // ms epoch
}

export interface Forecast {
  place: string;
  lat: number;
  lon: number;
  fetchedAt: number;
  now: WeatherNow;
  hours: HourPoint[];
  days: DayPoint[];
  /** Which service produced this forecast. Missing on forecasts cached before this field existed. */
  source?: 'google' | 'open-meteo';
}

export interface WeatherNote {
  id: string;
  day: string | null;
  at: number | null;
  severity: 'info' | 'watch' | 'warning' | 'severe';
  title: string;
  body: string;
  icon: 'rain' | 'storm' | 'heat' | 'cold' | 'wind' | 'uv' | 'sun';
}

const STORM_CODES = new Set([95, 96, 99]);
const HAIL_CODES = new Set([96, 99]);
const SEVERITY_RANK: Record<WeatherNote['severity'], number> = { severe: 0, warning: 1, watch: 2, info: 3 };
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOUR_MS = 3_600_000;

const pad2 = (n: number) => String(n).padStart(2, '0');
const hourLabel = (t: number) => `${pad2(new Date(t).getHours())}:00`;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** WMO codes that bring precipitation (drizzle, rain, snow, showers, storms). */
export function isWetCode(code: number): boolean {
  return (code >= 51 && code <= 67) || (code >= 71 && code <= 77) || (code >= 80 && code <= 86) || code >= 95;
}

function isWetHour(h: HourPoint): boolean {
  return h.rainMm >= 0.2 || isWetCode(h.code);
}

export function conditionLabel(code: number, isDay: boolean): string {
  switch (code) {
    case 0:
      return isDay ? 'Clear and calm' : 'Clear night';
    case 1:
    case 2:
      return 'Partly cloudy';
    case 3:
      return 'Overcast';
    case 45:
    case 48:
      return 'Fog';
    case 51:
    case 53:
    case 55:
      return 'Drizzle';
    case 56:
    case 57:
      return 'Freezing drizzle';
    case 61:
    case 63:
    case 65:
      return 'Rain';
    case 66:
    case 67:
      return 'Freezing rain';
    case 71:
    case 73:
    case 75:
      return 'Snow';
    case 77:
      return 'Snow grains';
    case 80:
    case 81:
    case 82:
      return 'Rain showers';
    case 85:
    case 86:
      return 'Snow showers';
    case 95:
      return 'Thunderstorm';
    case 96:
    case 99:
      return 'Thunderstorm with hail';
    default:
      return 'Unsettled';
  }
}

export function conditionIcon(code: number, isDay: boolean): 'sun' | 'moon' | 'partly' | 'cloud' | 'fog' | 'rain' | 'storm' | 'snow' {
  if (code === 0) return isDay ? 'sun' : 'moon';
  if (code === 1 || code === 2) return 'partly';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if (STORM_CODES.has(code)) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (isWetCode(code)) return 'rain';
  return 'cloud';
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** 8-point compass name for a wind direction in degrees (the direction the wind comes from). '-' if not a number. */
export function compassFrom(deg: number): string {
  if (!Number.isFinite(deg)) return '-';
  const d = ((deg % 360) + 360) % 360;
  return POINTS[Math.round(d / 45) % 8];
}

export function sunArc(now: number, sunrise: number, sunset: number): { progress: number; isDaylight: boolean; minutesToSunset: number | null } {
  const span = sunset - sunrise;
  if (![now, sunrise, sunset].every(Number.isFinite) || span <= 0) {
    return { progress: 0, isDaylight: false, minutesToSunset: null };
  }
  const progress = Math.min(1, Math.max(0, (now - sunrise) / span));
  const isDaylight = now >= sunrise && now < sunset;
  return {
    progress,
    isDaylight,
    minutesToSunset: isDaylight ? Math.round((sunset - now) / 60_000) : null,
  };
}

export function summaryLine(f: Forecast): string {
  const n = f.now;
  const feels = `Feels like ${Math.round(n.feelsC)} deg`;
  const wind = `wind ${Math.round(n.windKmh)} km/h`;
  return n.windDir && n.windDir !== '-' ? `${feels}, ${wind} from the ${n.windDir}` : `${feels}, ${wind}`;
}

/** One line on the next 24 hours: the first rain or cooling change, else a dry-day summary. */
export function todayLine(hours: HourPoint[]): string {
  const window = hours.slice(0, 24);
  if (window.length === 0) return 'no hourly forecast yet';
  const first = window[0];
  const startWet = isWetHour(first);
  let peak = first.tempC;

  if (startWet) {
    const dry = window.find((h) => !isWetHour(h));
    if (dry) return `rain until ${new Date(dry.t).getHours()}`;
    return 'rain all day';
  }

  for (let i = 1; i < window.length; i++) {
    const h = window[i];
    if (isWetHour(h)) return `rain from ${new Date(h.t).getHours()}`;
    if (peak - h.tempC >= 4 - 1e-9) return `cooler after ${new Date(h.t).getHours()}`;
    peak = Math.max(peak, h.tempC);
  }
  return 'clear all day';
}

/** Headline for the week, counting distinct days with a watch-level or higher note. */
export function weekLine(notes: WeatherNote[]): string {
  const days = new Set<string>();
  for (const n of notes) if (n.day && n.severity !== 'info') days.add(n.day);
  if (days.size === 0) return 'nothing needs you this week';
  if (days.size === 1) {
    const day = [...days][0];
    const idx = new Date(`${day}T00:00:00Z`).getUTCDay();
    return `only ${Number.isNaN(idx) ? day : WEEKDAYS[idx]} needs you`;
  }
  return `${days.size} days need you`;
}

function rainSeverity(mm: number): WeatherNote['severity'] | null {
  if (mm >= 65) return 'severe';
  if (mm >= 35) return 'warning';
  if (mm >= 15) return 'watch';
  return null;
}

/** The day a timestamp belongs to: the last day whose sunrise is at or before it (earliest day if none). */
function dayFor(days: DayPoint[], t: number): string | null {
  if (days.length === 0) return null;
  let pick = days[0].date;
  for (const d of days) if (Number.isFinite(d.sunrise) && d.sunrise <= t) pick = d.date;
  return pick;
}

const keyTime = (n: WeatherNote) => n.at ?? (n.day ? Date.parse(`${n.day}T00:00:00Z`) : 0);

/** Notes for the week, most severe first, then earliest. */
export function forecastNotes(f: Forecast): WeatherNote[] {
  const out: WeatherNote[] = [];

  // First storm hour per day, so the day's storm note carries a time.
  const stormHour = new Map<string, HourPoint>();
  for (const h of f.hours) {
    if (!STORM_CODES.has(h.code)) continue;
    const day = dayFor(f.days, h.t);
    if (day && !stormHour.has(day)) stormHour.set(day, h);
  }

  for (const d of f.days) {
    const rain = rainSeverity(d.rainMm);
    if (rain) {
      const title = rain === 'severe' ? 'Very heavy rain' : rain === 'warning' ? 'Heavy rain' : 'Rain expected';
      out.push({
        id: `rain-${d.date}`,
        day: d.date,
        at: null,
        severity: rain,
        title,
        body: `About ${round1(d.rainMm)} mm of rain is forecast for the day.`,
        icon: 'rain',
      });
    }

    const sh = stormHour.get(d.date);
    if (sh || STORM_CODES.has(d.code)) {
      const code = sh ? sh.code : d.code;
      const hail = HAIL_CODES.has(code);
      out.push({
        id: `storm-${d.date}`,
        day: d.date,
        at: sh ? sh.t : null,
        severity: hail ? 'warning' : 'watch',
        title: hail ? 'Thunderstorm with hail' : 'Thunderstorms',
        body: sh ? `Thunderstorms are forecast from ${hourLabel(sh.t)}.` : 'Thunderstorms are forecast for the day.',
        icon: 'storm',
      });
    }

    if (d.windMaxKmh >= 40) {
      const warn = d.windMaxKmh >= 60;
      out.push({
        id: `wind-${d.date}`,
        day: d.date,
        at: null,
        severity: warn ? 'warning' : 'watch',
        title: warn ? 'Strong gusts' : 'Gusty winds',
        body: `Gusts up to ${Math.round(d.windMaxKmh)} km/h are forecast.`,
        icon: 'wind',
      });
    }

    if (d.maxC >= 38) {
      const sev = d.maxC >= 45 ? 'severe' : d.maxC >= 41 ? 'warning' : 'watch';
      const title = sev === 'severe' ? 'Dangerous heat' : sev === 'warning' ? 'Extreme heat' : 'Hot day';
      out.push({
        id: `heat-${d.date}`,
        day: d.date,
        at: null,
        severity: sev,
        title,
        body: `Highs of ${Math.round(d.maxC)} deg C are forecast.`,
        icon: 'heat',
      });
    }

    if (d.minC <= 4) {
      const warn = d.minC <= 0;
      out.push({
        id: `cold-${d.date}`,
        day: d.date,
        at: null,
        severity: warn ? 'warning' : 'watch',
        title: warn ? 'Freezing temperatures' : 'Cold night',
        body: `Lows near ${Math.round(d.minC)} deg C are forecast.`,
        icon: 'cold',
      });
    }

    if (d.uvMax >= 11) {
      out.push({
        id: `uv-${d.date}`,
        day: d.date,
        at: null,
        severity: 'watch',
        title: 'Very high UV',
        body: `UV index peaks at ${Math.round(d.uvMax)}, so cover up and seek shade around midday.`,
        icon: 'uv',
      });
    }
  }

  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || keyTime(a) - keyTime(b));
}

// ---- Open-Meteo parsing (defensive) ----

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const list = (o: Obj | undefined, key: string): unknown[] => {
  const v = o?.[key];
  return Array.isArray(v) ? v : [];
};

/**
 * Builds a Forecast from an Open-Meteo response. Times arrive as location-local strings, so they are
 * converted with the response's utc_offset_seconds. Returns null when the current conditions or the daily list are unusable.
 */
export function parseForecast(
  raw: unknown,
  meta: { lat: number; lon: number; place: string; fetchedAt: number },
): Forecast | null {
  if (!isObj(raw)) return null;
  const offsetMs = (num(raw.utc_offset_seconds) ?? 0) * 1000;
  const toMs = (s: unknown): number | null => {
    if (typeof s !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - offsetMs;
  };

  const cur = isObj(raw.current) ? raw.current : undefined;
  const tempC = num(cur?.temperature_2m);
  if (!cur || tempC === null) return null;
  const windDeg = num(cur.wind_direction_10m);
  const now: WeatherNow = {
    tempC,
    feelsC: num(cur.apparent_temperature) ?? tempC,
    humidity: num(cur.relative_humidity_2m) ?? 0,
    windKmh: num(cur.wind_speed_10m) ?? 0,
    windDir: compassFrom(windDeg ?? NaN),
    uv: num(cur.uv_index) ?? 0,
    code: num(cur.weather_code) ?? 0,
    isDay: num(cur.is_day) === 1,
  };

  const hourly = isObj(raw.hourly) ? raw.hourly : undefined;
  const hTimes = list(hourly, 'time');
  const hTemp = list(hourly, 'temperature_2m');
  const hCode = list(hourly, 'weather_code');
  const hDay = list(hourly, 'is_day');
  const hRain = list(hourly, 'precipitation');
  const hWind = list(hourly, 'wind_speed_10m');
  const hours: HourPoint[] = [];
  for (let i = 0; i < hTimes.length && hours.length < 30; i++) {
    const t = toMs(hTimes[i]);
    const temp = num(hTemp[i]);
    // Keep the hour containing "now" and everything after it.
    if (t === null || temp === null || t + HOUR_MS <= meta.fetchedAt) continue;
    hours.push({
      t,
      tempC: temp,
      code: num(hCode[i]) ?? 0,
      isDay: num(hDay[i]) === 1,
      rainMm: num(hRain[i]) ?? 0,
      windKmh: num(hWind[i]) ?? 0,
    });
  }

  const daily = isObj(raw.daily) ? raw.daily : undefined;
  const dTimes = list(daily, 'time');
  const dMin = list(daily, 'temperature_2m_min');
  const dMax = list(daily, 'temperature_2m_max');
  const dCode = list(daily, 'weather_code');
  const dRain = list(daily, 'precipitation_sum');
  const dWind = list(daily, 'wind_speed_10m_max');
  const dUv = list(daily, 'uv_index_max');
  const dRise = list(daily, 'sunrise');
  const dSet = list(daily, 'sunset');
  const days: DayPoint[] = [];
  for (let i = 0; i < dTimes.length && days.length < 7; i++) {
    const minC = num(dMin[i]);
    const maxC = num(dMax[i]);
    const date = typeof dTimes[i] === 'string' ? (dTimes[i] as string).slice(0, 10) : '';
    if (minC === null || maxC === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    days.push({
      date,
      minC,
      maxC,
      code: num(dCode[i]) ?? 0,
      rainMm: num(dRain[i]) ?? 0,
      windMaxKmh: num(dWind[i]) ?? 0,
      uvMax: num(dUv[i]) ?? 0,
      sunrise: toMs(dRise[i]) ?? NaN,
      sunset: toMs(dSet[i]) ?? NaN,
    });
  }
  if (days.length === 0) return null;

  return { place: meta.place, lat: meta.lat, lon: meta.lon, fetchedAt: meta.fetchedAt, now, hours, days };
}
