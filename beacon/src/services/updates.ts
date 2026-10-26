// In-app update checker for APKs published as GitHub Releases.
// Pure helpers first (version compare, release pick, notes, sha parsing), then one fetch that never throws.

export const RELEASES_URL = 'https://api.github.com/repos/Vaibhav9526/beacon-inae/releases?per_page=10';
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const TIMEOUT_MS = 8000;

const GH_HEADERS: Record<string, string> = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};
/** Only download links from this repo are trusted. Hub releases live in the same repo but never match the tag rule. */
const DOWNLOAD_PREFIX = 'https://github.com/Vaibhav9526/beacon-inae/';
const TAG_RE = /^v\d+\.\d+\.\d+(-[\w.]+)?$/;
const APK_RE = /^beacon-.*\.apk$/;
const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const SHA_LINE_RE = /^\s*sha256:\s*([0-9a-f]{64})\s*$/im;
const HEX64_RE = /\b([0-9a-f]{64})\b/i;

export interface GithubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface GithubRelease {
  tag_name: string;
  body?: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at?: string | null;
  created_at?: string | null;
  assets: GithubAsset[];
}

export interface LatestRelease {
  version: string;
  url: string;
  notes: string;
  publishedAt: string | null;
  sizeBytes: number;
  sha256: string | null;
}

export type CheckResult =
  | { status: 'available'; latest: LatestRelease; checkedAt: number }
  | { status: 'current'; checkedAt: number }
  | { status: 'rate-limited'; checkedAt: number }
  | { status: 'offline' }
  | { status: 'error' }
  | { status: 'throttled' };

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}
export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<FetchResponseLike>;

// Read lazily so tests (plain node) never load expo-constants, which needs the native runtime.
declare const require: ((id: string) => any) | undefined;

/** The installed version from app.json, via expo-constants. Pass a value to override (tests). */
export function currentVersion(injected?: string): string {
  if (injected) return injected;
  try {
    const mod = typeof require === 'function' ? require('expo-constants') : null;
    const C = mod?.default ?? mod;
    const v = C?.expoConfig?.version;
    return typeof v === 'string' && v ? v : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

interface Parsed {
  core: [number, number, number];
  pre: string[] | null;
}

function parse(v: string): Parsed | null {
  const m = SEMVER_RE.exec(String(v).trim());
  if (!m) return null;
  const pre = m[4] ? m[4].split('.') : null;
  if (pre && pre.some((id) => id.length === 0)) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre };
}

/** Semver pre-release identifiers: numeric ids compare as numbers and rank below text ids. */
function comparePre(a: string[], b: string[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i >= a.length) return -1;
    if (i >= b.length) return 1;
    const x = a[i];
    const y = b[i];
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** -1, 0 or 1. A leading 'v' is ignored. Invalid input compares as equal (0), so it never looks like an update. */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  }
  if (!pa.pre && !pb.pre) return 0;
  if (!pa.pre) return 1; // 1.0.1 is newer than 1.0.1-beta
  if (!pb.pre) return -1;
  return comparePre(pa.pre, pb.pre);
}

/** True for versions with a pre-release tag such as 1.0.1-beta. */
export function isBetaVersion(v: string): boolean {
  return parse(v)?.pre != null;
}

/** Reads a 'sha256: <64 hex>' line from release notes. */
export function parseShaFromBody(body: string | null | undefined): string | null {
  const m = body ? SHA_LINE_RE.exec(body) : null;
  return m ? m[1].toLowerCase() : null;
}

/** Reads the first 64-hex digest from a .sha256 file (works with "hash  filename" lines). */
export function parseSha256(text: string): string | null {
  const m = HEX64_RE.exec(text ?? '');
  return m ? m[1].toLowerCase() : null;
}

