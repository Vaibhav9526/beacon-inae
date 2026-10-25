import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GOOGLE_CONDITION_CODES,
  googleCurrentUrl,
  googleDaysUrl,
  googleHoursUrl,
  parseGoogleForecast,
  wmoCodeFor,
} from '../googleWeather';
import { conditionLabel } from '../weatherLogic';

// Verbatim from the "Get current conditions" sample in the Weather API docs (metric request).
const CURRENT_SAMPLE = {
  currentTime: '2025-01-28T22:04:12.025273178Z',
  timeZone: { id: 'America/Los_Angeles' },
  isDaytime: true,
  weatherCondition: {
    iconBaseUri: 'https://maps.gstatic.com/weather/v1/sunny',
    description: { text: 'Sunny', languageCode: 'en' },
    type: 'CLEAR',
  },
  temperature: { degrees: 13.7, unit: 'CELSIUS' },
  wind: {
    direction: { degrees: 335, cardinal: 'NORTH_NORTHWEST' },
    speed: { value: 8, unit: 'KILOMETERS_PER_HOUR' },
    gust: { value: 18, unit: 'KILOMETERS_PER_HOUR' },
  },
};

// Hourly and daily bodies are built from the documented field names (the docs give field lists, not verbatim samples).
const NOW = Date.UTC(2025, 0, 28, 22, 0);
const HOUR = 3_600_000;

const hourItem = (startMs: number, over: Record<string, unknown> = {}) => ({
  interval: { startTime: new Date(startMs).toISOString().replace('.000Z', '.000000000Z'), endTime: new Date(startMs + HOUR).toISOString() },
  displayDateTime: { year: 2025, month: 1, day: 28, hours: 22, utcOffset: '-28800s' },
  isDaytime: false,
  weatherCondition: { iconBaseUri: 'x', description: { text: 'Light rain', languageCode: 'en' }, type: 'LIGHT_RAIN' },
  temperature: { degrees: 12.5, unit: 'CELSIUS' },
  precipitation: { probability: { percent: 60, type: 'RAIN' }, qpf: { quantity: 0.4, unit: 'MILLIMETERS' } },
  wind: { direction: { degrees: 90, cardinal: 'EAST' }, speed: { value: 15, unit: 'KILOMETERS_PER_HOUR' }, gust: { value: 25, unit: 'KILOMETERS_PER_HOUR' } },
  ...over,
});

const HOURS = {
  forecastHours: [
    hourItem(Date.UTC(2025, 0, 28, 20, 0)), // ends before now: dropped
    hourItem(NOW), // current hour: kept
    hourItem(NOW + HOUR, { precipitation: undefined, temperature: { degrees: 0, unit: 'CELSIUS' } }), // no qpf = 0 mm, zero temp
  ],
  timeZone: { id: 'America/Los_Angeles' },
};

const dayItem = (y: number, m: number, d: number, over: Record<string, unknown> = {}) => ({
  interval: { startTime: `${y}-${m}-${d}T08:00:00Z`, endTime: `${y}-${m}-${d + 1}T08:00:00Z` },
  displayDate: { year: y, month: m, day: d },
  daytimeForecast: {
    weatherCondition: { iconBaseUri: 'x', description: { text: 'Showers', languageCode: 'en' }, type: 'SCATTERED_SHOWERS' },
    relativeHumidity: 70,
    uvIndex: 9,
    precipitation: { probability: { percent: 80, type: 'RAIN' }, qpf: { quantity: 6, unit: 'MILLIMETERS' } },
    wind: { direction: { degrees: 200, cardinal: 'SOUTH_SOUTHWEST' }, speed: { value: 30, unit: 'KILOMETERS_PER_HOUR' }, gust: { value: 50, unit: 'KILOMETERS_PER_HOUR' } },
  },
  nighttimeForecast: {
    weatherCondition: { iconBaseUri: 'x', description: { text: 'Rain', languageCode: 'en' }, type: 'RAIN' },
    precipitation: { probability: { percent: 90, type: 'RAIN' }, qpf: { quantity: 0.5, unit: 'INCHES' } },
    wind: { direction: { degrees: 200, cardinal: 'SOUTH_SOUTHWEST' }, speed: { value: 44, unit: 'KILOMETERS_PER_HOUR' } },
  },
  maxTemperature: { degrees: 21, unit: 'CELSIUS' },
  minTemperature: { degrees: 9, unit: 'CELSIUS' },
  sunEvents: { sunriseTime: '2025-01-29T01:23:45.123456789Z', sunsetTime: '2025-01-29T22:10:00Z' },
  ...over,
});

