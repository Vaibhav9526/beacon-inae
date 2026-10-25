import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { distanceKm } from '../../beacon/src/alerts/sources.ts';
import type { Db } from './db.ts';
import { HttpError } from './http.ts';
import type { Screener } from './moderation.ts';

const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4' };
const MAX_PER_HOUR = 10;
const MAX_AGE_MS = 48 * 3600_000;
const DELAYED_AFTER_MS = 10 * 60_000;

// community thresholds
export const MIN_VOTES = 5;
export const FAKE_RATIO_HIDE = 0.7;
export const REAL_RATIO_VERIFIED = 0.7;

export interface SubmitBody {
  kind: 'photo' | 'video';
  mime: string;
  media: string; // base64
  thumb?: string; // base64 poster frame for videos
  caption?: string;
  lat: number;
  lon: number;
  capturedAt: number;
  proof?: string;
}

export interface ReportView {
  id: string;
  kind: string;
  mediaUrl: string;
  thumbUrl?: string;
  caption: string;
  summary: string;
  category: string;
  lat: number;
  lon: number;
  capturedAt: number;
  createdAt: number;
  delayed: boolean;
  realVotes: number;
  fakeVotes: number;
  badge: 'community-verified' | 'disputed' | 'new';
}

export class ReportService {
  private posts = new Map<string, number[]>();

  constructor(
    private db: Db,
    private dir: string,
    private screener: Screener,
    private now: () => number = () => Date.now(),
    /** Awaited by tests so they can assert on the final status. */
    readonly pending: Promise<unknown>[] = [],
  ) {
    mkdirSync(join(dir, 'media'), { recursive: true });
  }

  private rateLimit(device: string) {
    const t = this.now();
    const recent = (this.posts.get(device) ?? []).filter((x) => t - x < 3600_000);
    if (recent.length >= MAX_PER_HOUR) throw new HttpError(429, 'too many posts, try again later');
    recent.push(t);
    this.posts.set(device, recent);
  }

