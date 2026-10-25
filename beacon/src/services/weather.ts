import { pollMs } from './lifeboat';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { nearestCity } from '../kb/hazards';
import { getFix } from './location';
import { fetchGoogleForecast } from './googleWeather';
import { getGoogleKey } from './googleKey';
import { parseForecast, type Forecast } from './weatherLogic';

const CACHE_KEY = 'beacon.weather.v1';
const FRESH_MS = 20 * 60_000;
const TIMEOUT_MS = 8000;
const NEAR_KM = 60;
const FALLBACK = { lat: 28.61, lon: 77.21, place: 'Delhi' };

const URL_FIELDS =
  'current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m,wind_direction_10m,uv_index' +
  '&hourly=temperature_2m,weather_code,is_day,precipitation,wind_speed_10m' +
  '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,uv_index_max,sunrise,sunset' +
  '&timezone=auto&forecast_days=7';

export interface LoadResult {
  forecast: Forecast | null;
  stale: boolean;
  error?: string;
}

function buildUrl(lat: number, lon: number): string {
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&${URL_FIELDS}`;
}

function kmBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function readCache(): Promise<Forecast | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const f = JSON.parse(raw) as Forecast;
    return f && typeof f.fetchedAt === 'number' && Array.isArray(f.days) && Array.isArray(f.hours) && f.now ? f : null;
  } catch {
    return null;
  }
}

function writeCache(f: Forecast): void {
  try {
    AsyncStorage.setItem(CACHE_KEY, JSON.stringify(f)).catch(() => {});
  } catch {
    /* storage unavailable: the forecast still shows for this session */
  }
}

async function resolveLocation(): Promise<{ lat: number; lon: number; place: string }> {
  let fix: Awaited<ReturnType<typeof getFix>> = null;
  try {
    fix = await getFix({ maxWaitMs: 4000 });
  } catch {
    fix = null;
  }
  if (!fix) return FALLBACK;
  const near = nearestCity(fix.lat, fix.lon);
  const close = near && kmBetween(fix.lat, fix.lon, near.lat, near.lon) <= NEAR_KM;
  return { lat: fix.lat, lon: fix.lon, place: close ? near.city : 'Your location' };
}

async function fetchJson(url: string): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`Weather service returned ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Loads the forecast. Uses a cache younger than 20 minutes unless `force` is set. On any failure it returns
 * the cached forecast with stale: true, or null with an error. Never throws.
 */
export async function loadForecast(opts: { force?: boolean } = {}): Promise<LoadResult> {
  let cached: Forecast | null = null;
  try {
    cached = await readCache();
    if (cached && !opts.force) {
      const age = Date.now() - cached.fetchedAt;
      // a copy from before midnight starts on yesterday, so it is only fresh on the day it was fetched
      const sameDay = new Date(cached.fetchedAt).toDateString() === new Date().toDateString();
      if (age >= 0 && age < pollMs(FRESH_MS) && sameDay) return { forecast: cached, stale: false };
    }
    const loc = await resolveLocation();
    const fetchedAt = Date.now();
    // Google first when the user saved a key. Any failure (quota, offline, bad data) falls back to Open-Meteo.
    let forecast: Forecast | null = null;
    const gKey = await getGoogleKey();
    if (gKey) {
      try {
        const g = await fetchGoogleForecast(gKey, loc.lat, loc.lon);
        forecast = { ...g, place: loc.place, fetchedAt };
      } catch {
        forecast = null;
      }
    }
    if (!forecast) {
      const raw = await fetchJson(buildUrl(loc.lat, loc.lon));
      const meteo = parseForecast(raw, { lat: loc.lat, lon: loc.lon, place: loc.place, fetchedAt });
      if (!meteo) throw new Error('Unexpected forecast data');
      forecast = { ...meteo, source: 'open-meteo' };
    }
    writeCache(forecast);
    return { forecast, stale: false };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Could not load the forecast';
    return { forecast: cached, stale: true, error };
  }
}

export interface UseWeather {
  forecast: Forecast | null;
  stale: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useWeather(): UseWeather {
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  const run = useCallback(async (force: boolean) => {
    setLoading(true);
    const r = await loadForecast({ force });
    if (!alive.current) return;
    setForecast(r.forecast);
    setStale(r.stale);
    setLoading(false);
  }, []);

  useEffect(() => {
    alive.current = true;
    void run(false);
    return () => {
      alive.current = false;
    };
  }, [run]);

  const refresh = useCallback(() => run(true), [run]);
  return { forecast, stale, loading, refresh };
}
