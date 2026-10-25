import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { toBase64, toHex, utf8 } from '../mesh/bytes';
import { useSettings } from '../state/settings';
import { getIdentity } from './identity';

export class CloudError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const cloudConfigured = () => !!useSettings.getState().serverUrl;
const base = () => useSettings.getState().serverUrl.replace(/\/+$/, '');

async function http<T>(method: 'GET' | 'POST', path: string, body?: unknown, sign = false, timeoutMs = 12_000): Promise<T> {
  const url = base();
  if (!url) throw new CloudError(0, 'no server configured');
  const raw = body === undefined ? '' : JSON.stringify(body);
  const headers: Record<string, string> = {};
  if (raw) headers['content-type'] = 'application/json';
  if (sign) {
    const id = await getIdentity();
    const ts = String(Date.now());
    const pathOnly = path.split('?')[0];
    const msg = utf8(`${ts}.${method}.${pathOnly}.${toHex(sha256(utf8(raw)))}`);
    headers['x-device'] = toBase64(id.signing.publicKey);
    headers['x-ts'] = ts;
    headers['x-sig'] = toBase64(ed25519.sign(msg, id.signing.secretKey));
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url + path, { method, headers, body: raw || undefined, signal: ctl.signal });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok) throw new CloudError(res.status, (json as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
    return json as T;
  } finally {
    clearTimeout(timer);
  }
}

export const cloud = {
  get: <T,>(path: string) => http<T>('GET', path),
  getSigned: <T,>(path: string) => http<T>('GET', path, undefined, true),
  post: <T,>(path: string, body: unknown) => http<T>('POST', path, body, true, 60_000),
  mediaUrl: (p: string) => (p.startsWith('http') ? p : base() + p),
};

// ---------- typed endpoints ----------

export interface SignedAlert {
  alert: import('../mesh/node').AlertBody;
  sig: string;
}

export interface NewsCard {
  id: string;
  kind: 'alert' | 'report';
  title: string;
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

export interface ReportView {
  id: string;
  kind: 'photo' | 'video';
  mediaUrl: string;
  thumbUrl?: string;
  caption: string;
  summary: string;
  category: string;
  lat: number;
  lon: number;
  capturedAt: number;
  delayed: boolean;
  realVotes: number;
  fakeVotes: number;
  badge: 'community-verified' | 'disputed' | 'new';
}
