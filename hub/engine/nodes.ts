// Node pipelines: an agent's `pipeline` runs top to bottom. Source nodes add FeedItems to the stream,
// transform nodes reshape it. Each node is isolated: a failure becomes NodeRunResult.error and the run goes on.

import { getAqi, getQuakes, getWeather } from './sources.ts';
import { htmlToText, itemId, parseFeed, trimWords, wordCount } from './rss.ts';
import { capToFeedItem, parseCapAlert } from './capParse.ts';
import type {
  Agent, FeedItem, FeedKind, Genre, Metrics, NodeKind, NodeRunResult, NodeSpec, Op, Place, Severity, SourceOptions,
} from './types.ts';

export interface NodeContext {
  fetch?: SourceOptions['fetch'];
  offline?: boolean;
  now?: () => number;
  callMcp?: (server: string, tool: string, args: Record<string, unknown>) => Promise<unknown>;
  summarize?: (text: string) => Promise<string | null>;
  /** Readings the hub already has for this agent. When given, weather, aqi and quake nodes use them instead of fetching. */
  metricsFor?: (agent: Agent) => Promise<Metrics>;
}

/** Most items one agent run hands on to the gateway. */
export const MAX_ITEMS = 30;
/** Most words in any item body. */
export const BODY_WORDS = 60;
const DEFAULT_LIMIT = 8;
const TIMEOUT_MS = 8000;
const UA = 'BeaconHub/0.1 (community disaster app)';

const SOURCE_KINDS: readonly NodeKind[] = ['rss', 'http-json', 'weather', 'aqi', 'quake', 'cap', 'mcp-tool'];
const OPS: readonly Op[] = ['>', '>=', '<', '<=', '==', '!='];
const FEED_KINDS: readonly FeedKind[] = [
  'news', 'weather', 'wind', 'quake', 'flood', 'alert', 'health', 'supply', 'advisory', 'chat', 'custom',
];
const SEVERITIES: readonly Severity[] = ['info', 'watch', 'warning', 'severe'];
/** Words in a headline that lift a news item from info to watch. */
const HAZARD_RE = /\b(flood|cyclone|earthquake|landslide|heat ?wave|tsunami|cloudburst)/i;
/** Indian states and union territories, lower case, for filtering alerts by place. */
const INDIAN_STATES = [
  'andhra pradesh', 'arunachal pradesh', 'assam', 'bihar', 'chhattisgarh', 'goa', 'gujarat', 'haryana',
  'himachal pradesh', 'jharkhand', 'karnataka', 'kerala', 'madhya pradesh', 'maharashtra', 'manipur',
  'meghalaya', 'mizoram', 'nagaland', 'odisha', 'punjab', 'rajasthan', 'sikkim', 'tamil nadu', 'telangana',
  'tripura', 'uttar pradesh', 'uttarakhand', 'west bengal', 'andaman and nicobar', 'chandigarh',
  'dadra and nagar haveli', 'daman and diu', 'delhi', 'jammu and kashmir', 'ladakh', 'lakshadweep', 'puducherry',
];

// ---------------------------------------------------------------------------
// small helpers

const now = (ctx: NodeContext) => (ctx.now ? ctx.now() : Date.now());
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function clampLimit(v: unknown): number {
  const n = typeof v === 'number' ? Math.floor(v) : DEFAULT_LIMIT;
  return Math.min(MAX_ITEMS, Math.max(1, Number.isFinite(n) ? n : DEFAULT_LIMIT));
}

function feedKind(v: unknown, fallback: FeedKind): FeedKind {
  return FEED_KINDS.includes(v as FeedKind) ? (v as FeedKind) : fallback;
}

