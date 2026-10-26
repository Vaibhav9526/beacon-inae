// OpenWeatherMap: pure URL builders, parsers and FeedItem mapping. No network in here; nodes.ts does the fetching.
// Endpoints (checked against openweathermap.org docs):
//   current   GET https://api.openweathermap.org/data/2.5/weather?lat&lon&units=metric&appid
//   forecast  GET https://api.openweathermap.org/data/2.5/forecast?lat&lon&units=metric&cnt&appid   (3 hour steps)
//   air       GET https://api.openweathermap.org/data/2.5/air_pollution[/forecast]?lat&lon&appid
//   one call  GET https://api.openweathermap.org/data/3.0/onecall?lat&lon&units=metric&exclude&appid (separate subscription)
// Wind speed arrives in m/s with units=metric; everything shown here is converted to km/h.

import { createHash } from 'node:crypto';
import type { FeedKind, Severity } from './types.ts';
import { SEVERITY_RANK } from './types.ts';

export const OWM_BASE = 'https://api.openweathermap.org';
export const OWM_PARTS = ['all', 'wind', 'rain', 'temperature', 'air', 'alerts'] as const;
export type OwmPart = (typeof OWM_PARTS)[number];

export const MSG_NO_KEY = 'Add your OpenWeather key in Connections';
export const MSG_401 = 'OpenWeather rejected the key (new keys can take up to a couple of hours to start working)';
export const MSG_401_ONECALL = 'One Call needs the One Call by Call subscription on your OpenWeather account';
export const MSG_429 = 'OpenWeather rate limit reached';

const enc = encodeURIComponent;
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
const r0 = (v: number) => Math.round(v);
const kmh = (ms: number) => r1(ms * 3.6);

// ---------------------------------------------------------------------------
// URLs and key hygiene

function coords(lat: number, lon: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('This agent has no place');
  return `lat=${enc(String(lat))}&lon=${enc(String(lon))}`;
}
export const currentUrl = (lat: number, lon: number, key: string) =>
  `${OWM_BASE}/data/2.5/weather?${coords(lat, lon)}&units=metric&appid=${enc(key)}`;
export const forecastUrl = (lat: number, lon: number, key: string, cnt = 16) =>
  `${OWM_BASE}/data/2.5/forecast?${coords(lat, lon)}&units=metric&cnt=${enc(String(cnt))}&appid=${enc(key)}`;
export const airUrl = (lat: number, lon: number, key: string) =>
  `${OWM_BASE}/data/2.5/air_pollution?${coords(lat, lon)}&appid=${enc(key)}`;
export const airForecastUrl = (lat: number, lon: number, key: string) =>
  `${OWM_BASE}/data/2.5/air_pollution/forecast?${coords(lat, lon)}&appid=${enc(key)}`;
export const oneCallUrl = (lat: number, lon: number, key: string) =>
  `${OWM_BASE}/data/3.0/onecall?${coords(lat, lon)}&units=metric&exclude=minutely&appid=${enc(key)}`;

