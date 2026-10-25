import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compassFrom,
  conditionIcon,
  conditionLabel,
  forecastNotes,
  parseForecast,
  summaryLine,
  sunArc,
  todayLine,
  weekLine,
  type DayPoint,
  type Forecast,
  type HourPoint,
  type WeatherNote,
} from '../weatherLogic';

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 26, 6, 0); // base instant (ms)

const hour = (i: number, over: Partial<HourPoint> = {}): HourPoint => ({
  t: T0 + i * H,
  tempC: 20,
  code: 0,
  isDay: true,
  rainMm: 0,
  windKmh: 5,
  ...over,
});

const day = (date: string, over: Partial<DayPoint> = {}): DayPoint => ({
  date,
  minC: 15,
  maxC: 25,
  code: 0,
  rainMm: 0,
  windMaxKmh: 10,
  uvMax: 5,
  sunrise: Date.parse(`${date}T06:00:00Z`),
  sunset: Date.parse(`${date}T18:00:00Z`),
  ...over,
});

const forecastWith = (days: DayPoint[], hours: HourPoint[] = []): Forecast => ({
  place: 'Test',
  lat: 0,
  lon: 0,
  fetchedAt: T0,
  now: { tempC: 20, feelsC: 18, humidity: 50, windKmh: 9, windDir: 'SW', uv: 3, code: 0, isDay: true },
  hours,
  days,
});

const note = (over: Partial<WeatherNote>): WeatherNote => ({
  id: 'x',
  day: '2026-10-29',
  at: null,
  severity: 'watch',
  title: 't',
  body: 'b',
  icon: 'rain',
  ...over,
});

test('conditionLabel maps WMO codes and day/night for clear sky', () => {
  assert.equal(conditionLabel(0, true), 'Clear and calm');
  assert.equal(conditionLabel(0, false), 'Clear night');
  assert.equal(conditionLabel(1, true), 'Partly cloudy');
  assert.equal(conditionLabel(2, true), 'Partly cloudy');
  assert.equal(conditionLabel(3, true), 'Overcast');
  assert.equal(conditionLabel(48, true), 'Fog');
  assert.equal(conditionLabel(53, true), 'Drizzle');
  assert.equal(conditionLabel(67, true), 'Freezing rain');
  assert.equal(conditionLabel(75, true), 'Snow');
  assert.equal(conditionLabel(82, true), 'Rain showers');
  assert.equal(conditionLabel(86, true), 'Snow showers');
  assert.equal(conditionLabel(96, true), 'Thunderstorm with hail');
  assert.equal(conditionLabel(99, false), 'Thunderstorm with hail');
  assert.equal(conditionLabel(95, true), 'Thunderstorm');
  assert.equal(conditionLabel(9999, true), 'Unsettled');
});

test('conditionIcon picks sun or moon by day, and each family', () => {
  assert.equal(conditionIcon(0, true), 'sun');
  assert.equal(conditionIcon(0, false), 'moon');
  assert.equal(conditionIcon(2, false), 'partly');
  assert.equal(conditionIcon(3, true), 'cloud');
  assert.equal(conditionIcon(45, true), 'fog');
  assert.equal(conditionIcon(61, true), 'rain');
  assert.equal(conditionIcon(82, true), 'rain');
  assert.equal(conditionIcon(73, true), 'snow');
  assert.equal(conditionIcon(86, true), 'snow');
  assert.equal(conditionIcon(95, true), 'storm');
  assert.equal(conditionIcon(99, true), 'storm');
});

test('compassFrom maps degrees to 8 points with wrap-around and boundaries', () => {
  assert.equal(compassFrom(0), 'N');
  assert.equal(compassFrom(22), 'N');
  assert.equal(compassFrom(23), 'NE');
  assert.equal(compassFrom(225), 'SW');
  assert.equal(compassFrom(359), 'N');
  assert.equal(compassFrom(360), 'N');
  assert.equal(compassFrom(-90), 'W');
  assert.equal(compassFrom(NaN), '-');
});

