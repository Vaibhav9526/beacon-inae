import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** Where the database, uploaded media and the server signing key live. Set BEACON_DATA to a mounted volume in production. */
export function resolveDataDir(env: NodeJS.ProcessEnv, cwd: string): string {
  const set = env.BEACON_DATA?.trim();
  return set ? set : join(cwd, 'data');
}

/** Startup warnings for settings that would quietly lose data or leave moderators locked out. Empty when all is fine. */
export function startupWarnings(env: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  const data = env.BEACON_DATA?.trim() ?? '';
  if (env.RAILWAY_ENVIRONMENT && (!data || !isAbsolute(data))) {
    out.push('Data will be lost on redeploy: attach a Volume and set BEACON_DATA=/data');
  }
  if (!env.MOD_TOKEN) out.push('MOD_TOKEN not set: moderator endpoints are disabled');
  return out;
}

/** The package version, or 'unknown' if package.json cannot be read. */
export function readVersion(packageJsonUrl: URL): string {
  try {
    const v = (JSON.parse(readFileSync(packageJsonUrl, 'utf8')) as { version?: unknown }).version;
    return typeof v === 'string' ? v : 'unknown';
  } catch {
    return 'unknown';
  }
}