/** Removes the API key from any text (URLs, error messages) before it can reach a log or the UI. */
export function redactKey(text: string, key?: string): string {
  let out = String(text).replace(/appid=[^&\s"'<>]*/gi, 'appid=[hidden]');
  if (key && key.length >= 4) out = out.split(key).join('[hidden]').split(enc(key)).join('[hidden]');
  return out;
}

/** Cleans a pasted key: trims, strips quotes, and removes any whitespace inside. */
export function cleanOwmKey(input: unknown): string {
  return String(input ?? '').trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, '');
}

// ---------------------------------------------------------------------------
// severity rules (exported so tests can pin the boundaries)

const rank = (s: Severity) => SEVERITY_RANK[s];
export const maxSeverity = (...xs: Severity[]): Severity => xs.reduce((a, b) => (rank(b) > rank(a) ? b : a), 'info' as Severity);

export function gustSeverity(gustKmh: number | undefined): Severity {
  if (gustKmh === undefined) return 'info';
  return gustKmh >= 90 ? 'severe' : gustKmh >= 60 ? 'warning' : gustKmh >= 40 ? 'watch' : 'info';
}
export function heatSeverity(feelsC: number | undefined): Severity {
  if (feelsC === undefined) return 'info';
  return feelsC >= 45 ? 'severe' : feelsC >= 41 ? 'warning' : feelsC >= 38 ? 'watch' : 'info';
}
export function coldSeverity(tempC: number | undefined): Severity {
  if (tempC === undefined) return 'info';
  return tempC <= 0 ? 'warning' : tempC <= 4 ? 'watch' : 'info';
}
/** Rain in mm over three hours. */
export function rainSeverity(mm3h: number | undefined): Severity {
  if (mm3h === undefined) return 'info';
  return mm3h >= 60 ? 'severe' : mm3h >= 30 ? 'warning' : mm3h >= 15 ? 'watch' : 'info';
}
/** Likely rain (pop 0..1) with a real amount (mm) is a watch. */
export function popSeverity(pop: number | undefined, mm: number | undefined): Severity {
  return pop !== undefined && mm !== undefined && pop >= 0.7 && mm >= 10 ? 'watch' : 'info';
}
export function airSeverity(aqi: number | undefined, pm25: number | undefined): Severity {
  if (aqi !== undefined && aqi >= 5) return 'severe';
  if (aqi !== undefined && aqi >= 4) return 'warning';
  if (pm25 !== undefined && pm25 >= 90) return 'warning';
  return 'info';
}
/** OWM weather condition id: 200-232 thunderstorm, 781 tornado. */
export function conditionSeverity(id: number | undefined): Severity {
  if (id === undefined) return 'info';
  if (id === 781) return 'severe';
  if (id >= 200 && id <= 232) return (id >= 210 && id <= 221) || id === 202 || id === 232 ? 'warning' : 'watch';
  return 'info';
}
export function uvSeverity(uvi: number | undefined): Severity {
  if (uvi === undefined) return 'info';
  return uvi >= 11 ? 'warning' : uvi >= 8 ? 'watch' : 'info';
}

const AQI_WORDS = ['unknown', 'Good', 'Fair', 'Moderate', 'Poor', 'Very poor'];
export const aqiWord = (aqi: number | undefined) => AQI_WORDS[aqi !== undefined && aqi >= 1 && aqi <= 5 ? Math.round(aqi) : 0];

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const compass = (deg: number | undefined) => (deg === undefined ? '' : COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]);

// ---------------------------------------------------------------------------
// parsers

function expectObject(json: unknown, what: string): Record<string, unknown> {
  if (!isObj(json)) throw new Error(`OpenWeather sent an unexpected answer for ${what}`);
  const cod = json.cod !== undefined ? Number(json.cod) : 200;
  if (Number.isFinite(cod) && cod !== 200) {
    if (cod === 401) throw new Error(MSG_401);
    if (cod === 429) throw new Error(MSG_429);
    throw new Error(`OpenWeather answered with an error (${cod}) for ${what}`);
  }
  return json;
}

export interface Current {
  at: number; // ms
  tzOffsetS: number;
  name?: string;
  tempC?: number;
  feelsC?: number;
  humidity?: number;
  pressure?: number;
  windKmh?: number;
  gustKmh?: number;
  windDeg?: number;
  clouds?: number;
  visibilityKm?: number;
  rain1h: number;
  snow1h: number;
  conditionId?: number;
  condition?: string;
  sunrise?: number; // ms
  sunset?: number;
}

export function parseCurrent(json: unknown): Current {
  const o = expectObject(json, 'current weather');
  const main = isObj(o.main) ? o.main : {};
  const wind = isObj(o.wind) ? o.wind : {};
  const sys = isObj(o.sys) ? o.sys : {};
  const w0 = Array.isArray(o.weather) && isObj(o.weather[0]) ? (o.weather[0] as Record<string, unknown>) : {};
  const rain = isObj(o.rain) ? o.rain : {};
  const snow = isObj(o.snow) ? o.snow : {};
  const speed = num(wind.speed);
  const gust = num(wind.gust);
  const vis = num(o.visibility);
  const sunrise = num(sys.sunrise);
  const sunset = num(sys.sunset);
  return {
    at: (num(o.dt) ?? 0) * 1000,
    tzOffsetS: num(o.timezone) ?? 0,
    name: typeof o.name === 'string' && o.name ? o.name : undefined,
    tempC: num(main.temp),
    feelsC: num(main.feels_like),
    humidity: num(main.humidity),
    pressure: num(main.pressure),
    windKmh: speed === undefined ? undefined : kmh(speed),
    gustKmh: gust === undefined ? undefined : kmh(gust),
    windDeg: num(wind.deg),
    clouds: isObj(o.clouds) ? num(o.clouds.all) : undefined,
    visibilityKm: vis === undefined ? undefined : r1(vis / 1000),
    rain1h: num(rain['1h']) ?? 0,
    snow1h: num(snow['1h']) ?? 0,
    conditionId: num(w0.id),
    condition: typeof w0.description === 'string' ? w0.description : undefined,
    sunrise: sunrise === undefined ? undefined : sunrise * 1000,
    sunset: sunset === undefined ? undefined : sunset * 1000,
  };
}

