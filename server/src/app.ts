import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { distanceKm } from '../../beacon/src/alerts/sources.ts';
import { AlertService } from './alerts.ts';
import type { Db } from './db.ts';
import type { Pusher } from './fcm.ts';
import { HttpError, Router, reply, type Req } from './http.ts';
import { type ServerKey, verifyDeviceRequest } from './keys.ts';
import { clip60 } from './moderation.ts';
import { MOD_HTML } from './modPage.ts';
import { RelayService } from './relay.ts';
import { ReportService } from './reports.ts';

export interface NewsCard {
  id: string;
  kind: 'alert' | 'report';
  title: string;
  /** about 60 words, "in short" style */
  summary: string;
  severity?: string;
  source: string;
  ts: number;
  lat?: number;
  lon?: number;
  mediaUrl?: string;
  reportId?: string;
  badge?: string;
}

export interface AppDeps {
  db: Db;
  key: ServerKey;
  alerts: AlertService;
  reports: ReportService;
  pusher: Pusher;
  modToken?: string;
  now?: () => number;
  dataDir: string;
}

const num = (v: string | null, d?: number) => {
  const n = Number(v);
  if (v == null || v === '' || !Number.isFinite(n)) {
    if (d !== undefined) return d;
    throw new HttpError(400, 'lat and lon are required');
  }
  return n;
};