test('sunArc clamps progress and reports daylight and minutes to sunset', () => {
  const rise = 1000;
  const set = 1000 + 12 * 60_000 * 60; // 12 hours later in ms
  const mid = sunArc(rise + (set - rise) / 2, rise, set);
  assert.equal(mid.progress, 0.5);
  assert.equal(mid.isDaylight, true);
  assert.equal(mid.minutesToSunset, 360);

  const before = sunArc(rise - 5, rise, set);
  assert.equal(before.progress, 0);
  assert.equal(before.isDaylight, false);
  assert.equal(before.minutesToSunset, null);

  const after = sunArc(set + 5, rise, set);
  assert.equal(after.progress, 1);
  assert.equal(after.isDaylight, false);
  assert.equal(after.minutesToSunset, null);

  const atRise = sunArc(rise, rise, set);
  assert.equal(atRise.isDaylight, true);
  assert.equal(atRise.progress, 0);

  const atSet = sunArc(set, rise, set);
  assert.equal(atSet.isDaylight, false);
  assert.equal(atSet.progress, 1);

  const bad = sunArc(NaN, rise, set);
  assert.deepEqual(bad, { progress: 0, isDaylight: false, minutesToSunset: null });
  const inverted = sunArc(rise, set, rise);
  assert.equal(inverted.progress, 0);
  assert.equal(inverted.isDaylight, false);
});

test('summaryLine rounds numbers and names the wind direction', () => {
  const f = forecastWith([day('2026-10-26')]);
  f.now.feelsC = 17.4;
  f.now.windKmh = 8.6;
  assert.equal(summaryLine(f), 'Feels like 17 deg, wind 9 km/h from the SW');
  f.now.windDir = '-';
  assert.equal(summaryLine(f), 'Feels like 17 deg, wind 9 km/h');
});

test('todayLine reports clear all day when nothing changes', () => {
  const hours = Array.from({ length: 24 }, (_, i) => hour(i));
  assert.equal(todayLine(hours), 'clear all day');
  assert.equal(todayLine([]), 'no hourly forecast yet');
});

test('todayLine reports when rain starts', () => {
  const hours = Array.from({ length: 24 }, (_, i) => hour(i, i >= 5 ? { code: 61, rainMm: 1 } : {}));
  assert.equal(todayLine(hours), `rain from ${new Date(T0 + 5 * H).getHours()}`);
});

test('todayLine reports a drop of exactly 4 C but not 3.9 C', () => {
  const drop4 = Array.from({ length: 24 }, (_, i) => hour(i, i >= 3 ? { tempC: 16 } : {}));
  assert.equal(todayLine(drop4), `cooler after ${new Date(T0 + 3 * H).getHours()}`);
  const drop39 = Array.from({ length: 24 }, (_, i) => hour(i, i >= 3 ? { tempC: 16.1 } : {}));
  assert.equal(todayLine(drop39), 'clear all day');
});

test('todayLine reports rain that stops, and rain all day when it never stops', () => {
  const stops = Array.from({ length: 24 }, (_, i) => hour(i, i < 4 ? { code: 63, rainMm: 2 } : {}));
  assert.equal(todayLine(stops), `rain until ${new Date(T0 + 4 * H).getHours()}`);
  const all = Array.from({ length: 24 }, (_, i) => hour(i, { code: 63, rainMm: 2 }));
  assert.equal(todayLine(all), 'rain all day');
});

test('weekLine covers none, one named day, and several days', () => {
  assert.equal(weekLine([]), 'nothing needs you this week');
  assert.equal(weekLine([note({ day: '2026-10-29', severity: 'info' })]), 'nothing needs you this week');
  // 2026-10-29 is a Thursday.
  assert.equal(weekLine([note({ day: '2026-10-29' })]), 'only Thursday needs you');
  assert.equal(weekLine([note({ day: '2026-10-29' }), note({ id: 'y', day: '2026-10-29', severity: 'warning' })]), 'only Thursday needs you');
  assert.equal(weekLine([note({ day: '2026-10-29' }), note({ id: 'y', day: '2026-10-30' })]), '2 days need you');
  assert.equal(
    weekLine([note({ day: '2026-10-29' }), note({ id: 'y', day: '2026-10-30' }), note({ id: 'z', day: '2026-11-01' })]),
    '3 days need you',
  );
});