export interface ForecastSlot {
  at: number;
  tempC?: number;
  feelsC?: number;
  pop: number;
  rain3h: number;
  snow3h: number;
  windKmh?: number;
  gustKmh?: number;
  conditionId?: number;
  condition?: string;
}
export interface Forecast {
  tzOffsetS: number;
  name?: string;
  slots: ForecastSlot[];
}

export function parseForecast(json: unknown): Forecast {
  const o = expectObject(json, 'the forecast');
  if (!Array.isArray(o.list)) throw new Error('OpenWeather sent an unexpected answer for the forecast');
  const city = isObj(o.city) ? o.city : {};
  const slots: ForecastSlot[] = [];
  for (const raw of o.list) {
    if (!isObj(raw)) continue;
    const main = isObj(raw.main) ? raw.main : {};
    const wind = isObj(raw.wind) ? raw.wind : {};
    const w0 = Array.isArray(raw.weather) && isObj(raw.weather[0]) ? (raw.weather[0] as Record<string, unknown>) : {};
    const speed = num(wind.speed);
    const gust = num(wind.gust);
    slots.push({
      at: (num(raw.dt) ?? 0) * 1000,
      tempC: num(main.temp),
      feelsC: num(main.feels_like),
      pop: num(raw.pop) ?? 0,
      rain3h: isObj(raw.rain) ? num(raw.rain['3h']) ?? 0 : 0,
      snow3h: isObj(raw.snow) ? num(raw.snow['3h']) ?? 0 : 0,
      windKmh: speed === undefined ? undefined : kmh(speed),
      gustKmh: gust === undefined ? undefined : kmh(gust),
      conditionId: num(w0.id),
      condition: typeof w0.description === 'string' ? w0.description : undefined,
    });
  }
  return { tzOffsetS: num(city.timezone) ?? 0, name: typeof city.name === 'string' && city.name ? city.name : undefined, slots };
}

export interface AirReading {
  at: number;
  aqi?: number;
  co?: number;
  no?: number;
  no2?: number;
  o3?: number;
  so2?: number;
  pm25?: number;
  pm10?: number;
  nh3?: number;
}

export function parseAir(json: unknown): AirReading[] {
  const o = expectObject(json, 'air quality');
  if (!Array.isArray(o.list)) throw new Error('OpenWeather sent an unexpected answer for air quality');
  const out: AirReading[] = [];
  for (const raw of o.list) {
    if (!isObj(raw)) continue;
    const main = isObj(raw.main) ? raw.main : {};
    const c = isObj(raw.components) ? raw.components : {};
    out.push({
      at: (num(raw.dt) ?? 0) * 1000,
      aqi: num(main.aqi),
      co: num(c.co), no: num(c.no), no2: num(c.no2), o3: num(c.o3), so2: num(c.so2),
      pm25: num(c.pm2_5), pm10: num(c.pm10), nh3: num(c.nh3),
    });
  }
  return out;
}

export interface OneCallAlert {
  sender: string;
  event: string;
  start: number;
  end: number;
  description: string;
}
export interface OneCallHour {
  at: number;
  tempC?: number;
  feelsC?: number;
  pop: number;
  rain1h: number;
  windKmh?: number;
  gustKmh?: number;
  uvi?: number;
}
export interface OneCall {
  tzOffsetS: number;
  uvi?: number;
  hourly: OneCallHour[];
  alerts: OneCallAlert[];
}

