import { fetchAirQuality, fetchEarthquakes, fetchNdmaAlerts, fetchWeatherAlerts, type Point } from '../../beacon/src/alerts/sources.ts';
import type { AlertBody } from '../../beacon/src/mesh/node.ts';
import type { ServerKey } from './keys.ts';

export interface SignedAlert {
  alert: AlertBody;
  /** base64 Ed25519 signature over JSON.stringify(alert) */
  sig: string;
}

type FetchLike = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown>; text(): Promise<string> }>;

/** Response cache so many phones asking at once don't hammer USGS, Open-Meteo or NDMA. */
export function cachedFetch(ttlMs: number, inner: FetchLike = (u) => fetch(u) as never, now = () => Date.now()): FetchLike {
  const cache = new Map<string, { at: number; ok: boolean; body: string }>();
  return async (url) => {
    const hit = cache.get(url);
    if (!hit || now() - hit.at > ttlMs) {
      let entry = { at: now(), ok: false, body: '' };
      try {
        const r = await inner(url);
        entry = { at: now(), ok: r.ok, body: r.ok ? await r.text() : '' };
      } catch {
        if (hit) return respond(hit); // stale beats nothing when an upstream is down
      }
      cache.set(url, entry);
      return respond(entry);
    }
    return respond(hit);
  };
}

const respond = (e: { ok: boolean; body: string }) => ({
  ok: e.ok,
  text: async () => e.body,
  json: async () => JSON.parse(e.body || '{}'),
});

export class AlertService {
  private f: FetchLike;
  constructor(private key: ServerKey, f?: FetchLike) {
    this.f = f ?? cachedFetch(5 * 60_000);
  }

  /** Alerts relevant at a position, each signed so phones can re-broadcast them over the mesh as official. */
  async near(p: Point): Promise<SignedAlert[]> {
    const parts = await Promise.allSettled([
      fetchEarthquakes(p, this.f),
      fetchWeatherAlerts(p, this.f),
      fetchAirQuality(p, this.f),
      fetchNdmaAlerts(p, { enrich: true, limit: 40 }, this.f),
    ]);
    const rank = { severe: 0, warning: 1, watch: 2, info: 3 } as const;
    return parts
      .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
      .filter((a) => !a.expires || a.expires > Date.now())
      .sort((a, b) => rank[a.severity] - rank[b.severity])
      .slice(0, 30)
      .map((alert) => ({ alert, sig: this.key.sign(JSON.stringify(alert)) }));
  }

  sign(alert: AlertBody): SignedAlert {
    return { alert, sig: this.key.sign(JSON.stringify(alert)) };
  }
}