test('forecastNotes is empty for a calm week', () => {
  assert.deepEqual(forecastNotes(forecastWith([day('2026-10-26')])), []);
});

test('rain thresholds: 15 watch, 35 warning, 65 severe, and just below each', () => {
  const sev = (mm: number) => forecastNotes(forecastWith([day('2026-10-26', { rainMm: mm })])).find((n) => n.icon === 'rain')?.severity;
  assert.equal(sev(14.9), undefined);
  assert.equal(sev(15), 'watch');
  assert.equal(sev(34.9), 'watch');
  assert.equal(sev(35), 'warning');
  assert.equal(sev(64.9), 'warning');
  assert.equal(sev(65), 'severe');
});

test('storm codes: 95 is a watch, 96 and 99 are warnings with hail', () => {
  const sev = (code: number) => forecastNotes(forecastWith([day('2026-10-26', { code })])).find((n) => n.icon === 'storm');
  assert.equal(sev(94)?.severity, undefined);
  assert.equal(sev(95)?.severity, 'watch');
  assert.equal(sev(95)?.title, 'Thunderstorms');
  assert.equal(sev(96)?.severity, 'warning');
  assert.equal(sev(96)?.title, 'Thunderstorm with hail');
  assert.equal(sev(99)?.severity, 'warning');
});

test('storm note uses the first storm hour of the day when one exists', () => {
  const d = day('2026-10-26', { code: 95 });
  const hours = [hour(0), hour(1, { code: 95 }), hour(2, { code: 96 })];
  const storm = forecastNotes(forecastWith([d], hours)).find((n) => n.icon === 'storm');
  assert.ok(storm);
  assert.equal(storm.at, hours[1].t);
  assert.equal(storm.severity, 'watch');
  assert.match(storm.body, /from \d{2}:00/);
});

test('wind thresholds: 40 watch, 60 warning, and just below', () => {
  const sev = (w: number) => forecastNotes(forecastWith([day('2026-10-26', { windMaxKmh: w })])).find((n) => n.icon === 'wind')?.severity;
  assert.equal(sev(39.9), undefined);
  assert.equal(sev(40), 'watch');
  assert.equal(sev(59.9), 'watch');
  assert.equal(sev(60), 'warning');
});

test('heat thresholds: 38 watch, 41 warning, 45 severe', () => {
  const sev = (c: number) => forecastNotes(forecastWith([day('2026-10-26', { maxC: c })])).find((n) => n.icon === 'heat')?.severity;
  assert.equal(sev(37.9), undefined);
  assert.equal(sev(38), 'watch');
  assert.equal(sev(40.9), 'watch');
  assert.equal(sev(41), 'warning');
  assert.equal(sev(44.9), 'warning');
  assert.equal(sev(45), 'severe');
});

test('cold thresholds: 4 watch, 0 warning, and just above', () => {
  const sev = (c: number) => forecastNotes(forecastWith([day('2026-10-26', { minC: c })])).find((n) => n.icon === 'cold')?.severity;
  assert.equal(sev(4.1), undefined);
  assert.equal(sev(4), 'watch');
  assert.equal(sev(0.1), 'watch');
  assert.equal(sev(0), 'warning');
});

test('UV thresholds: 11 watch, just below none', () => {
  const sev = (u: number) => forecastNotes(forecastWith([day('2026-10-26', { uvMax: u })])).find((n) => n.icon === 'uv')?.severity;
  assert.equal(sev(10.9), undefined);
  assert.equal(sev(11), 'watch');
});