export function parseOneCall(json: unknown): OneCall {
  const o = expectObject(json, 'One Call');
  const cur = isObj(o.current) ? o.current : {};
  const hourly: OneCallHour[] = [];
  for (const raw of Array.isArray(o.hourly) ? o.hourly : []) {
    if (!isObj(raw)) continue;
    const speed = num(raw.wind_speed);
    const gust = num(raw.wind_gust);
    hourly.push({
      at: (num(raw.dt) ?? 0) * 1000,
      tempC: num(raw.temp),
      feelsC: num(raw.feels_like),
      pop: num(raw.pop) ?? 0,
      rain1h: isObj(raw.rain) ? num(raw.rain['1h']) ?? 0 : 0,
      windKmh: speed === undefined ? undefined : kmh(speed),
      gustKmh: gust === undefined ? undefined : kmh(gust),
      uvi: num(raw.uvi),
    });
  }
  const alerts: OneCallAlert[] = [];
  for (const raw of Array.isArray(o.alerts) ? o.alerts : []) {
    if (!isObj(raw)) continue;
    alerts.push({
      sender: typeof raw.sender_name === 'string' ? raw.sender_name : '',
      event: typeof raw.event === 'string' && raw.event ? raw.event : 'Weather alert',
      start: (num(raw.start) ?? 0) * 1000,
      end: (num(raw.end) ?? 0) * 1000,
      description: typeof raw.description === 'string' ? raw.description : '',
    });
  }
  return { tzOffsetS: num(o.timezone_offset) ?? 0, uvi: num(cur.uvi), hourly, alerts };
}

// ---------------------------------------------------------------------------
// FeedItem drafts

export interface OwmDraft {
  kind: FeedKind;
  title: string;
  body: string;
  detail: string;
  severity: Severity;
  at: number;
  tags: string[];
  data: Record<string, number | string>;
  /** distinguishes items from one node (the part, or the alert) so ids stay unique */
  slot: string;
}

const HOURS3 = 3 * 3600 * 1000;

/** Stable id: same node, place, kind, part, severity and 3-hour window give the same id, so repeats de-duplicate. */
export function owmItemId(kind: string, place: string | undefined, nodeId: string, slot: string, severity: Severity, at: number): string {
  const bucket = Math.floor(at / HOURS3);
  return createHash('sha256').update(`owm\n${kind}\n${place ?? ''}\n${nodeId}\n${slot}\n${severity}\n${bucket}`).digest('hex').slice(0, 16);
}

