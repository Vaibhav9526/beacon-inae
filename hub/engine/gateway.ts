import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildDigest, formatItemPost, packPosts } from './digest.ts';
import { chunkFeed } from './wire.ts';
import type { Members } from './members.ts';
import { SEVERITY_RANK, type FeedItem, type FeedKind, type GatewayRoute, type Member, type MemberRole, type Severity } from './types.ts';

const SEEN_MAX = 2000;
const DIGEST_MIN = 5;
const DIGEST_MAX = 1440;
const DIGEST_DEFAULT = 60;
const QUEUE_MAX = 40;
const QUEUE_TTL_MS = 24 * 3_600_000;
const ROUTES_MAX = 30;
const ROUTE_TEXT_MAX = 60;
const ROUTE_TAG_MAX = 40;

const FEED_KINDS: readonly FeedKind[] = ['news', 'weather', 'wind', 'quake', 'flood', 'alert', 'health', 'supply', 'advisory', 'chat', 'custom'];
const SEVERITIES = Object.keys(SEVERITY_RANK) as Severity[];
const ROLES: readonly MemberRole[] = ['adult', 'elder', 'child'];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown, max?: number): string[] | undefined =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === 'string')
        .map((x) => (max ? x.trim().slice(0, max) : x))
        .filter((x) => x.length > 0)
    : undefined;

/**
 * Validate and normalise routes from an untrusted source (the HTTP body or a saved file).
 * Throws a readable Error for a non-array, more than 30 routes, or a route that is not an object.
 * Unknown fields are dropped, invalid values fall back to defaults, and every id is unique.
 */
export function cleanRoutes(input: unknown): GatewayRoute[] {
  if (!Array.isArray(input)) throw new Error('routes must be an array');
  if (input.length > ROUTES_MAX) throw new Error(`at most ${ROUTES_MAX} routes`);
  const ids = new Set<string>();
  const freshId = (): string => {
    let id: string;
    do id = `r-${randomBytes(4).toString('hex')}`;
    while (ids.has(id));
    return id;
  };
  return input.map((raw, i) => {
    if (!isObject(raw)) throw new Error(`route ${i + 1} must be an object`);
    const given = typeof raw.id === 'string' ? raw.id.trim() : '';
    const id = given && !ids.has(given) ? given : freshId();
    ids.add(id);

    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, ROUTE_TEXT_MAX) : '';
    const m = isObject(raw.match) ? raw.match : {};
    const match: GatewayRoute['match'] = {};
    if (Array.isArray(m.kinds)) match.kinds = m.kinds.filter((k): k is FeedKind => FEED_KINDS.includes(k as FeedKind));
    const agents = strings(m.agents, ROUTE_TAG_MAX);
    if (agents) match.agents = agents;
    const tags = strings(m.tags, ROUTE_TAG_MAX);
    if (tags) match.tags = tags;
    if (SEVERITIES.includes(m.minSeverity as Severity)) match.minSeverity = m.minSeverity as Severity;

    const t = isObject(raw.to) ? raw.to : {};
    const to: GatewayRoute['to'] = { phones: t.phones === 'none' ? 'none' : 'all' };
    if (Array.isArray(t.roles)) to.roles = t.roles.filter((r): r is MemberRole => ROLES.includes(r as MemberRole));
    const members = strings(t.members);
    if (members) to.members = members;
    if (t.telegram === true) to.telegram = true;

    const route: GatewayRoute = {
      id,
      name: name || 'Route',
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
      match,
      to,
    };
    if (SEVERITIES.includes(raw.notifyFrom as Severity)) route.notifyFrom = raw.notifyFrom as Severity;
    if (typeof raw.continue === 'boolean') route.continue = raw.continue;
    if (isObject(raw.deliver)) {
      if (raw.deliver.mode === 'digest') {
        const n = typeof raw.deliver.everyMin === 'number' && Number.isFinite(raw.deliver.everyMin) ? raw.deliver.everyMin : DIGEST_DEFAULT;
        route.deliver = { mode: 'digest', everyMin: clampEvery(n) };
      } else if (raw.deliver.mode === 'instant') route.deliver = { mode: 'instant' };
    }
    return route;
  });
}