function severityOf(v: unknown): Severity {
  return SEVERITIES.includes(v as Severity) ? (v as Severity) : 'info';
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** GET for a source node. Uses ctx.fetch when given (tests), otherwise the platform fetch. */
async function httpGet(url: string, ctx: NodeContext, mode: 'text' | 'json'): Promise<unknown> {
  if (ctx.offline) throw new Error('offline');
  if (ctx.fetch) {
    const res = await withTimeout(ctx.fetch(url));
    if (!res.ok) throw new Error(`HTTP error for ${url}`);
    return mode === 'text' ? res.text() : res.json();
  }
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return mode === 'text' ? res.text() : res.json();
}

interface Draft {
  nodeId: string;
  kind: FeedKind;
  title: string;
  body: string;
  severity: Severity;
  at: number;
  url?: string;
  tags?: string[];
  place?: string;
  data?: Record<string, number | string>;
}

function makeItem(agent: Agent, d: Draft): FeedItem {
  const title = htmlToText(d.title) || d.url || 'Untitled';
  const item: FeedItem = {
    id: itemId(d.kind, title, d.url),
    agentId: agent.id,
    agentName: agent.name,
    nodeId: d.nodeId,
    kind: d.kind,
    title,
    body: d.body,
    severity: d.severity,
    at: d.at,
    tags: d.tags ?? [],
  };
  if (d.url) item.url = d.url;
  if (d.place) item.place = d.place;
  if (d.data) item.data = d.data;
  return item;
}

/** Numbers only, for FeedItem.data. */
function numbersOf(m: Metrics): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return out;
}

const fmt = (v: number | undefined, unit: string) => (typeof v === 'number' && Number.isFinite(v) ? `${v}${unit}` : 'n/a');

// ---------------------------------------------------------------------------
// source nodes

async function runRss(node: NodeSpec, agent: Agent, ctx: NodeContext): Promise<FeedItem[]> {
  const url = str(node.config.url);
  if (!url) throw new Error('rss node needs config.url');
  const limit = clampLimit(node.config.limit);
  const xml = await httpGet(url, ctx, 'text');
  const kind = feedKind(node.config.kind, 'news');
  const at = now(ctx);
  return parseFeed(String(xml)).slice(0, limit).map((e) => makeItem(agent, {
    nodeId: node.id,
    kind,
    title: e.title || e.link,
    body: e.summary,
    severity: HAZARD_RE.test(e.title) ? 'watch' : 'info',
    at: e.publishedAt ?? at,
    url: e.link || undefined,
  }));
}

/** Dot path with [n] indexes, e.g. "data.alerts[0].items". Empty path returns the root. */
function dotPath(root: unknown, path: string): unknown {
  const tokens = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur: unknown = root;
  for (const t of tokens) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[t];
  }
  return cur;
}

/** First non-empty string (or number) among the keys, in order. */
function pickStr(rec: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'number') return String(v);
  }
  return '';
}

interface RecordMap {
  kind: FeedKind;
  titleKey?: unknown;
  bodyKey?: unknown;
  urlKey?: unknown;
  limit: number;
}

/** Maps plain records (JSON objects from an API or an MCP tool) to FeedItems. Records without a title are skipped. */
function recordsToItems(node: NodeSpec, agent: Agent, records: unknown[], map: RecordMap, at: number): FeedItem[] {
  const keysFor = (custom: unknown, defaults: string[]) => (str(custom) ? [str(custom) as string, ...defaults] : defaults);
  const out: FeedItem[] = [];
  for (const raw of records) {
    if (out.length >= map.limit) break;
    if (!isObj(raw)) continue;
    const title = htmlToText(pickStr(raw, keysFor(map.titleKey, ['title', 'name', 'headline'])));
    if (!title) continue;
    const body = htmlToText(pickStr(raw, keysFor(map.bodyKey, ['summary', 'text', 'body', 'description'])));
    const url = pickStr(raw, keysFor(map.urlKey, ['url', 'link'])) || undefined;
    out.push(makeItem(agent, {
      nodeId: node.id,
      kind: map.kind,
      title,
      body,
      severity: severityOf(raw.severity),
      at,
      url,
    }));
  }
  return out;
}

async function runHttpJson(node: NodeSpec, agent: Agent, ctx: NodeContext): Promise<FeedItem[]> {
  const url = str(node.config.url);
  if (!url) throw new Error('http-json node needs config.url');
  const json = await httpGet(url, ctx, 'json');
  const picked = dotPath(json, str(node.config.path) ?? '');
  const records = Array.isArray(picked) ? picked : isObj(picked) ? [picked] : [];
  return recordsToItems(node, agent, records, {
    kind: feedKind(node.config.kind, 'news'),
    titleKey: node.config.titleKey,
    bodyKey: node.config.bodyKey,
    urlKey: node.config.urlKey,
    limit: clampLimit(node.config.limit),
  }, now(ctx));
}

