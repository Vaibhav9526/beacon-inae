// Shared contract for Beacon Hub. Every module in engine/ builds against these types.

export type Severity = 'info' | 'watch' | 'warning' | 'severe';
export const SEVERITY_RANK: Record<Severity, number> = { info: 0, watch: 1, warning: 2, severe: 3 };

export type Channel = 'telegram' | 'beacon';

/** What an agent watches. Each maps to one data source module. */
export type SourceKind = 'weather' | 'aqi' | 'quake' | 'alerts' | 'health' | 'schedule' | 'supply';

export interface Place {
  name: string;
  lat: number;
  lon: number;
  /** Indian state (lower case, e.g. "kerala"), used to filter NDMA/IMD alerts. Optional. */
  state?: string;
}

/**
 * Flat readings an agent's rules look at. Names are fixed so rules, templates and sources agree:
 *
 * weather:  temp_c, feels_like_c, humidity_pct, heat_index_c, wind_kmh, wind_gust_kmh, rain_mm_24h, rain_mm_now, uv_index
 * aqi:      aqi, pm25
 * quake:    quake_max_mag (largest M in the last day within radius), quake_nearest_km (distance of the nearest M4.5+ quake), quake_count
 * alerts:   official_alert_count, official_alert_max (0 info,1 watch,2 warning,3 severe)
 * health:   hr:<Member>, spo2:<Member>, steps:<Member>, sleep_h:<Member>, health_status:<Member> (0 ok, 1 attention, 2 urgent)
 * supply:   water_days, food_days, medicine_days
 * schedule: minutes_to_dose:<Medicine name>
 */
export type Metrics = Record<string, number>;

export type Op = '>' | '>=' | '<' | '<=' | '==' | '!=';

export interface Condition {
  metric: string;
  op: Op;
  value: number;
}

export interface RuleSet {
  mode: 'all' | 'any';
  conditions: Condition[];
}

export interface Rule {
  id: string;
  name: string;
  when: RuleSet;
  severity: Severity;
  /** Message template. `{metric_name}` is replaced with the reading, e.g. "Heatwave at {temp_c} C". */
  message: string;
  /** Do not raise the same rule again for this many minutes (default 360). */
  cooldownMin?: number;
}

export interface Agent {
  id: string;
  name: string;
  /** Which pixel avatar the app shows: a key of the avatar cast (sentinel, medic, rescue, guardian, scout, ...). */
  avatar: string;
  /** The persona it was enrolled with in the School (firefighter, doctor, ...). Sets its voice and default look. */
  personaId?: string;
  /** Saved custom look, drawn by the UI; absent means the persona's default. */
  look?: Look;
  /** What the agent is about (news, wind, flood, ...). */
  genre?: Genre;
  /** The path its data takes: source nodes first, then filters. Empty or absent = the built-in rules only. */
  pipeline?: NodeSpec[];
  templateId?: string;
  enabled: boolean;
  watch: SourceKind[];
  place?: Place;
  /** Family members this agent looks after (names as used in health readings). */
  members?: string[];
  everyMin: number;
  rules: Rule[];
  channels: Channel[];
  /** Free-form notes the user wrote ("Maa takes BP tablets at 8am"). */
  notes?: string;
  createdAt: number;
}

export interface Template {
  id: string;
  name: string;
  /** Short one-line description shown on the gallery card. */
  summary: string;
  group: 'disaster' | 'help' | 'medicine' | 'child' | 'prepare';
  avatar: string;
  /** A ready agent, minus the id/createdAt that are set when the user adds it. */
  agent: Omit<Agent, 'id' | 'createdAt'>;
  /** Vault details. Optional in the type, but every built-in template fills them in (see vault.test.ts). */
  /** Two plain sentences: what it does and why it matters for a family. */
  about?: string;
  /** Human labels for what it watches, e.g. 'Heat index', "Maa's heart rate". */
  watches?: string[];
  /** Where the data comes from, e.g. 'Open-Meteo', 'USGS', 'NDMA SACHET'. */
  sources?: string[];
  /** A sample alert text. Calm, no emojis. */
  example?: string;
  /** Who it helps, e.g. 'Elders, anyone outdoors'. */
  who?: string;
  /** starter works out of the box, guardian needs a little tuning, expert needs health data or a second channel. */
  level?: 'starter' | 'guardian' | 'expert';
  /** Setup the agent relies on beyond the defaults. */
  needs?: ('health' | 'telegram' | 'phone')[];
}

export interface Signal {
  agentId: string;
  agentName: string;
  ruleId: string;
  severity: Severity;
  title: string;
  body: string;
  /** The metrics that mattered (for logs and combining), never raw health history. */
  metrics: Metrics;
  /** Stable key for de-duplication, e.g. "heat:delhi". */
  fingerprint: string;
  tags: string[];
  at: number;
}

export type AlertStatus = 'pending-approval' | 'sent' | 'suppressed' | 'failed';

export interface Alert {
  id: string;
  severity: Severity;
  title: string;
  body: string;
  channels: Channel[];
  signals: Signal[];
  at: number;
  status: AlertStatus;
  note?: string;
}

export interface HealthReading {
  member: string;
  /** ms since epoch */
  at: number;
  hr?: number;
  spo2?: number;
  steps?: number;
  sleepHours?: number;
}

export interface RunLogEntry {
  at: number;
  agentId: string;
  ok: boolean;
  message: string;
  metrics?: Metrics;
  signals?: number;
}