const clampEvery = (n: number): number => Math.min(DIGEST_MAX, Math.max(DIGEST_MIN, Math.round(n)));
const isDigest = (r: GatewayRoute): boolean => r.deliver?.mode === 'digest';
const everyOf = (r: GatewayRoute): number => clampEvery(r.deliver?.everyMin ?? DIGEST_DEFAULT);

export interface GatewayOptions {
  members: Members;
  sendToPhone(deviceId: string, blobs: string[]): Promise<void>;
  /** html is true when the text is Telegram HTML (dynamic text already escaped); callers that only take text keep working. */
  sendTelegram?(text: string, opts?: { html?: boolean }): Promise<void>;
  groupKey(): Uint8Array;
  now?: () => number;
}

export interface DispatchResult {
  /** items that reached at least one phone or Telegram */
  delivered: number;
  /** duplicates, items no route matched, and items whose every delivery failed */
  skipped: number;
  /** items matched per route id (an item counts once per route it matched) */
  byRoute: Record<string, number>;
  /** items held for a digest route's next update (not sent yet, not counted in skipped) */
  queued?: number;
  /** set for a manual run (deliverNow): what reached the phones and Telegram */
  report?: DeliveryReport;
}

export interface DeliveryReport {
  /** paired phones that took the items */
  phones: number;
  /** paired phones the items were meant for */
  phonesPaired: number;
  /** 'none' when every item was already sent before; 'off' when no Telegram sender is wired at all */
  telegram: 'sent' | 'failed' | 'off' | 'none';
  /** why Telegram did not get the items, when it did not */
  telegramNote?: string;
}

export interface DigestStatus {
  routeId: string;
  name: string;
  everyMin: number;
  queued: number;
  nextAt: number | null;
  lastFlush: number | null;
}

export interface FlushResult {
  flushed: Array<{ routeId: string; items: number; phones: number; telegram: boolean }>;
}

interface DigestQueue {
  items: Array<{ item: FeedItem; queuedAt: number }>;
  lastFlush: number | null;
}

interface State {
  routes: GatewayRoute[];
  seen: string[];
  digests: Record<string, DigestQueue>;
}

/** Routes that decide which feed items go to which phones, and sends them encrypted through the relay. */
export class Gateway {
  private state: State;

  constructor(
    private file: string,
    private opts: GatewayOptions,
  ) {
    if (existsSync(file)) {
      const s = JSON.parse(readFileSync(file, 'utf8')) as Partial<State>;
      this.state = { routes: s.routes ?? defaultRoutes(), seen: s.seen ?? [], digests: isObject(s.digests) ? (s.digests as Record<string, DigestQueue>) : {} };
    } else {
      this.state = { routes: defaultRoutes(), seen: [], digests: {} };
    }
  }