async function runWeather(node: NodeSpec, agent: Agent, ctx: NodeContext): Promise<FeedItem[]> {
  const metric = node.config.metric === 'wind' ? 'wind' : 'weather';
  const m: Metrics = ctx.metricsFor
    ? await ctx.metricsFor(agent)
    : await getWeather(agent.place, { fetch: ctx.fetch, offline: ctx.offline, now: ctx.now });
  const place = agent.place?.name;
  const at = now(ctx);
  const data = numbersOf(m);
  if (metric === 'wind') {
    const gust = m.wind_gust_kmh ?? m.wind_kmh;
    const severity: Severity = gust !== undefined && gust >= 60 ? 'warning' : gust !== undefined && gust >= 40 ? 'watch' : 'info';
    return [makeItem(agent, {
      nodeId: node.id,
      kind: 'wind',
      title: `Wind gusts ${fmt(gust, ' km/h')}`,
      body: `Wind ${fmt(m.wind_kmh, ' km/h')}, gusts ${fmt(m.wind_gust_kmh, ' km/h')}${place ? ` at ${place}` : ''}.`,
      severity,
      at,
      place,
      data,
    })];
  }
  const t = m.temp_c;
  const hot = Math.max(t ?? -Infinity, m.heat_index_c ?? -Infinity);
  const rain = m.rain_mm_24h ?? 0;
  let severity: Severity = 'info';
  if (hot >= 41 || rain >= 64) severity = 'warning';
  else if (hot >= 38 || rain >= 35) severity = 'watch';
  return [makeItem(agent, {
    nodeId: node.id,
    kind: 'weather',
    title: `Weather: ${fmt(t, ' C')}, feels like ${fmt(m.feels_like_c, ' C')}`,
    body: `Humidity ${fmt(m.humidity_pct, '%')}. Heat index ${fmt(m.heat_index_c, ' C')}. Rain ${fmt(m.rain_mm_24h, ' mm')} in 24 hours. UV ${fmt(m.uv_index, '')}.`,
    severity,
    at,
    place,
    data,
  })];
}

async function runAqi(node: NodeSpec, agent: Agent, ctx: NodeContext): Promise<FeedItem[]> {
  const m: Metrics = ctx.metricsFor
    ? await ctx.metricsFor(agent)
    : await getAqi(agent.place, { fetch: ctx.fetch, offline: ctx.offline, now: ctx.now });
  const aqi = m.aqi;
  if (aqi === undefined || aqi < 101) return [];
  const label = aqi > 300 ? 'Hazardous' : aqi > 200 ? 'Very unhealthy' : aqi > 150 ? 'Unhealthy' : 'Unhealthy for sensitive groups';
  const severity: Severity = aqi > 300 ? 'severe' : aqi > 200 ? 'warning' : aqi > 150 ? 'watch' : 'info';
  return [makeItem(agent, {
    nodeId: node.id,
    kind: 'advisory',
    title: `Air quality index ${aqi}: ${label}`,
    body: `PM2.5 ${fmt(m.pm25, ' ug/m3')}${agent.place ? ` near ${agent.place.name}` : ''}. Keep children and older people indoors when the air is poor.`,
    severity,
    at: now(ctx),
    place: agent.place?.name,
    data: numbersOf(m),
  })];
}

async function runQuake(node: NodeSpec, agent: Agent, ctx: NodeContext): Promise<FeedItem[]> {
  const m: Metrics = ctx.metricsFor
    ? await ctx.metricsFor(agent)
    : await getQuakes(agent.place, { fetch: ctx.fetch, offline: ctx.offline, now: ctx.now });
  const mag = m.quake_max_mag;
  if (mag === undefined || mag < 4.5) return [];
  const severity: Severity = mag >= 6 ? 'severe' : mag >= 5 ? 'warning' : 'watch';
  return [makeItem(agent, {
    nodeId: node.id,
    kind: 'quake',
    title: `Magnitude ${mag} earthquake nearby`,
    body: `${m.quake_count ?? 0} quake(s) of magnitude 4.5 or more within 500 km of ${agent.place?.name ?? 'Delhi'} in the last few days. Nearest is ${fmt(m.quake_nearest_km, ' km')} away.`,
    severity,
    at: now(ctx),
    place: agent.place?.name,
    data: numbersOf(m),
  })];
}

/** Does the alert's area text mention a state other than the agent's? Alerts that mention no state are kept. */
function areaAllowed(areaText: string, state: string): boolean {
  const mentioned = INDIAN_STATES.filter((s) => new RegExp(`\\b${s}\\b`, 'i').test(areaText));
  if (mentioned.length === 0) return true;
  return mentioned.includes(state.toLowerCase());
}