export function createApp(d: AppDeps) {
  const r = new Router();
  const now = d.now ?? (() => Date.now());
  const relay = new RelayService(d.db, d.pusher, now);

  /** Routes that change data need a signed request from a device key. */
  const signed = (req: Req): string => {
    const device = String(req.headers['x-device'] ?? '');
    const ok = verifyDeviceRequest({
      device,
      ts: String(req.headers['x-ts'] ?? ''),
      sig: String(req.headers['x-sig'] ?? ''),
      method: req.method,
      path: req.path,
      body: req.raw,
      now: now(),
    });
    if (!ok) throw new HttpError(401, 'bad or missing signature');
    return device;
  };

  const mod = (req: Req) => {
    const auth = String(req.headers['authorization'] ?? '');
    if (!d.modToken || auth !== `Bearer ${d.modToken}`) throw new HttpError(401, 'moderator token required');
  };

  async function newsFor(lat: number, lon: number, limit = 30): Promise<NewsCard[]> {
    const here = { lat, lon };
    const cards: NewsCard[] = [];
    for (const { alert, sig: _s } of await d.alerts.near(here)) {
      cards.push({
        id: alert.id,
        kind: 'alert',
        title: alert.title,
        summary: clip60(alert.body),
        severity: alert.severity,
        source: alert.source,
        ts: alert.expires ? alert.expires - 6 * 3600_000 : now(),
        lat: alert.lat,
        lon: alert.lon,
      });
    }
    for (const rep of d.reports.near(lat, lon, 100, 30)) {
      cards.push({
        id: `report-${rep.id}`,
        kind: 'report',
        title: rep.category.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
        summary: clip60(rep.summary),
        source: 'Citizen report',
        ts: rep.capturedAt,
        lat: rep.lat,
        lon: rep.lon,
        mediaUrl: rep.thumbUrl ?? rep.mediaUrl,
        reportId: rep.id,
        badge: rep.badge,
      });
    }
    return cards.sort((a, b) => b.ts - a.ts).slice(0, limit);
  }

  // ---------- public ----------

  r.get('/health', () => ({ ok: true, time: now() }));
  r.get('/v1/pubkey', () => ({ publicKey: d.key.publicKeyB64 }));

  r.get('/v1/alerts', async (req) => ({ alerts: await d.alerts.near({ lat: num(req.query.get('lat')), lon: num(req.query.get('lon')) }) }));
  r.get('/v1/news', async (req) => ({ cards: await newsFor(num(req.query.get('lat')), num(req.query.get('lon')), num(req.query.get('limit'), 30)) }));

  r.get('/v1/reports', (req) => ({
    reports: d.reports.near(num(req.query.get('lat')), num(req.query.get('lon')), num(req.query.get('radius'), 50)),
  }));

  r.get('/media/:file', (req) => {
    const f = req.params.file;
    if (!/^[a-f0-9]+(\.thumb)?\.(jpg|png|webp|mp4)$/.test(f)) throw new HttpError(404, 'not found');
    const p = join(d.dataDir, 'media', f);
    if (!existsSync(p)) throw new HttpError(404, 'not found');
    const type = f.endsWith('.mp4') ? 'video/mp4' : f.endsWith('.png') ? 'image/png' : f.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return reply(readFileSync(p), 200, { 'content-type': type, 'cache-control': 'public, max-age=86400' });
  });

  // ---------- device writes (signed) ----------

  r.post('/v1/devices', (req) => {
    const device = signed(req);
    const b = req.json<{ pushToken?: string; lat?: number; lon?: number; lang?: string }>();
    d.db
      .prepare('INSERT OR REPLACE INTO devices (device, push_token, lat, lon, lang, updated) VALUES (?,?,?,?,?,?)')
      .run(device, b.pushToken ?? null, b.lat ?? null, b.lon ?? null, b.lang ?? 'en', now());
    return { ok: true };
  });

  r.post('/v1/reports', (req) => reply(d.reports.submit(signed(req), req.json()), 202));
  r.post('/v1/reports/:id/vote', (req) => d.reports.vote(signed(req), req.params.id, req.json<{ vote: 'real' | 'fake' }>().vote));

  /**
   * Any phone with internet acts as a gateway: it uploads what the mesh heard (SOS, safe check-ins, board posts)
   * and takes back official alerts and news to re-broadcast offline.
   */
  r.post('/v1/gateway/sync', async (req) => {
    const device = signed(req);
    const b = req.json<{
      location?: { lat: number; lon: number };
      sos?: { id: string; name: string; lat: number; lon: number; note: string; medical?: string; ts: number }[];
      safe?: { from: string; name: string; family?: string; lat?: number; lon?: number; note?: string; ts: number }[];
      board?: { id: string; kind: string; text: string; nickname: string; lat?: number; lon?: number; ts: number }[];
    }>();
    const t = now();
    for (const s of (b.sos ?? []).slice(0, 100)) {
      d.db
        .prepare('INSERT OR IGNORE INTO sos (id, device, name, lat, lon, note, medical, ts, via) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(String(s.id).slice(0, 32), device, String(s.name ?? '').slice(0, 40), s.lat, s.lon, String(s.note ?? '').slice(0, 300), s.medical ?? null, Math.min(s.ts, t), 'mesh');
    }
    for (const s of (b.safe ?? []).slice(0, 100)) {
      d.db
        .prepare('INSERT OR IGNORE INTO safe (id, device, name, family, lat, lon, note, ts) VALUES (?,?,?,?,?,?,?,?)')
        .run(`${s.from}:${s.ts}`, device, String(s.name ?? '').slice(0, 40), s.family ?? null, s.lat ?? null, s.lon ?? null, s.note ?? null, Math.min(s.ts, t));
    }
    for (const p of (b.board ?? []).slice(0, 100)) {
      if (!['need', 'offer', 'help'].includes(p.kind)) continue;
      d.db
        .prepare('INSERT OR IGNORE INTO board (id, device, kind, text, nickname, lat, lon, ts) VALUES (?,?,?,?,?,?,?,?)')
        .run(String(p.id).slice(0, 64), device, p.kind, String(p.text).slice(0, 500), String(p.nickname ?? '').slice(0, 32), p.lat ?? null, p.lon ?? null, Math.min(p.ts, t));
    }
    const loc = b.location;
    const alerts = loc ? await d.alerts.near(loc) : [];
    return { serverTime: t, alerts, cards: loc ? await newsFor(loc.lat, loc.lon, 20) : [], publicKey: d.key.publicKeyB64 };
  });

  // ---------- family ----------

  r.post('/v1/family/location', (req) => {
    const device = signed(req);
    const b = req.json<{ family: string; name: string; lat: number; lon: number }>();
    if (!/^[A-Z0-9]{6,12}$/.test(b.family ?? '')) throw new HttpError(400, 'bad family code');
    d.db.prepare('INSERT OR REPLACE INTO family_loc (family, device, name, lat, lon, ts) VALUES (?,?,?,?,?,?)').run(b.family, device, String(b.name).slice(0, 40), b.lat, b.lon, now());
    return { ok: true };
  });

  const familyEvent = (kind: 'safe' | 'sos') => (req: Req) => {
    const device = signed(req);
    const b = req.json<{ family: string; name: string; lat?: number; lon?: number; note?: string }>();
    if (!/^[A-Z0-9]{6,12}$/.test(b.family ?? '')) throw new HttpError(400, 'bad family code');
    d.db
      .prepare('INSERT INTO safe (id, device, name, family, lat, lon, note, ts, kind) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(randomBytes(6).toString('hex'), device, String(b.name).slice(0, 40), b.family, b.lat ?? null, b.lon ?? null, b.note ?? null, now(), kind);
    return { ok: true };
  };
  r.post('/v1/family/safe', familyEvent('safe'));
  r.post('/v1/family/sos', familyEvent('sos'));

  /** A parent replaces the family's safe zones. */
  r.post('/v1/family/zones', (req) => {
    signed(req);
    const b = req.json<{ family: string; zones: { id: string; name: string; lat: number; lon: number; radius: number }[] }>();
    if (!/^[A-Z0-9]{6,12}$/.test(b.family ?? '')) throw new HttpError(400, 'bad family code');
    d.db.prepare('DELETE FROM family_zones WHERE family=?').run(b.family);
    for (const z of (b.zones ?? []).slice(0, 12)) {
      d.db
        .prepare('INSERT INTO family_zones (family, id, name, lat, lon, radius) VALUES (?,?,?,?,?,?)')
        .run(b.family, String(z.id).slice(0, 16), String(z.name).slice(0, 40), z.lat, z.lon, Math.min(Math.max(z.radius, 30), 5000));
    }
    return { ok: true };
  });

  /** The family code is the shared secret that pairs a parent with a child. */
  r.get('/v1/family/:code', (req) => {
    const code = req.params.code;
    if (!/^[A-Z0-9]{6,12}$/.test(code)) throw new HttpError(400, 'bad family code');
    const zones = d.db.prepare('SELECT id, name, lat, lon, radius FROM family_zones WHERE family=?').all(code) as { id: string; name: string; lat: number; lon: number; radius: number }[];
    const members = (d.db.prepare('SELECT name, lat, lon, ts FROM family_loc WHERE family=? ORDER BY ts DESC').all(code) as { name: string; lat: number; lon: number; ts: number }[]).map((m) => ({
      ...m,
      zone: zones.find((z) => distanceKm({ lat: m.lat, lon: m.lon }, { lat: z.lat, lon: z.lon }) * 1000 <= z.radius)?.name ?? null,
    }));
    return {
      members,
      zones,
      safe: d.db.prepare('SELECT name, lat, lon, note, ts, kind FROM safe WHERE family=? ORDER BY ts DESC LIMIT 20').all(code),
    };
  });

  // ---------- resource board ----------

  r.get('/v1/board', (req) => {
    const lat = num(req.query.get('lat'));
    const lon = num(req.query.get('lon'));
    const rows = d.db.prepare('SELECT id, kind, text, nickname, lat, lon, ts FROM board ORDER BY ts DESC LIMIT 200').all() as any[];
    return {
      posts: rows.filter((p) => p.lat == null || distanceKm({ lat, lon }, { lat: p.lat, lon: p.lon }) <= 50).slice(0, 60),
    };
  });

  r.post('/v1/board', (req) => {
    const device = signed(req);
    const b = req.json<{ kind: string; text: string; nickname: string; lat?: number; lon?: number }>();
    if (!['need', 'offer', 'help'].includes(b.kind) || !b.text) throw new HttpError(400, 'bad post');
    const id = randomBytes(8).toString('hex');
    d.db.prepare('INSERT INTO board (id, device, kind, text, nickname, lat, lon, ts) VALUES (?,?,?,?,?,?,?,?)').run(id, device, b.kind, b.text.slice(0, 500), String(b.nickname ?? '').slice(0, 32), b.lat ?? null, b.lon ?? null, now());
    return { id };
  });

  // ---------- hub <-> phone relay (signed by the hub's or phone's key) ----------

  r.post('/v1/hub/register', (req) => relay.register(signed(req), req.json()));
  r.post('/v1/hub/pair-token', (req) => relay.issuePairToken(signed(req), req.json()));
  r.post('/v1/hub/pair', (req) => relay.pair(signed(req), req.json()));
  r.post('/v1/hub/push', (req) => relay.push(signed(req), req.json()));
  r.get('/v1/hub/phones', (req) => relay.phones(signed(req)));
  r.add('DELETE', '/v1/hub/phones/:deviceId', (req) => relay.unpair(signed(req), req.params.deviceId!));
  r.post('/v1/mail/send', (req) => relay.send(signed(req), req.json()));
  r.get('/v1/mail/inbox', (req) => relay.inbox(signed(req), num(req.query.get('since'), 0)));

  // ---------- moderators ----------

  r.get('/mod',() => reply(MOD_HTML, 200, { 'content-type': 'text/html; charset=utf-8' }));
  r.get('/v1/mod/queue', (req) => (mod(req), { reports: d.reports.queue() }));
  r.post('/v1/mod/reports/:id', (req) => {
    mod(req);
    const b = req.json<{ decision: 'approve' | 'reject'; note?: string }>();
    if (b.decision !== 'approve' && b.decision !== 'reject') throw new HttpError(400, 'decision must be approve or reject');
    return d.reports.decide(req.params.id, b.decision, b.note);
  });
  r.get('/v1/mod/sos', (req) => (mod(req), { sos: d.db.prepare('SELECT * FROM sos WHERE resolved=0 ORDER BY ts DESC LIMIT 200').all() }));
  r.post('/v1/mod/sos/:id/resolve', (req) => {
    mod(req);
    d.db.prepare('UPDATE sos SET resolved=1 WHERE id=?').run(req.params.id);
    return { ok: true };
  });

  return r;
}

/** Push warnings and severe alerts to registered devices whose area they cover. Call every few minutes. */
export async function pushNewAlerts(d: Pick<AppDeps, 'db' | 'alerts' | 'pusher'>, now = Date.now()) {
  const devices = d.db
    .prepare('SELECT device, push_token, lat, lon FROM devices WHERE push_token IS NOT NULL AND lat IS NOT NULL AND updated > ?')
    .all(now - 7 * 86400_000) as { device: string; push_token: string; lat: number; lon: number }[];
  let sent = 0;
  const cells = new Map<string, typeof devices>();
  for (const dev of devices) {
    const k = `${Math.round(dev.lat * 4) / 4},${Math.round(dev.lon * 4) / 4}`; // ~25 km grid keeps upstream calls low
    cells.set(k, [...(cells.get(k) ?? []), dev]);
  }
  for (const group of cells.values()) {
    const alerts = (await d.alerts.near({ lat: group[0].lat, lon: group[0].lon })).filter((a) => a.alert.severity === 'severe' || a.alert.severity === 'warning');
    for (const dev of group) {
      for (const { alert } of alerts) {
        const fresh = d.db.prepare('INSERT OR IGNORE INTO alerts_sent (alert_id, device, ts) VALUES (?,?,?)').run(alert.id, dev.device, now);
        if (Number(fresh.changes) === 0) continue;
        if (await d.pusher.send({ token: dev.push_token, title: alert.title, body: clip60(alert.body), data: { alertId: alert.id, severity: alert.severity } })) sent++;
      }
    }
  }
  return sent;
}
