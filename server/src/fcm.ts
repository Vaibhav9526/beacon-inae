import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/**
 * Reads a Firebase service-account key from the environment.
 * FIREBASE_SERVICE_ACCOUNT_JSON holds the JSON itself or its base64 (for hosts with no files, such as Railway).
 * FIREBASE_SERVICE_ACCOUNT is a file path. Returns null when neither is set. Errors never include the key.
 */
export function loadServiceAccount(env: NodeJS.ProcessEnv): ServiceAccount | null {
  const inline = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) return parseServiceAccount(inline, 'FIREBASE_SERVICE_ACCOUNT_JSON');
  const file = env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (file) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT: cannot read the file at ${file}`);
    }
    return parseServiceAccount(text, 'FIREBASE_SERVICE_ACCOUNT');
  }
  return null;
}

/** Accepts service-account JSON text or base64 of it. Throws a readable error for anything else. */
export function parseServiceAccount(raw: string, source = 'FIREBASE_SERVICE_ACCOUNT_JSON'): ServiceAccount {
  const text = raw.trim();
  const candidates = [text];
  if (!text.startsWith('{')) {
    const decoded = Buffer.from(text, 'base64').toString('utf8').trim();
    if (decoded.startsWith('{')) candidates.unshift(decoded);
  }
  for (const c of candidates) {
    let j: unknown;
    try {
      j = JSON.parse(c);
    } catch {
      continue;
    }
    if (j && typeof j === 'object') {
      const o = j as Record<string, unknown>;
      if (typeof o.project_id === 'string' && typeof o.client_email === 'string' && typeof o.private_key === 'string' && o.private_key.includes('PRIVATE KEY')) {
        return { project_id: o.project_id, client_email: o.client_email, private_key: o.private_key };
      }
      throw new Error(`${source} is JSON but not a Firebase service-account key (needs project_id, client_email and private_key)`);
    }
  }
  throw new Error(`${source} must be the service-account JSON, or its base64, but it is neither (${text.length} characters)`);
}

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface Pusher {
  send(m: PushMessage): Promise<boolean>;
}

/** Logs instead of sending. Used when no Firebase credentials are configured. */
export class DryRunPusher implements Pusher {
  sent: PushMessage[] = [];
  async send(m: PushMessage) {
    this.sent.push(m);
    console.log(`[push dry-run] ${m.title}: ${m.body.slice(0, 80)}`);
    return true;
  }
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** Firebase Cloud Messaging HTTP v1, authenticated with a service-account key (free tier). */
export class FcmPusher implements Pusher {
  private sa: ServiceAccount;
  private token: { value: string; exp: number } | null = null;

  constructor(serviceAccount: ServiceAccount) {
    this.sa = serviceAccount;
  }

  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && this.token.exp - 60 > now) return this.token.value;
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = b64url(
      JSON.stringify({
        iss: this.sa.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      }),
    );
    const sig = createSign('RSA-SHA256').update(`${header}.${claim}`).sign(this.sa.private_key);
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claim}.${b64url(sig)}` }),
    });
    if (!res.ok) throw new Error(`FCM auth failed: ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, exp: now + j.expires_in };
    return j.access_token;
  }

  async send(m: PushMessage) {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${this.sa.project_id}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: m.token,
            notification: { title: m.title, body: m.body },
            data: m.data ?? {},
            android: { priority: 'HIGH', notification: { channel_id: 'alerts', sound: 'default' } },
          },
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