async function runCap(node: NodeSpec, agent: Agent, ctx: NodeContext): Promise<FeedItem[]> {
  const url = str(node.config.url);
  if (!url) throw new Error('cap node needs config.url');
  const xml = await httpGet(url, ctx, 'text');
  let infos = parseCapAlert(String(xml));
  const state = agent.place?.state;
  if (node.config.filterByPlace === true && state) {
    infos = infos.filter((i) => areaAllowed(i.areas.map((a) => a.areaDesc).join('; '), state));
  }
  const at = now(ctx);
  return infos.slice(0, clampLimit(node.config.limit)).map((i) => ({
    ...capToFeedItem(i, agent, at),
    nodeId: node.id,
  }));
}

async function runMcp(node: NodeSpec, agent: Agent, ctx: NodeContext): Promise<FeedItem[]> {
  const server = str(node.config.server);
  const tool = str(node.config.tool);
  if (!server || !tool) throw new Error('mcp-tool node needs config.server and config.tool');
  if (!ctx.callMcp) throw new Error('MCP is not available in this run');
  const args = isObj(node.config.args) ? node.config.args : {};
  const res = await ctx.callMcp(server, tool, args);
  let records: unknown[];
  if (Array.isArray(res)) records = res;
  else if (isObj(res) && Array.isArray(res.items)) records = res.items;
  else if (typeof res === 'string') records = [{ title: trimWords(res, 10), body: res }];
  else if (isObj(res)) records = [res];
  else records = [];
  return recordsToItems(node, agent, records, {
    kind: feedKind(node.config.kind, 'custom'),
    limit: clampLimit(node.config.limit),
  }, now(ctx));
}

// ---------------------------------------------------------------------------
// transform nodes

