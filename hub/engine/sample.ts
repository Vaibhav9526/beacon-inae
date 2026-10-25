import type { Metrics, SourceKind } from './types.ts';

/** Deterministic offline readings (a hot, smoggy day in Delhi) for demos and tests. Only keys for requested kinds are included. */
export function sampleMetrics(kinds: SourceKind[], members: string[] = ['Maa']): Metrics {
  const m: Metrics = {};
  const want = new Set(kinds);

  if (want.has('weather')) {
    Object.assign(m, {
      temp_c: 43,
      feels_like_c: 46,
      humidity_pct: 30,
      heat_index_c: 46,
      wind_kmh: 12,
      wind_gust_kmh: 18,
      uv_index: 10,
      rain_mm_24h: 0,
      rain_mm_now: 0,
    });
  }

  if (want.has('aqi')) {
    Object.assign(m, { aqi: 182, pm25: 95 });
  }

  if (want.has('quake')) {
    Object.assign(m, { quake_max_mag: 0, quake_nearest_km: 9999, quake_count: 0 });
  }

  if (want.has('alerts')) {
    Object.assign(m, { official_alert_count: 1, official_alert_max: 2 });
  }

  if (want.has('health')) {
    for (const member of members) {
      Object.assign(m, {
        [`hr:${member}`]: 112,
        [`spo2:${member}`]: 91,
        [`steps:${member}`]: 1800,
        [`sleep_h:${member}`]: 5.5,
        [`health_status:${member}`]: 2,
      });
    }
  }

  if (want.has('supply')) {
    Object.assign(m, { water_days: 3, food_days: 5, medicine_days: 9 });
  }

  return m;
}