/** Release notes as plain text: markdown symbols removed, the sha and min-android lines dropped, first `max` chars. */
export function plainNotes(body: string | null | undefined, max = 800): string {
  if (!body) return '';
  let t = body
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => !/^\s*(sha256|min-android)\s*:/i.test(l))
    .join('\n');
  t = t
    .replace(/```[\w-]*\n?/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/\*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

function isTrustedUrl(u: unknown): u is string {
  return typeof u === 'string' && u.startsWith(DOWNLOAD_PREFIX);
}

export interface PickedRelease extends LatestRelease {
  /** where to read the digest from when the notes do not carry one */
  shaUrl: string | null;
}

/**
 * The newest installable release newer than `current`, or null.
 * Drafts, non-beacon tags (hub-v*), pre-releases (unless includeBeta), releases without an APK are skipped.
 */
export function pickRelease(releases: readonly GithubRelease[], current: string, opts: { includeBeta?: boolean } = {}): PickedRelease | null {
  let best: PickedRelease | null = null;
  for (const r of releases ?? []) {
    if (!r || typeof r !== 'object' || r.draft) continue;
    const tag = typeof r.tag_name === 'string' ? r.tag_name : '';
    if (!TAG_RE.test(tag)) continue;
    const version = tag.slice(1);
    if ((r.prerelease === true || isBetaVersion(version)) && !opts.includeBeta) continue;
    if (compareVersions(version, current) <= 0) continue;
    if (best && compareVersions(version, best.version) <= 0) continue;
    const assets = Array.isArray(r.assets) ? r.assets : [];
    const apk = assets.find((a) => a && APK_RE.test(a.name));
    if (!apk || !isTrustedUrl(apk.browser_download_url)) continue;
    const shaAsset = assets.find((a) => a && a.name === `${apk.name}.sha256`);
    best = {
      version,
      url: apk.browser_download_url,
      notes: plainNotes(r.body),
      publishedAt: r.published_at ?? r.created_at ?? null,
      sizeBytes: typeof apk.size === 'number' ? apk.size : 0,
      sha256: parseShaFromBody(r.body),
      shaUrl: shaAsset && isTrustedUrl(shaAsset.browser_download_url) ? shaAsset.browser_download_url : null,
    };
  }
  return best;
}

export interface CheckOptions {
  fetchFn?: FetchLike;
  now?: number;
  force?: boolean;
  /** installed version; defaults to currentVersion() */
  current?: string;
  includeBeta?: boolean;
  /** last successful (or rate-limited) check, ms since epoch */
  lastCheckedAt?: number | null;
  timeoutMs?: number;
}

function defaultFetch(): FetchLike {
  const f = (globalThis as { fetch?: unknown }).fetch;
  if (typeof f === 'function') return f as FetchLike;
  return async () => {
    throw new Error('no fetch');
  };
}

async function fetchSha(fetchFn: FetchLike, url: string, timeoutMs: number): Promise<string | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: ctl.signal });
    return res.ok ? parseSha256(await res.text()) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Asks GitHub for the newest beacon release. Never throws.
 * Unless forced, it does nothing when the last check was less than 6 hours ago.
 * Offline and timeouts do not stamp the check time, so the next foreground tries again.
 */
export async function checkForUpdate(opts: CheckOptions = {}): Promise<CheckResult> {
  const now = opts.now ?? Date.now();
  const last = opts.lastCheckedAt;
  if (!opts.force && last != null && now >= last && now - last < CHECK_INTERVAL_MS) return { status: 'throttled' };

  const fetchFn = opts.fetchFn ?? defaultFetch();
  const current = currentVersion(opts.current);
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchFn(RELEASES_URL, { headers: GH_HEADERS, signal: ctl.signal });
    // GitHub answers 403 or 429 when the hourly limit for this network is used up.
    if (res.status === 403 || res.status === 429) return { status: 'rate-limited', checkedAt: now };
    if (!res.ok) return { status: 'error' };
    let list: unknown;
    try {
      list = await res.json();
    } catch {
      return { status: 'error' };
    }
    if (!Array.isArray(list)) return { status: 'error' };
    const picked = pickRelease(list as GithubRelease[], current, { includeBeta: opts.includeBeta });
    if (!picked) return { status: 'current', checkedAt: now };
    if (!picked.sha256 && picked.shaUrl) picked.sha256 = await fetchSha(fetchFn, picked.shaUrl, timeoutMs);
    const { shaUrl: _unused, ...latest } = picked;
    return { status: 'available', latest, checkedAt: now };
  } catch {
    return { status: 'offline' };
  } finally {
    clearTimeout(timer);
    if (!ctl.signal.aborted) ctl.abort();
  }
}
