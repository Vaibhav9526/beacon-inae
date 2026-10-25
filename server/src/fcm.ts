import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

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
  private sa: { project_id: string; client_email: string; private_key: string };
  private token: { value: string; exp: number } | null = null;

  constructor(serviceAccountPath: string) {
    this.sa = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
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
