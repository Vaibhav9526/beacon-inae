import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chunkFeed } from './wire.ts';
import type { Members } from './members.ts';
import { SEVERITY_RANK, type FeedItem, type FeedKind, type GatewayRoute, type Member, type MemberRole, type Severity } from './types.ts';

const SEEN_MAX = 2000;
const TELEGRAM_CHARS = 300;
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
    return route;
  });
}

export interface GatewayOptions {
  members: Members;
  sendToPhone(deviceId: string, blobs: string[]): Promise<void>;
  sendTelegram?(text: string): Promise<void>;
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
}

interface State {
  routes: GatewayRoute[];
  seen: string[];
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
      this.state = { routes: s.routes ?? defaultRoutes(), seen: s.seen ?? [] };
    } else {
      this.state = { routes: defaultRoutes(), seen: [] };
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
  preview(partial: Partial<FeedItem>): Array<{ routeId: string; routeName: string; recipients: string[]; telegram: boolean; notify: boolean }> {
    const item: FeedItem = { id: 'preview', agentId: 'preview', agentName: 'Preview', kind: 'news', title: 'Preview', body: '', severity: 'info', at: Date.now(), tags: [], ...partial };
    const members = this.opts.members.list().filter((m) => !!m.deviceId);
    const out: Array<{ routeId: string; routeName: string; recipients: string[]; telegram: boolean; notify: boolean }> = [];
    for (const route of this.state.routes.filter((r) => r.enabled)) {
      if (!this.matches(route, item)) continue;
      out.push({
        routeId: route.id,
        routeName: route.name,
        recipients: this.recipients(route, members).map((m) => m.name),
        telegram: !!route.to.telegram && SEVERITY_RANK[item.severity] >= SEVERITY_RANK.warning,
        notify: SEVERITY_RANK[item.severity] >= SEVERITY_RANK[route.notifyFrom ?? 'warning'],
      });
      if (!route.continue) break;
    }
    return out;
  }

  /**
   * Route the items, drop the ones seen before, and send each phone its items as encrypted blobs. Items at or above
   * the route's notifyFrom get the 'notify' tag so the phone raises a notification. Delivery errors are counted, not thrown.
   */
  async dispatch(items: FeedItem[]): Promise<DispatchResult> {
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

    for (const item of fresh) {
      for (const route of enabled) {
        if (!this.matches(route, item)) continue;
        result.byRoute[route.id] = (result.byRoute[route.id] ?? 0) + 1;
        const notify = SEVERITY_RANK[item.severity] >= SEVERITY_RANK[route.notifyFrom ?? 'warning'];
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
        const text = `${item.agentName}: ${item.title}`.slice(0, TELEGRAM_CHARS);
        await this.opts.sendTelegram!(text);
        reached.add(item.id);
      } catch {
        // counted below as skipped when nothing else reached the item
      }
    }

    for (const item of fresh) {
      if (reached.has(item.id)) result.delivered++;
      else result.skipped++;
    }
    return result;
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