const DAYS = {
  forecastDays: [dayItem(2025, 1, 28), dayItem(2025, 1, 29, { sunEvents: undefined, maxTemperature: { degrees: 70, unit: 'FAHRENHEIT' } })],
  timeZone: { id: 'America/Los_Angeles' },
};

const META = { lat: 37.422, lon: -122.084, place: 'Your location', fetchedAt: NOW };

test('request builders put the key and location in the URL and name the documented paths', () => {
  const c = googleCurrentUrl('abc/def', 37.422, -122.084);
  assert.match(c, /^https:\/\/weather\.googleapis\.com\/v1\/currentConditions:lookup\?/);
  assert.match(c, /key=abc%2Fdef/);
  assert.match(c, /location\.latitude=37\.422/);
  assert.match(c, /location\.longitude=-122\.084/);
  assert.match(c, /unitsSystem=METRIC/);

  const h = googleHoursUrl('k', 1, 2);
  assert.match(h, /\/v1\/forecast\/hours:lookup\?/);
  assert.match(h, /hours=24/);

  const d = googleDaysUrl('k', 1, 2, 7);
  assert.match(d, /\/v1\/forecast\/days:lookup\?/);
  assert.match(d, /days=7/);
  assert.match(d, /pageSize=7/);
  assert.match(d, /unitsSystem=METRIC/);
});

test('every documented WeatherCondition.type maps to a real app code', () => {
  const documented = [
    'CLEAR', 'MOSTLY_CLEAR', 'PARTLY_CLOUDY', 'MOSTLY_CLOUDY', 'CLOUDY', 'WINDY', 'WIND_AND_RAIN', 'LIGHT_RAIN_SHOWERS',
    'CHANCE_OF_SHOWERS', 'SCATTERED_SHOWERS', 'RAIN_SHOWERS', 'HEAVY_RAIN_SHOWERS', 'LIGHT_TO_MODERATE_RAIN',
    'MODERATE_TO_HEAVY_RAIN', 'RAIN', 'LIGHT_RAIN', 'HEAVY_RAIN', 'RAIN_PERIODICALLY_HEAVY', 'LIGHT_SNOW_SHOWERS',
    'CHANCE_OF_SNOW_SHOWERS', 'SCATTERED_SNOW_SHOWERS', 'SNOW_SHOWERS', 'HEAVY_SNOW_SHOWERS', 'LIGHT_TO_MODERATE_SNOW',
    'MODERATE_TO_HEAVY_SNOW', 'SNOW', 'LIGHT_SNOW', 'HEAVY_SNOW', 'SNOWSTORM', 'SNOW_PERIODICALLY_HEAVY', 'HEAVY_SNOW_STORM',
    'BLOWING_SNOW', 'RAIN_AND_SNOW', 'HAIL', 'HAIL_SHOWERS', 'THUNDERSTORM', 'THUNDERSHOWER', 'LIGHT_THUNDERSTORM_RAIN',
    'SCATTERED_THUNDERSTORMS', 'HEAVY_THUNDERSTORM',
  ];
  assert.equal(documented.length, 41 - 1, 'docs enum has 41 values including TYPE_UNSPECIFIED');
  for (const t of documented) {
    const code = wmoCodeFor(t);
    assert.notEqual(code, -1, t);
    assert.notEqual(conditionLabel(code, true), 'Unsettled', t);
  }
  assert.equal(wmoCodeFor('TYPE_UNSPECIFIED'), -1);
  assert.equal(wmoCodeFor('NOT_A_TYPE'), -1);
  assert.equal(wmoCodeFor('constructor'), -1, 'prototype keys must not map');
  assert.equal(wmoCodeFor(undefined), -1);
  assert.equal(GOOGLE_CONDITION_CODES.CLEAR, 0);
});

test('maps the documented current-conditions sample into the Forecast now block', () => {
  const f = parseGoogleForecast(CURRENT_SAMPLE, HOURS, DAYS, META);
  assert.ok(f);
  assert.equal(f.source, 'google');
  assert.equal(f.now.tempC, 13.7);
  assert.equal(f.now.feelsC, 13.7, 'feels-like falls back to air temperature when absent');
  assert.equal(f.now.windKmh, 8);
  assert.equal(f.now.windDir, 'NW', '335 degrees is north-west');
  assert.equal(f.now.code, 0);
  assert.equal(f.now.isDay, true);
  assert.equal(f.now.humidity, 0, 'absent humidity reads as zero, as the Open-Meteo parser does');
  assert.equal(f.place, 'Your location');
  assert.equal(f.fetchedAt, NOW);
});