/** What data sources need: a fetch function (so tests can inject a fake) and an offline switch for built-in sample data. */
export interface SourceOptions {
  offline?: boolean;
  fetch?: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown>; text(): Promise<string> }>;
  now?: () => number;
}

/** How a pixel person is drawn: hair style, skin tone, clothes colour. Indexes are small ints the avatar code wraps. */
export interface Look {
  hair: number;
  skin: number;
  color: string;
}

/**
 * A persona is a role you enrol an agent as in the Beacon School: it brings a voice (how alerts are worded), a default
 * look, what it is good at and the templates that suit it. It never changes the facts of an alert, only the wording.
 */
export interface Persona {
  id: string;
  /** Default first name for a new agent of this persona. */
  name: string;
  /** e.g. 'Firefighter' */
  role: string;
  tagline: string;
  /** Plain description shown in the School, two sentences. */
  about: string;
  tint: 'pink' | 'yellow' | 'blue' | 'green' | 'lilac' | 'peach';
  avatar: string;
  look: Look;
  /** Short skills list, shown as chips. */
  skills: string[];
  /** One instruction line for the wording model: how this person speaks. */
  voice: string;
  /** Appended to a message when no model rewrites it, e.g. 'Captain Flint, fire safety'. */
  signature: string;
  /** Templates that suit this persona (ids from templates.ts). The first one is the default when none is chosen. */
  templates: string[];
  /** Phone voice role for read-aloud (didi, asha, veer, default). */
  speaks: 'didi' | 'asha' | 'veer' | 'default';
}

// ---------------------------------------------------------------------------
// Hub v2: nodes -> agents -> gateway -> phones. See docs/hub-v2-plan.md.
// ---------------------------------------------------------------------------

export type FeedKind = 'news' | 'weather' | 'wind' | 'quake' | 'flood' | 'alert' | 'health' | 'supply' | 'advisory' | 'chat' | 'custom';

/** One thing an agent found, ready to show on a phone: a headline, a few words, how serious it is. */
export interface FeedItem {
  id: string;
  agentId: string;
  agentName: string;
  /** the node that produced it, when known */
  nodeId?: string;
  kind: FeedKind;
  title: string;
  /** about 60 words at most */
  body: string;
  severity: Severity;
  at: number;
  url?: string;
  tags: string[];
  place?: string;
  /** small numbers worth showing, e.g. {wind_kmh: 62} */
  data?: Record<string, number | string>;
}

export type NodeKind = 'rss' | 'http-json' | 'weather' | 'aqi' | 'quake' | 'cap' | 'mcp-tool' | 'keyword-filter' | 'threshold' | 'summarize' | 'dedupe';

/**
 * One step of an agent's path. Source nodes (rss, http-json, weather, aqi, quake, cap, mcp-tool) produce items;
 * the others change the stream that flows through them. An agent's `pipeline` runs top to bottom.
 */
export interface NodeSpec {
  id: string;
  kind: NodeKind;
  label: string;
  /** kind-specific settings, e.g. {url, limit} for rss, {server, tool, args} for mcp-tool, {words:[...], mode:'any'} for keyword-filter */
  config: Record<string, unknown>;
  enabled?: boolean;
}

/** What an agent is about. Used for grouping in the UI and for default nodes. */
export type Genre = 'news' | 'weather' | 'wind' | 'quake' | 'flood' | 'health' | 'supply' | 'community' | 'custom';

export interface NodeRunResult {
  nodeId: string;
  ok: boolean;
  items: number;
  ms: number;
  error?: string;
}

/** A rule that decides which items go where. First matching route wins unless `continue` is set. */
export interface GatewayRoute {
  id: string;
  name: string;
  enabled: boolean;
  match: {
    kinds?: FeedKind[];
    agents?: string[];
    tags?: string[];
    minSeverity?: Severity;
  };
  /** who receives it: every phone, only phones of members with these roles, or named members */
  to: { phones: 'all' | 'none'; roles?: MemberRole[]; members?: string[]; telegram?: boolean };
  /** also push a notification on the phone when the item is at least this serious (default 'warning') */
  notifyFrom?: Severity;
  continue?: boolean;
}

export type MemberRole = 'adult' | 'elder' | 'child';

export interface Member {
  id: string;
  name: string;
  role: MemberRole;
  /** the phone's device id once it paired with this member's invite */
  deviceId?: string;
  telegramChatId?: number;
  /** the name used in health readings (hr:<healthName>) */
  healthName?: string;
  look?: Look;
  /** adults can add and remove members; the first member is always an adult */
  addedBy?: string;
  joinedAt?: number;
}

export interface GroupMessage {
  id: string;
  /** a member id, or 'hub' for system and agent messages */
  from: string;
  fromName: string;
  text: string;
  at: number;
  kind: 'text' | 'sos' | 'safe' | 'alert' | 'agent';
}

export interface McpServerSpec {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

export interface McpToolInfo {
  server: string;
  name: string;
  description: string;
  inputSchema?: unknown;
}

/** What travels between hub and phones (inside an encrypted blob, see engine/wire.ts). */
export type WireMessage =
  | { t: 'feed'; items: FeedItem[] }
  | { t: 'members'; members: Array<Pick<Member, 'id' | 'name' | 'role' | 'look'>>; you?: string }
  | { t: 'chat'; msg: GroupMessage }
  | { t: 'ask'; id: string; text: string }
  | { t: 'answer'; id: string; text: string; ok: boolean }
  | { t: 'hello'; name: string; role?: MemberRole; invite?: string }
  | { t: 'safe'; name: string; note?: string }
  | { t: 'sos'; name: string; lat?: number; lon?: number; note?: string };