test('forecastNotes sorts by severity first, then time', () => {
  const f = forecastWith([
    day('2026-10-27', { rainMm: 20 }), // watch
    day('2026-10-26', { rainMm: 40 }), // warning
    day('2026-10-28', { rainMm: 70 }), // severe
    day('2026-10-25', { rainMm: 16 }), // watch, earlier
  ]);
  const order = forecastNotes(f).map((n) => `${n.severity}:${n.day}`);
  assert.deepEqual(order, ['severe:2026-10-28', 'warning:2026-10-26', 'watch:2026-10-25', 'watch:2026-10-27']);
});

test('forecastNotes numbers in bodies are rounded and readable', () => {
  const [n] = forecastNotes(forecastWith([day('2026-10-26', { rainMm: 40.456 })]));
  assert.equal(n.body, 'About 40.5 mm of rain is forecast for the day.');
});

test('parseForecast converts local times with the utc offset and keeps the current hour', () => {
  const fetchedAt = Date.UTC(2026, 9, 26, 5, 10); // inside the 05:30 UTC hour
  const raw = {
    utc_offset_seconds: 19800, // +05:30
    current: {
      temperature_2m: 22,
      apparent_temperature: 21,
      relative_humidity_2m: 60,
      is_day: 1,
      weather_code: 2,
      wind_speed_10m: 9,
      wind_direction_10m: 225,
      uv_index: 4,
    },
    hourly: {
      time: ['2026-10-26T11:00', '2026-10-26T12:00', '2026-10-26T13:00'],
      temperature_2m: [22, 23, 24],
      weather_code: [0, 61, 3],
      is_day: [1, 1, 1],
      precipitation: [0, 1, 0],
      wind_speed_10m: [5, 6, 7],
    },
    daily: {
      time: ['2026-10-26', '2026-10-27'],
      weather_code: [2, 61],
      temperature_2m_max: [25, 26],
      temperature_2m_min: [15, 16],
      precipitation_sum: [0, 4],
      wind_speed_10m_max: [10, 20],
      uv_index_max: [5, 6],
      sunrise: ['2026-10-26T06:00', '2026-10-27T06:01'],
      sunset: ['2026-10-26T17:30', '2026-10-27T17:30'],
    },
  };
  const f = parseForecast(raw, { lat: 1, lon: 2, place: 'X', fetchedAt });
  assert.ok(f);
  assert.equal(f.now.windDir, 'SW');
  assert.equal(f.now.isDay, true);
  assert.equal(f.hours.length, 3);
  // 11:00 local at +05:30 is 05:30 UTC.
  assert.equal(f.hours[0].t, Date.UTC(2026, 9, 26, 5, 30));
  assert.equal(f.days.length, 2);
  assert.equal(f.days[0].date, '2026-10-26');
  assert.equal(f.days[0].sunrise, Date.UTC(2026, 9, 26, 0, 30));
});

test('parseForecast drops hours that have already ended and rejects unusable data', () => {
  const fetchedAt = Date.UTC(2026, 9, 26, 6, 30);
  const base = {
    utc_offset_seconds: 0,
    current: { temperature_2m: 22 },
    hourly: { time: ['2026-10-26T04:00', '2026-10-26T06:00', '2026-10-26T07:00'], temperature_2m: [1, 2, 3] },
    daily: { time: ['2026-10-26'], temperature_2m_min: [10], temperature_2m_max: [20] },
  };
  const f = parseForecast(base, { lat: 0, lon: 0, place: 'X', fetchedAt });
  assert.ok(f);
  assert.deepEqual(
    f.hours.map((h) => h.t),
    [Date.UTC(2026, 9, 26, 6, 0), Date.UTC(2026, 9, 26, 7, 0)],
  );

  assert.equal(parseForecast(null, { lat: 0, lon: 0, place: 'X', fetchedAt }), null);
  assert.equal(parseForecast({ ...base, current: { temperature_2m: 'hot' } }, { lat: 0, lon: 0, place: 'X', fetchedAt }), null);
  assert.equal(parseForecast({ ...base, daily: { time: [] } }, { lat: 0, lon: 0, place: 'X', fetchedAt }), null);
});