  submit(device: string, b: SubmitBody) {
    if (!MIME_EXT[b.mime] || (b.kind === 'photo') !== b.mime.startsWith('image/')) throw new HttpError(400, 'unsupported media type');
    if (!Number.isFinite(b.lat) || !Number.isFinite(b.lon) || Math.abs(b.lat) > 90 || Math.abs(b.lon) > 180) throw new HttpError(400, 'bad location');
    const t = this.now();
    if (!Number.isFinite(b.capturedAt) || b.capturedAt > t + 2 * 60_000) throw new HttpError(400, 'bad capture time');
    if (t - b.capturedAt > MAX_AGE_MS) throw new HttpError(400, 'too old: reports must be captured in the last 48 hours');
    this.rateLimit(device);

    const media = Buffer.from(b.media, 'base64');
    if (media.length < 100) throw new HttpError(400, 'empty media');
    const id = randomBytes(8).toString('hex');
    const file = `${id}.${MIME_EXT[b.mime]}`;
    writeFileSync(join(this.dir, 'media', file), media);
    let thumbFile: string | null = null;
    let thumb: Buffer | undefined;
    if (b.thumb) {
      thumb = Buffer.from(b.thumb, 'base64');
      thumbFile = `${id}.thumb.jpg`;
      writeFileSync(join(this.dir, 'media', thumbFile), thumb);
    }
    const caption = String(b.caption ?? '').slice(0, 300);
    const delayed = t - b.capturedAt > DELAYED_AFTER_MS ? 1 : 0;
    this.db
      .prepare(
        `INSERT INTO reports (id, device, kind, mime, media_path, thumb_path, caption, lat, lon, captured_at, created_at, delayed, status, proof)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(id, device, b.kind, b.mime, file, thumbFile, caption, b.lat, b.lon, b.capturedAt, t, delayed, 'screening', b.proof ?? null);

    const image = b.kind === 'photo' ? { data: media, mime: b.mime } : thumb ? { data: thumb, mime: 'image/jpeg' } : undefined;
    const job = this.screener
      .screen({ caption, lat: b.lat, lon: b.lon, capturedAt: b.capturedAt, delayed: !!delayed, image, kind: b.kind })
      .then((s) => {
        this.db
          .prepare('UPDATE reports SET status=?, ai_json=?, summary=?, category=? WHERE id=? AND status=?')
          .run(s.decision === 'approve' ? 'approved' : 'review', JSON.stringify(s), s.summary, s.category, id, 'screening');
      })
      .catch(() => this.db.prepare('UPDATE reports SET status=? WHERE id=? AND status=?').run('review', id, 'screening'));
    this.pending.push(job);
    return { id, status: 'screening' as const };
  }

  private view(r: any): ReportView {
    const total = r.real_votes + r.fake_votes;
    const badge: ReportView['badge'] =
      total >= MIN_VOTES && r.real_votes / total >= REAL_RATIO_VERIFIED ? 'community-verified' : total >= MIN_VOTES && r.fake_votes / total > 0.4 ? 'disputed' : 'new';
    return {
      id: r.id,
      kind: r.kind,
      mediaUrl: `/media/${r.media_path}`,
      thumbUrl: r.thumb_path ? `/media/${r.thumb_path}` : undefined,
      caption: r.caption,
      summary: r.summary ?? r.caption,
      category: r.category ?? 'other',
      lat: r.lat,
      lon: r.lon,
      capturedAt: r.captured_at,
      createdAt: r.created_at,
      delayed: !!r.delayed,
      realVotes: r.real_votes,
      fakeVotes: r.fake_votes,
      badge,
    };
  }

  get(id: string): ReportView | null {
    const r = this.db.prepare("SELECT * FROM reports WHERE id=? AND status='approved'").get(id);
    return r ? this.view(r) : null;
  }

  /** Published reports near a point, newest first. */
  near(lat: number, lon: number, radiusKm = 50, limit = 30): ReportView[] {
    const rows = this.db.prepare("SELECT * FROM reports WHERE status='approved' ORDER BY created_at DESC LIMIT 400").all();
    return rows
      .filter((r: any) => distanceKm({ lat, lon }, { lat: r.lat, lon: r.lon }) <= radiusKm)
      .slice(0, limit)
      .map((r) => this.view(r));
  }

  vote(device: string, id: string, vote: 'real' | 'fake') {
    if (vote !== 'real' && vote !== 'fake') throw new HttpError(400, 'vote must be real or fake');
    const r: any = this.db.prepare('SELECT * FROM reports WHERE id=?').get(id);
    if (!r || r.status !== 'approved') throw new HttpError(404, 'report not found');
    if (r.device === device) throw new HttpError(403, 'you cannot vote on your own report');
    const prev: any = this.db.prepare('SELECT vote FROM votes WHERE report_id=? AND device=?').get(id, device);
    if (prev?.vote === vote) return this.get(id);
    this.db.prepare('INSERT OR REPLACE INTO votes (report_id, device, vote, ts) VALUES (?,?,?,?)').run(id, device, vote, this.now());
    const real = (this.db.prepare("SELECT COUNT(*) c FROM votes WHERE report_id=? AND vote='real'").get(id) as any).c;
    const fake = (this.db.prepare("SELECT COUNT(*) c FROM votes WHERE report_id=? AND vote='fake'").get(id) as any).c;
    const total = real + fake;
    // enough people say it is fake: pull it back for human review rather than deleting it
    const status = total >= MIN_VOTES && fake / total >= FAKE_RATIO_HIDE ? 'review' : 'approved';
    this.db.prepare('UPDATE reports SET real_votes=?, fake_votes=?, status=?, mod_note=COALESCE(mod_note, ?) WHERE id=?').run(real, fake, status, status === 'review' ? 'pulled back by community votes' : null, id);
    return status === 'approved' ? this.get(id) : { id, status: 'review' as const };
  }

  // ----- moderators -----

  queue() {
    return this.db
      .prepare("SELECT * FROM reports WHERE status='review' ORDER BY created_at ASC LIMIT 100")
      .all()
      .map((r: any) => ({ ...this.view(r), aiVerdict: r.ai_json ? JSON.parse(r.ai_json) : null, note: r.mod_note }));
  }

  decide(id: string, decision: 'approve' | 'reject', note?: string) {
    const status = decision === 'approve' ? 'approved' : 'rejected';
    const res = this.db.prepare("UPDATE reports SET status=?, mod_note=? WHERE id=? AND status IN ('review','approved','screening')").run(status, note ?? null, id);
    if (Number(res.changes) === 0) throw new HttpError(404, 'report not found');
    return { id, status };
  }
}