function keywordFilter(node: NodeSpec, items: FeedItem[]): FeedItem[] {
  const words = (Array.isArray(node.config.words) ? node.config.words : [])
    .filter((w): w is string => typeof w === 'string' && w.trim() !== '')
    .map((w) => new RegExp(`\\b${w.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  if (words.length === 0) return items;
  const mode = node.config.mode === 'all' || node.config.mode === 'none' ? node.config.mode : 'any';
  return items.filter((it) => {
    const hay = `${it.title} ${it.body}`.toLowerCase();
    const hits = words.filter((re) => re.test(hay)).length;
    if (mode === 'all') return hits === words.length;
    if (mode === 'none') return hits === 0;
    return hits > 0;
  });
}

function compare(v: number, op: Op, value: number): boolean {
  switch (op) {
    case '>': return v > value;
    case '>=': return v >= value;
    case '<': return v < value;
    case '<=': return v <= value;
    case '==': return v === value;
    case '!=': return v !== value;
  }
}

function threshold(node: NodeSpec, items: FeedItem[]): FeedItem[] {
  const key = str(node.config.key);
  const op = node.config.op as Op;
  const value = Number(node.config.value);
  if (!key || !OPS.includes(op) || !Number.isFinite(value)) {
    throw new Error('threshold node needs config.key, a valid op and a numeric value');
  }
  return items.filter((it) => {
    const v = it.data?.[key];
    return typeof v === 'number' && compare(v, op, value);
  });
}

const normTitle = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function dedupe(items: FeedItem[]): FeedItem[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    const key = normTitle(it.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function summarize(items: FeedItem[], ctx: NodeContext): Promise<FeedItem[]> {
  const out: FeedItem[] = [];
  for (const it of items) {
    if (wordCount(it.body) <= BODY_WORDS) {
      out.push(it);
      continue;
    }
    let text: string | null = null;
    if (ctx.summarize) {
      try {
        text = await ctx.summarize(it.body);
      } catch {
        text = null;
      }
    }
    out.push({ ...it, body: trimWords(text?.trim() || it.body, BODY_WORDS) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// the runner

const SOURCES: Partial<Record<NodeKind, (node: NodeSpec, agent: Agent, ctx: NodeContext) => Promise<FeedItem[]>>> = {
  rss: runRss,
  'http-json': runHttpJson,
  weather: runWeather,
  aqi: runAqi,
  quake: runQuake,
  cap: runCap,
  'mcp-tool': runMcp,
};

/** Adds items whose id is not yet in the stream. */
function mergeItems(stream: FeedItem[], added: FeedItem[]): FeedItem[] {
  const ids = new Set(stream.map((i) => i.id));
  const out = stream.slice();
  for (const it of added) {
    if (ids.has(it.id)) continue;
    ids.add(it.id);
    out.push(it);
  }
  return out;
}

/**
 * Runs an agent's pipeline in order and returns the items for the gateway (newest first, at most MAX_ITEMS,
 * bodies at most BODY_WORDS words) and one result per node that ran. Disabled nodes are skipped. A node that
 * throws is recorded with `error` and the stream is left as it was.
 */
export async function runPipeline(
  agent: Agent,
  ctx: NodeContext,
): Promise<{ items: FeedItem[]; results: NodeRunResult[] }> {
  const specs = Array.isArray(agent.pipeline) ? agent.pipeline : [];
  let stream: FeedItem[] = [];
  const results: NodeRunResult[] = [];

  for (const node of specs) {
    if (node.enabled === false) continue;
    const started = Date.now();
    const before = stream.length;
    try {
      const source = SOURCES[node.kind];
      if (source) {
        stream = mergeItems(stream, await source(node, agent, ctx));
      } else if (node.kind === 'keyword-filter') {
        stream = keywordFilter(node, stream);
      } else if (node.kind === 'threshold') {
        stream = threshold(node, stream);
      } else if (node.kind === 'dedupe') {
        stream = dedupe(stream);
      } else if (node.kind === 'summarize') {
        stream = await summarize(stream, ctx);
      } else {
        throw new Error(`unknown node kind: ${String(node.kind)}`);
      }
      results.push({
        nodeId: node.id,
        ok: true,
        items: source ? stream.length - before : stream.length,
        ms: Date.now() - started,
      });
    } catch (e) {
      results.push({ nodeId: node.id, ok: false, items: 0, ms: Date.now() - started, error: message(e) });
    }
  }

  const items = stream
    .slice()
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_ITEMS)
    .map((it) => ({ ...it, body: trimWords(it.body, BODY_WORDS) }));
  return { items, results };
}

// ---------------------------------------------------------------------------
// starter pipelines

const RSS_NATIONAL = 'https://www.thehindu.com/news/national/feeder/default.rss';
const RSS_TOP = 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms';
const NDMA_SACHET = 'https://sachet.ndma.gov.in/cap_public_website/FetchXMLFile?';

/** Starter nodes for a genre. Health, supply, community and custom start empty. */
export function defaultPipeline(genre: Genre, place?: Place): NodeSpec[] {
  const node = (id: string, kind: NodeKind, label: string, config: Record<string, unknown>): NodeSpec => ({
    id, kind, label, config, enabled: true,
  });
  switch (genre) {
    case 'news':
      return [
        node('news-rss-national', 'rss', 'The Hindu, national news', { url: RSS_NATIONAL, limit: 8 }),
        node('news-rss-top', 'rss', 'Times of India, top stories', { url: RSS_TOP, limit: 8 }),
        node('news-disaster-words', 'keyword-filter', 'Disaster words only', {
          mode: 'any',
          words: ['flood', 'cyclone', 'earthquake', 'landslide', 'heatwave', 'heat wave', 'tsunami', 'storm', 'rain', 'evacuat', 'rescue', 'warning', 'alert'],
        }),
      ];
    case 'wind':
      return [node('wind-weather', 'weather', 'Wind now', { metric: 'wind' })];
    case 'quake':
      return [node('quake-usgs', 'quake', 'Nearby quakes', {})];
    case 'flood':
      return [
        node('flood-weather', 'weather', 'Rain and temperature now', { metric: 'weather' }),
        node('flood-rss', 'rss', 'The Hindu, national news', { url: RSS_NATIONAL, limit: 8 }),
        node('flood-words', 'keyword-filter', 'Flood words only', {
          mode: 'any',
          words: ['flood', 'waterlogging', 'river', 'dam', 'rain', 'cloudburst', 'evacuat'],
        }),
      ];
    case 'weather':
      return [
        node('weather-now', 'weather', 'Weather now', { metric: 'weather' }),
        node('weather-ndma', 'cap', 'NDMA SACHET alerts', { url: NDMA_SACHET, limit: 8, filterByPlace: !!place?.state }),
      ];
    default:
      return [];
  }
}
