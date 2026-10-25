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