const pad = (n: number) => String(n).padStart(2, '0');
/** HH:MM at the place (offset from the API). */
function clockAt(ms: number, tzOffsetS: number): string {
  const d = new Date(ms + tzOffsetS * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function dayClockAt(ms: number, tzOffsetS: number): string {
  const d = new Date(ms + tzOffsetS * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

const lc = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const put = (data: Record<string, number | string>, k: string, v: number | undefined) => {
  if (v !== undefined && Number.isFinite(v)) data[k] = v;
};
const capDetail = (lines: string[]) => lines.filter(Boolean).join('\n').slice(0, 1500);
const wants = (part: OwmPart, ...ok: OwmPart[]) => part === 'all' || ok.includes(part);
const where = (place?: string) => (place ? `${place}: ` : '');

export function currentDrafts(c: Current, part: OwmPart, place?: string): OwmDraft[] {
  const rain3 = c.rain1h * 3; // projected 3 h amount from the last hour's rate
  const out: OwmDraft[] = [];
  const at = c.at || 0;
  const wind = () => {
    const bits = [`Wind ${c.windKmh ?? 'n/a'} km/h${c.windDeg !== undefined ? ` from the ${compass(c.windDeg)}` : ''}`];
    if (c.gustKmh !== undefined) bits.push(`gusts ${c.gustKmh} km/h`);
    return bits.join(', ');
  };
  const rainLine = () => `Rain ${c.rain1h} mm in the last hour. Snow ${c.snow1h} mm.`;
  const tempLine = () => `Temperature ${c.tempC ?? 'n/a'} C, feels like ${c.feelsC ?? 'n/a'} C. Humidity ${c.humidity ?? 'n/a'}%.`;
  const rest = () => [
    `Pressure ${c.pressure ?? 'n/a'} hPa. Clouds ${c.clouds ?? 'n/a'}%. Visibility ${c.visibilityKm ?? 'n/a'} km.`,
    c.sunrise ? `Sunrise ${clockAt(c.sunrise, c.tzOffsetS)}, sunset ${c.sunset ? clockAt(c.sunset, c.tzOffsetS) : 'n/a'}.` : '',
  ];
  const data: Record<string, number | string> = {};
  put(data, 'temp_c', c.tempC); put(data, 'feels_like_c', c.feelsC); put(data, 'humidity_pct', c.humidity);
  put(data, 'pressure_hpa', c.pressure); put(data, 'wind_kmh', c.windKmh); put(data, 'wind_gust_kmh', c.gustKmh);
  put(data, 'wind_dir_deg', c.windDeg);
  put(data, 'clouds_pct', c.clouds); put(data, 'visibility_km', c.visibilityKm);
  data.rain_mm_1h = c.rain1h; data.snow_mm_1h = c.snow1h;
  const base = { at, tags: ['owm', 'current'], };

  if (wants(part, 'temperature')) {
    const sev = maxSeverity(heatSeverity(c.feelsC), coldSeverity(c.tempC), conditionSeverity(c.conditionId));
    const all = part === 'all';
    out.push({
      ...base, slot: all ? 'current' : 'temperature', kind: 'weather', severity: sev, data,
      title: `${where(place)}${c.tempC !== undefined ? r0(c.tempC) : '?'} C, feels like ${c.feelsC !== undefined ? r0(c.feelsC) : '?'} C${c.condition ? `, ${c.condition}` : ''}`,
      body: all ? `${tempLine()} ${wind()}. ${rainLine()}` : tempLine(),
      detail: capDetail([`${lc(c.condition ?? 'Current weather')}.`, tempLine(), wind() + '.', rainLine(), ...rest()]),
    });
    if (all) return out;
  }
  if (wants(part, 'wind')) {
    out.push({
      ...base, slot: 'wind', kind: 'wind', severity: gustSeverity(c.gustKmh ?? c.windKmh), data,
      title: `${where(place)}wind ${c.windKmh ?? '?'} km/h${c.gustKmh !== undefined ? `, gusts ${c.gustKmh} km/h` : ''}`,
      body: `${wind()}.`, detail: capDetail([wind() + '.', `Clouds ${c.clouds ?? 'n/a'}%. Visibility ${c.visibilityKm ?? 'n/a'} km.`]),
    });
  }
  if (wants(part, 'rain')) {
    out.push({
      ...base, slot: 'rain', kind: 'flood', severity: rainSeverity(rain3), data,
      title: `${where(place)}rain ${c.rain1h} mm in the last hour`,
      body: rainLine(), detail: capDetail([rainLine(), c.condition ? `${lc(c.condition)}.` : '', `Humidity ${c.humidity ?? 'n/a'}%.`]),
    });
  }
  return out;
}

export function forecastDrafts(f: Forecast, part: OwmPart, place?: string): OwmDraft[] {
  const next = f.slots.slice(0, 8); // 8 slots of 3 hours = 24 hours
  if (!next.length) return [];
  const at = next[0].at;
  const temps = next.filter((s) => s.tempC !== undefined);
  const cold = temps.reduce((a, s) => (a === null || (s.tempC as number) < (a.tempC as number) ? s : a), null as ForecastSlot | null);
  const hot = temps.reduce((a, s) => (a === null || (s.tempC as number) > (a.tempC as number) ? s : a), null as ForecastSlot | null);
  const popMax = Math.max(...next.map((s) => s.pop));
  const rainTotal = r1(next.reduce((a, s) => a + s.rain3h, 0));
  const rainSlot = Math.max(...next.map((s) => s.rain3h));
  const gusts = next.map((s) => s.gustKmh ?? s.windKmh).filter((v): v is number => v !== undefined);
  const gustMax = gusts.length ? Math.max(...gusts) : undefined;
  const feelsMax = next.map((s) => s.feelsC).filter((v): v is number => v !== undefined);
  const feelsHot = feelsMax.length ? Math.max(...feelsMax) : undefined;
  const worstCond = next.reduce((a, s) => (rank(conditionSeverity(s.conditionId)) > rank(conditionSeverity(a?.conditionId)) ? s : a), null as ForecastSlot | null);
  const tz = f.tzOffsetS;
  const data: Record<string, number | string> = {};
  if (cold) put(data, 'temp_min_c', cold.tempC);
  if (hot) put(data, 'temp_max_c', hot.tempC);
  data.pop_max_pct = r0(popMax * 100); data.rain_mm_24h = rainTotal; data.rain_mm_3h_max = r1(rainSlot);
  put(data, 'wind_gust_kmh', gustMax);
  const base = { at, tags: ['owm', 'forecast'] };
  const out: OwmDraft[] = [];
  const tempLine = () => cold && hot ? `Next 24 hours: low ${r0(cold.tempC as number)} C at ${clockAt(cold.at, tz)}, high ${r0(hot.tempC as number)} C at ${clockAt(hot.at, tz)}.` : 'Temperatures not available.';
  const rainLine = () => `Rain chance up to ${r0(popMax * 100)}%, about ${rainTotal} mm in total, at most ${r1(rainSlot)} mm in any 3 hours.`;
  const windLine = () => `Strongest gust ${gustMax ?? 'n/a'} km/h.`;
  const all = part === 'all';

  if (wants(part, 'temperature')) {
    const sev = maxSeverity(heatSeverity(feelsHot), coldSeverity(cold?.tempC), conditionSeverity(worstCond?.conditionId));
    out.push({
      ...base, slot: all ? 'forecast' : 'temperature', kind: 'weather', severity: sev, data,
      title: `${where(place)}next 24 hours ${cold ? r0(cold.tempC as number) : '?'} to ${hot ? r0(hot.tempC as number) : '?'} C`,
      body: all ? `${tempLine()} ${rainLine()} ${windLine()}` : tempLine(),
      detail: capDetail([tempLine(), feelsHot !== undefined ? `Hottest it will feel: ${r0(feelsHot)} C.` : '', rainLine(), windLine(),
        worstCond && conditionSeverity(worstCond.conditionId) !== 'info' ? `Thunderstorm risk around ${clockAt(worstCond.at, tz)} (${worstCond.condition ?? 'storm'}).` : '']),
    });
    if (all) {
      // a heavy-rain or high-gust forecast also gets its own item so routes can target it
      const rs = maxSeverity(rainSeverity(rainSlot), popSeverity(popMax, rainSlot));
      if (rank(rs) > 0) out.push({ ...base, slot: 'rain', kind: 'flood', severity: rs, data, title: `${where(place)}heavy rain expected, up to ${r1(rainSlot)} mm in 3 hours`, body: rainLine(), detail: capDetail([rainLine()]) });
      if (rank(gustSeverity(gustMax)) > 0) out.push({ ...base, slot: 'wind', kind: 'wind', severity: gustSeverity(gustMax), data, title: `${where(place)}gusts up to ${gustMax} km/h expected`, body: windLine(), detail: capDetail([windLine()]) });
      return out;
    }
  }
  if (wants(part, 'rain')) {
    out.push({ ...base, slot: 'rain', kind: 'flood', severity: maxSeverity(rainSeverity(rainSlot), popSeverity(popMax, rainSlot)), data,
      title: `${where(place)}rain next 24 hours: ${rainTotal} mm, chance up to ${r0(popMax * 100)}%`, body: rainLine(), detail: capDetail([rainLine()]) });
  }
  if (wants(part, 'wind')) {
    out.push({ ...base, slot: 'wind', kind: 'wind', severity: gustSeverity(gustMax), data,
      title: `${where(place)}gusts up to ${gustMax ?? '?'} km/h in the next 24 hours`, body: windLine(), detail: capDetail([windLine()]) });
  }
  return out;
}

export function airDrafts(now: AirReading[], later: AirReading[], part: OwmPart, place?: string): OwmDraft[] {
  if (!wants(part, 'air')) return [];
  const a = now[0];
  if (!a) return [];
  const tz = 0;
  const next24 = later.filter((r) => r.at >= a.at && r.at <= a.at + 24 * 3600 * 1000);
  const worst = next24.reduce((m, r) => ((r.aqi ?? 0) > (m?.aqi ?? 0) ? r : m), null as AirReading | null);
  const f = (v: number | undefined) => (v === undefined ? 'n/a' : String(r1(v)));
  const data: Record<string, number | string> = {};
  put(data, 'aqi', a.aqi); put(data, 'pm25', a.pm25); put(data, 'pm10', a.pm10); put(data, 'no2', a.no2);
  put(data, 'o3', a.o3); put(data, 'so2', a.so2); put(data, 'co', a.co); put(data, 'nh3', a.nh3);
  const sev = airSeverity(a.aqi, a.pm25);
  const line = `Air quality ${aqiWord(a.aqi)} (index ${a.aqi ?? 'n/a'} of 5). PM2.5 ${f(a.pm25)} ug/m3, PM10 ${f(a.pm10)} ug/m3.`;
  return [{
    at: a.at, slot: 'air', kind: 'advisory', severity: sev, tags: ['owm', 'air'], data,
    title: `${where(place)}air quality ${aqiWord(a.aqi)}, PM2.5 ${f(a.pm25)}`,
    body: line,
    detail: capDetail([line, `NO2 ${f(a.no2)}, O3 ${f(a.o3)}, SO2 ${f(a.so2)}, CO ${f(a.co)} ug/m3.`,
      worst && (worst.aqi ?? 0) > (a.aqi ?? 0) ? `Worst in the next 24 hours: ${aqiWord(worst.aqi)} around ${clockAt(worst.at, tz)} UTC.` : '',
      rank(sev) > 0 ? 'Keep children and older people indoors when the air is poor.' : '']),
  }];
}

/** Longest text kept from one alert description. */
export const ALERT_TEXT_MAX = 400;

export function oneCallDrafts(o: OneCall, part: OwmPart, place?: string): OwmDraft[] {
  const out: OwmDraft[] = [];
  const tz = o.tzOffsetS;
  if (wants(part, 'alerts')) {
    for (const a of o.alerts) {
      const text = a.description.replace(/\s+/g, ' ').trim();
      const clip = text.length > ALERT_TEXT_MAX ? text.slice(0, ALERT_TEXT_MAX - 3) + '...' : text;
      out.push({
        at: a.start || Date.now(), slot: `alert|${a.event}|${a.start}`, kind: 'alert', severity: 'severe', tags: ['owm', 'official', 'alert'],
        data: { alert_start: a.start, alert_end: a.end },
        title: `${where(place)}${a.event}${a.sender ? ` (${a.sender})` : ''}`,
        body: clip.split(' ').slice(0, 50).join(' ') || `${a.event} issued for this area.`,
        detail: capDetail([`${a.event}${a.sender ? `, issued by ${a.sender}` : ''}.`, `From ${dayClockAt(a.start, tz)} to ${dayClockAt(a.end, tz)}.`, clip ? `"${clip}"` : '']),
      });
    }
  }
  if (part !== 'alerts' && part !== 'air') {
    const h48 = o.hourly.slice(0, 48);
    if (h48.length || o.uvi !== undefined) {
      const gusts = h48.map((h) => h.gustKmh ?? h.windKmh).filter((v): v is number => v !== undefined);
      const gustMax = gusts.length ? Math.max(...gusts) : undefined;
      const feels = h48.map((h) => h.feelsC).filter((v): v is number => v !== undefined);
      const temps = h48.map((h) => h.tempC).filter((v): v is number => v !== undefined);
      const feelsMax = feels.length ? Math.max(...feels) : undefined;
      const tMin = temps.length ? Math.min(...temps) : undefined;
      const tMax = temps.length ? Math.max(...temps) : undefined;
      const popMax = h48.length ? Math.max(...h48.map((h) => h.pop)) : 0;
      const rainTotal = r1(h48.reduce((a, h) => a + h.rain1h, 0));
      const rainHour = h48.length ? Math.max(...h48.map((h) => h.rain1h)) : 0;
      const uviMax = Math.max(o.uvi ?? 0, ...h48.map((h) => h.uvi ?? 0));
      const data: Record<string, number | string> = {};
      put(data, 'uv_index', o.uvi); put(data, 'uv_index_max_48h', uviMax); put(data, 'wind_gust_kmh', gustMax);
      put(data, 'temp_min_c', tMin); put(data, 'temp_max_c', tMax); data.pop_max_pct = r0(popMax * 100);
      data.rain_mm_48h = rainTotal; data.alert_count = o.alerts.length;
      const tempSev = maxSeverity(heatSeverity(feelsMax), coldSeverity(tMin));
      const rainSev = maxSeverity(rainSeverity(rainHour * 3), popSeverity(popMax, rainHour * 3));
      const windSev = gustSeverity(gustMax);
      const sev = part === 'wind' ? windSev : part === 'rain' ? rainSev : part === 'temperature' ? maxSeverity(tempSev, uvSeverity(uviMax)) : maxSeverity(tempSev, rainSev, windSev, uvSeverity(uviMax));
      const kind: FeedKind = part === 'wind' ? 'wind' : part === 'rain' ? 'flood' : 'weather';
      const lines = [
        o.uvi !== undefined ? `UV index now ${r1(o.uvi)}, peak in 48 hours ${r1(uviMax)}.` : '',
        tMin !== undefined && tMax !== undefined ? `Next 48 hours: ${r0(tMin)} to ${r0(tMax)} C${feelsMax !== undefined ? `, feels up to ${r0(feelsMax)} C` : ''}.` : '',
        `Rain chance up to ${r0(popMax * 100)}%, about ${rainTotal} mm in total.`,
        gustMax !== undefined ? `Strongest gust ${gustMax} km/h.` : '',
        o.alerts.length ? `${o.alerts.length} official alert${o.alerts.length === 1 ? '' : 's'} active.` : 'No official alerts.',
      ];
      const slot = part === 'all' ? 'onecall' : part;
      out.push({ at: h48[0]?.at ?? Date.now(), slot, kind, severity: sev, tags: ['owm', 'onecall'], data,
        title: `${where(place)}48 hour outlook${o.uvi !== undefined ? `, UV ${r1(o.uvi)}` : ''}`,
        body: lines.filter(Boolean).slice(0, 4).join(' '), detail: capDetail(lines) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// offline samples (clearly marked, never above info)

const SAMPLE_CURRENT = { dt: 1_700_000_000, timezone: 19800, name: 'Sample', weather: [{ id: 800, description: 'clear sky' }],
  main: { temp: 31, feels_like: 34, pressure: 1008, humidity: 45 }, visibility: 8000, wind: { speed: 3.3, deg: 270, gust: 6.1 }, clouds: { all: 5 },
  sys: { sunrise: 1_699_999_000, sunset: 1_700_040_000 } };
const SAMPLE_FORECAST = { cod: '200', city: { name: 'Sample', timezone: 19800 },
  list: Array.from({ length: 8 }, (_, i) => ({ dt: 1_700_000_000 + i * 10800, main: { temp: 24 + (i % 4) * 3, feels_like: 26 + (i % 4) * 3 },
    weather: [{ id: 801, description: 'few clouds' }], wind: { speed: 3, gust: 5 }, pop: 0.1, ...(i === 2 ? { rain: { '3h': 1.2 } } : {}) })) };
const SAMPLE_AIR = { list: [{ dt: 1_700_000_000, main: { aqi: 2 }, components: { co: 230, no: 0.1, no2: 12, o3: 60, so2: 4, pm2_5: 18, pm10: 40, nh3: 1 } }] };
const SAMPLE_ONECALL = { timezone_offset: 19800, current: { uvi: 6 },
  hourly: Array.from({ length: 48 }, (_, i) => ({ dt: 1_700_000_000 + i * 3600, temp: 26, feels_like: 28, pop: 0.1, wind_speed: 3, wind_gust: 5, uvi: i % 24 === 6 ? 7 : 1 })),
  alerts: [] };

export type OwmKind = 'owm-current' | 'owm-forecast' | 'owm-air' | 'owm-onecall';

/** Sample items for offline runs: same shape as real ones, titled "Sample:", tagged 'sample', severity info. */
export function sampleDrafts(kind: OwmKind, part: OwmPart, place: string | undefined, now: number): OwmDraft[] {
  let drafts: OwmDraft[];
  if (kind === 'owm-current') drafts = currentDrafts(parseCurrent(SAMPLE_CURRENT), part, place);
  else if (kind === 'owm-forecast') drafts = forecastDrafts(parseForecast(SAMPLE_FORECAST), part, place);
  else if (kind === 'owm-air') drafts = airDrafts(parseAir(SAMPLE_AIR), [], part, place);
  else drafts = oneCallDrafts(parseOneCall(SAMPLE_ONECALL), part, place);
  return drafts.map((d) => ({ ...d, at: now, severity: 'info' as Severity, title: `Sample: ${d.title}`, tags: [...d.tags, 'sample'], slot: `sample|${d.slot}` }));
}