  private save() {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.file);
  }

  routes(): GatewayRoute[] {
    return JSON.parse(JSON.stringify(this.state.routes)) as GatewayRoute[];
  }

  setRoutes(r: unknown): void {
    this.state.routes = cleanRoutes(r);
    // forget the queues of routes that are gone or no longer digest routes
    const keep = new Set(this.state.routes.filter(isDigest).map((x) => x.id));
    for (const id of Object.keys(this.state.digests)) if (!keep.has(id)) delete this.state.digests[id];
    this.save();
  }

  defaultRoutes(): GatewayRoute[] {
    return defaultRoutes();
  }

  private matches(route: GatewayRoute, item: FeedItem): boolean {
    const m = route.match;
    if (m.kinds && !m.kinds.includes(item.kind)) return false;
    if (m.agents && !m.agents.includes(item.agentId)) return false;
    if (m.tags && !m.tags.some((t) => item.tags.includes(t))) return false;
    if (m.minSeverity && SEVERITY_RANK[item.severity] < SEVERITY_RANK[m.minSeverity]) return false;
    return true;
  }

  /**
   * Phones for a route: every member with a paired phone when `phones` is 'all', none when 'none'.
   * When `roles` or `members` are given, only members in either list are kept.
   */
  private recipients(route: GatewayRoute, all: Member[]): Member[] {
    if (route.to.phones !== 'all') return [];
    const { roles, members } = route.to;
    if (!roles && !members) return all;
    return all.filter((m) => !!roles?.includes(m.role) || !!members?.includes(m.id));
  }

  /**
   * What would happen to an item, without sending anything: which routes match, who would get it, whether it would
   * notify and whether a Telegram copy would go. Uses exactly the matching rules of dispatch().
   */
  preview(partial: Partial<FeedItem>): Array<{ routeId: string; routeName: string; recipients: string[]; telegram: boolean; notify: boolean; mode: 'instant' | 'digest'; everyMin?: number }> {
    const item: FeedItem = { id: 'preview', agentId: 'preview', agentName: 'Preview', kind: 'news', title: 'Preview', body: '', severity: 'info', at: Date.now(), tags: [], ...partial };
    const members = this.opts.members.list().filter((m) => !!m.deviceId);
    const out: ReturnType<Gateway['preview']> = [];
    for (const route of this.state.routes.filter((r) => r.enabled)) {
      if (!this.matches(route, item)) continue;
      out.push({
        routeId: route.id,
        routeName: route.name,
        recipients: this.recipients(route, members).map((m) => m.name),
        // digest routes post to Telegram in their update, so a calm item is covered too
        telegram: !!route.to.telegram && (isDigest(route) || SEVERITY_RANK[item.severity] >= SEVERITY_RANK.warning),
        notify: SEVERITY_RANK[item.severity] >= SEVERITY_RANK[route.notifyFrom ?? 'warning'],
        mode: isDigest(route) ? 'digest' : 'instant',
        ...(isDigest(route) ? { everyMin: everyOf(route) } : {}),
      });
      if (!route.continue) break;
    }
    return out;
  }

  /**
   * Route the items, drop the ones seen before, and send each phone its items as encrypted blobs. Items at or above
   * the route's notifyFrom get the 'notify' tag so the phone raises a notification. Delivery errors are counted, not thrown.
   * `deliverNow` (a manual Run) takes the other path: see deliverNow().
   */
  async dispatch(items: FeedItem[], opts: { deliverNow?: boolean } = {}): Promise<DispatchResult> {
    if (opts.deliverNow) return this.deliverNow(items);
    const result: DispatchResult = { delivered: 0, skipped: 0, byRoute: {} };
    const seen = new Set(this.state.seen);
    const fresh: FeedItem[] = [];
    for (const item of items) {
      if (seen.has(item.id)) result.skipped++;
      else {
        seen.add(item.id);
        fresh.push(item);
      }
    }
    // duplicates were counted above; fresh items are counted as delivered or skipped at the end
    this.state.seen = [...this.state.seen, ...fresh.map((i) => i.id)].slice(-SEEN_MAX);
    this.save();

    const enabled = this.state.routes.filter((r) => r.enabled);
    const members = this.opts.members.list().filter((m) => !!m.deviceId);
    // per phone: item id -> {item, notify}
    const perPhone = new Map<string, Map<string, { item: FeedItem; notify: boolean }>>();
    const telegram: FeedItem[] = [];
    const reached = new Set<string>();
    const held = new Set<string>();
    const now = this.now();

    for (const item of fresh) {
      for (const route of enabled) {
        if (!this.matches(route, item)) continue;
        result.byRoute[route.id] = (result.byRoute[route.id] ?? 0) + 1;
        const notify = SEVERITY_RANK[item.severity] >= SEVERITY_RANK[route.notifyFrom ?? 'warning'];
        if (isDigest(route)) {
          this.enqueue(route, item, now);
          held.add(item.id);
          // a storm never waits for the timer: severe items also go out right away
          if (item.severity !== 'severe') {
            if (!route.continue) break;
            continue;
          }
        }
        for (const m of this.recipients(route, members)) {
          const phone = perPhone.get(m.deviceId!) ?? new Map();
          perPhone.set(m.deviceId!, phone);
          const prev = phone.get(item.id);
          phone.set(item.id, { item, notify: notify || !!prev?.notify });
        }
        if (route.to.telegram && this.opts.sendTelegram && SEVERITY_RANK[item.severity] >= SEVERITY_RANK.warning) {
          if (!telegram.includes(item)) telegram.push(item);
        }
        if (!route.continue) break;
      }
    }

    for (const [deviceId, byId] of perPhone) {
      const batch = [...byId.values()].map(({ item, notify }) => ({
        ...item,
        tags: notify && !item.tags.includes('notify') ? [...item.tags, 'notify'] : item.tags,
      }));
      try {
        const blobs = chunkFeed(batch, this.opts.groupKey());
        await this.opts.sendToPhone(deviceId, blobs);
        for (const item of batch) reached.add(item.id);
      } catch {
        // one phone failing does not stop the others
      }
    }

    for (const item of telegram) {
      try {
        await this.opts.sendTelegram!(formatItemPost(item, { now }), { html: true });
        reached.add(item.id);
      } catch {
        // counted below as skipped when nothing else reached the item
      }
    }

    for (const item of fresh) {
      if (reached.has(item.id)) result.delivered++;
      else if (held.has(item.id)) result.queued = (result.queued ?? 0) + 1;
      else result.skipped++;
    }
    this.save();
    return result;
  }

  /**
   * A manual Run: the new items go out now to every paired phone and to Telegram. Digest queues, route rules and the
   * 'warning or above' Telegram threshold are bypassed. Dedupe still applies (an item already sent is not sent again),
   * and each run's current-weather item is new by its id, so a Run always shows the current numbers. Telegram still
   * goes through the outbox (first-send approval and audit log).
   */
  private async deliverNow(items: FeedItem[]): Promise<DispatchResult> {
    const now = this.now();
    const members = this.opts.members.list().filter((m) => !!m.deviceId);
    const seen = new Set(this.state.seen);
    const fresh = items.filter((i) => !seen.has(i.id));
    this.state.seen = [...this.state.seen, ...fresh.map((i) => i.id)].slice(-SEEN_MAX);
    const batch = fresh.map((item) => {
      const notify = SEVERITY_RANK[item.severity] >= SEVERITY_RANK.warning;
      return { ...item, tags: notify && !item.tags.includes('notify') ? [...item.tags, 'notify'] : item.tags };
    });

    let phones = 0;
    if (batch.length) {
      for (const m of members) {
        try {
          await this.opts.sendToPhone(m.deviceId!, chunkFeed(batch, this.opts.groupKey()));
          phones++;
        } catch {
          // one phone failing does not stop the others
        }
      }
    }

    let telegram: DeliveryReport['telegram'] = batch.length ? 'off' : 'none';
    let telegramNote: string | undefined;
    if (this.opts.sendTelegram && batch.length) {
      telegram = 'sent';
      try {
        for (const post of packPosts(batch.map((i) => formatItemPost(i, { now })))) await this.opts.sendTelegram(post, { html: true });
      } catch (e) {
        telegram = 'failed';
        telegramNote = e instanceof Error ? e.message : String(e);
      }
    }
    this.save();

    // duplicates and items whose every delivery failed are skipped, as in a scheduled run
    const delivered = phones > 0 || telegram === 'sent' ? batch.length : 0;
    return {
      delivered,
      skipped: items.length - delivered,
      byRoute: {},
      report: { phones, phonesPaired: members.length, telegram, telegramNote },
    };
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private enqueue(route: GatewayRoute, item: FeedItem, now: number): void {
    const q = (this.state.digests[route.id] ??= { items: [], lastFlush: null });
    if (q.lastFlush === null) q.lastFlush = now; // the first window starts with the first item
    if (q.items.some((x) => x.item.id === item.id)) return;
    q.items.push({ item, queuedAt: now });
    q.items = q.items.filter((x) => now - x.queuedAt <= QUEUE_TTL_MS).slice(-QUEUE_MAX);
  }

  /** Per digest route: how many items wait and when the next update is due. */
  digestStatus(): DigestStatus[] {
    const now = this.now();
    return this.state.routes.filter(isDigest).map((r) => {
      const q = this.state.digests[r.id];
      const every = everyOf(r);
      return {
        routeId: r.id,
        name: r.name,
        everyMin: every,
        queued: (q?.items ?? []).filter((x) => now - x.queuedAt <= QUEUE_TTL_MS).length,
        nextAt: q?.lastFlush != null ? q.lastFlush + every * 60_000 : null,
        lastFlush: q?.lastFlush ?? null,
      };
    });
  }

  /**
   * Send the queued items of every digest route that is due (or all of them / one route when forced) as ONE update each:
   * a combined phone item and the Telegram messages. A route with nothing queued sends nothing. When every delivery of a
   * route fails the queue is kept for the next tick; when there is nobody to send to the queue is cleared.
   * Telegram decision: a digest is a post the family asked for on a schedule, so it goes to Telegram whenever the route
   * has Telegram on, including calm digests where everything is info (instant routes still need warning or more).
   */
  async flushDigests(now: number = this.now(), opts: { force?: boolean; routeId?: string } = {}): Promise<FlushResult> {
    const flushed: FlushResult['flushed'] = [];
    const members = this.opts.members.list().filter((m) => !!m.deviceId);
    for (const route of this.state.routes) {
      if (!route.enabled || !isDigest(route) || (opts.routeId && route.id !== opts.routeId)) continue;
      const q = this.state.digests[route.id];
      if (!q) continue;
      q.items = q.items.filter((x) => now - x.queuedAt <= QUEUE_TTL_MS);
      if (!q.items.length) continue;
      const every = everyOf(route);
      if (!opts.force && q.lastFlush !== null && now < q.lastFlush + every * 60_000) continue;

      const items = q.items.map((x) => x.item);
      const threshold = SEVERITY_RANK[route.notifyFrom ?? 'warning'];
      const notify = items.some((i) => SEVERITY_RANK[i.severity] >= threshold);
      const d = buildDigest(items, { title: route.name, nextInMin: every, now, notify, routeId: route.id });

      let attempted = 0;
      let phones = 0;
      for (const m of this.recipients(route, members)) {
        attempted++;
        try {
          await this.opts.sendToPhone(m.deviceId!, chunkFeed([d.phoneItem], this.opts.groupKey()));
          phones++;
        } catch {
          // one phone failing does not stop the others
        }
      }
      let telegram = false;
      if (route.to.telegram && this.opts.sendTelegram) {
        attempted++;
        try {
          for (const msg of d.telegram) await this.opts.sendTelegram(msg, { html: true });
          telegram = true;
        } catch {
          // reported through the result
        }
      }
      if (attempted > 0 && phones === 0 && !telegram) continue; // keep the queue, try again next tick
      q.items = [];
      q.lastFlush = now;
      flushed.push({ routeId: route.id, items: items.length, phones, telegram });
    }
    this.save();
    return { flushed };
  }
}

/** The starting routes: urgent items to every phone, news quietly, health to adults only. */
export function defaultRoutes(): GatewayRoute[] {
  return [
    {
      id: 'health-adults',
      name: 'Health: adults only',
      enabled: true,
      match: { kinds: ['health'] },
      to: { phones: 'all', roles: ['adult'] },
      notifyFrom: 'warning',
    },
    {
      id: 'urgent',
      name: 'Everything urgent',
      enabled: true,
      match: { minSeverity: 'warning' },
      to: { phones: 'all' },
      notifyFrom: 'warning',
    },
    {
      id: 'news',
      name: 'News',
      enabled: true,
      match: { kinds: ['news'] },
      to: { phones: 'all' },
      // no notification for ordinary news: only severe news would ever notify
      notifyFrom: 'severe',
    },
  ];
}