test('Fahrenheit and inch inputs are converted to the app units', () => {
  const cur = { ...CURRENT_SAMPLE, temperature: { degrees: 50, unit: 'FAHRENHEIT' }, feelsLikeTemperature: { degrees: 41, unit: 'FAHRENHEIT' } };
  const f = parseGoogleForecast(cur, HOURS, DAYS, META);
  assert.ok(f);
  assert.ok(Math.abs(f.now.tempC - 10) < 1e-9);
  assert.ok(Math.abs(f.now.feelsC - 5) < 1e-9);

  const dayInches = parseGoogleForecast(CURRENT_SAMPLE, HOURS, { forecastDays: [dayItem(2025, 1, 28)] }, META);
  assert.ok(dayInches);
  // day 6 mm + night 0.5 in (12.7 mm)
  assert.ok(Math.abs(dayInches.days[0].rainMm - 18.7) < 1e-9);
});

test('an unrecognised unit makes the whole parse fail so the caller falls back', () => {
  const cur = { ...CURRENT_SAMPLE, wind: { speed: { value: 5, unit: 'MILES_PER_HOUR' } } };
  assert.equal(parseGoogleForecast(cur, HOURS, DAYS, META), null);

  const badTemp = { ...CURRENT_SAMPLE, temperature: { degrees: 3, unit: 'KELVIN' } };
  assert.equal(parseGoogleForecast(badTemp, HOURS, DAYS, META), null);

  const badRain = { forecastDays: [dayItem(2025, 1, 28, { daytimeForecast: { precipitation: { qpf: { quantity: 2, unit: 'CUPS' } } } })] };
  assert.equal(parseGoogleForecast(CURRENT_SAMPLE, HOURS, badRain, META), null);
});

test('hourly points keep the current hour onward, default missing rain to zero, and map condition and wind', () => {
  const f = parseGoogleForecast(CURRENT_SAMPLE, HOURS, DAYS, META);
  assert.ok(f);
  assert.equal(f.hours.length, 2, 'the 20:00 hour has already ended and is dropped');
  assert.equal(f.hours[0].t, NOW);
  assert.equal(f.hours[0].code, 61, 'LIGHT_RAIN');
  assert.equal(f.hours[0].rainMm, 0.4);
  assert.equal(f.hours[0].windKmh, 15);
  assert.equal(f.hours[0].isDay, false);
  assert.equal(f.hours[1].rainMm, 0);
  assert.equal(f.hours[1].tempC, 0, 'zero temperature with no unit reads as 0 C');
});

test('daily points combine day and night, take the day condition and the larger wind, and parse sun times', () => {
  const f = parseGoogleForecast(CURRENT_SAMPLE, HOURS, DAYS, META);
  assert.ok(f);
  assert.equal(f.days.length, 2);
  const d0 = f.days[0];
  assert.equal(d0.date, '2025-01-28');
  assert.equal(d0.maxC, 21);
  assert.equal(d0.minC, 9);
  assert.equal(d0.code, 80, 'SCATTERED_SHOWERS from the daytime forecast');
  assert.ok(Math.abs(d0.rainMm - 18.7) < 1e-9);
  assert.equal(d0.windMaxKmh, 44, 'the larger of the day (30) and night (44) wind speeds');
  assert.equal(d0.uvMax, 9);
  assert.equal(d0.sunrise, Date.UTC(2025, 0, 29, 1, 23, 45, 123));
  assert.equal(d0.sunset, Date.UTC(2025, 0, 29, 22, 10, 0));

  const d1 = f.days[1];
  assert.equal(d1.date, '2025-01-29', 'single-digit day pads to two digits');
  assert.equal(d1.maxC, (70 - 32) * 5 / 9, 'Fahrenheit max converted');
  assert.ok(Number.isNaN(d1.sunrise), 'missing sunEvents leaves sunrise unset');
});

test('missing or empty data returns null', () => {
  assert.equal(parseGoogleForecast(null, HOURS, DAYS, META), null);
  assert.equal(parseGoogleForecast({ ...CURRENT_SAMPLE, temperature: undefined }, HOURS, DAYS, META), null);
  assert.equal(parseGoogleForecast(CURRENT_SAMPLE, HOURS, { forecastDays: [] }, META), null, 'no daily data is unusable');
  assert.equal(parseGoogleForecast(CURRENT_SAMPLE, HOURS, { forecastDays: [{ displayDate: { year: 2025, month: 1 } }] }, META), null);
});

test('empty hourly list is allowed and yields no hourly points', () => {
  const f = parseGoogleForecast(CURRENT_SAMPLE, { forecastHours: [] }, DAYS, META);
  assert.ok(f);
  assert.deepEqual(f.hours, []);
});
