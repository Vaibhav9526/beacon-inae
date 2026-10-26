// Pure ElevenLabs helpers with no React Native imports, so they can be unit-tested under tsx.

export type VoiceRole = 'didi' | 'asha' | 'veer' | 'default';
export interface Voice {
  id: string;
  name: string;
  gender?: string;
}
export type Voices = Partial<Record<VoiceRole, Voice>>;

/** Trims a pasted key: surrounding spaces, newlines and quotes, and any whitespace inside it. */
export function cleanKey(raw: string): string {
  return raw
    .replace(/^[\s"'“”‘’`]+|[\s"'“”‘’`]+$/g, '')
    .replace(/[\s​-‍﻿]+/g, '');
}

export type FailureKind = 'invalid_key' | 'permission' | 'other';

export class ElevenError extends Error {
  readonly status: number;
  readonly kind: FailureKind;
  /** Readable cause, e.g. "missing permission: voices_read", or the API's own message. */
  readonly reason: string;
  readonly permission?: string;

  constructor(message: string, status: number, kind: FailureKind, reason: string, permission?: string) {
    super(message);
    this.name = 'ElevenError';
    this.status = status;
    this.kind = kind;
    this.reason = reason;
    this.permission = permission;
  }
}

const str = (x: unknown): string => (typeof x === 'string' ? x : '');

/**
 * Reads the error body in the shapes ElevenLabs uses: {"detail":{"status","message"}}, {"detail":"text"},
 * {"detail":[{"msg"}]} (validation) or a bare {"message"}. Anything else gives empty strings.
 */
function readDetail(text: string): { code: string; message: string } {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return { code: '', message: '' };
  }
  if (!j || typeof j !== 'object') return { code: '', message: '' };
  const body = j as Record<string, unknown>;
  const d = body.detail;
  if (typeof d === 'string') return { code: '', message: d };
  if (Array.isArray(d)) {
    const msgs = d.map((x) => (x && typeof x === 'object' ? str((x as Record<string, unknown>).msg) : '')).filter(Boolean);
    return { code: '', message: msgs.join('; ') };
  }
  if (d && typeof d === 'object') {
    const o = d as Record<string, unknown>;
    return { code: str(o.status), message: str(o.message) };
  }
  return { code: '', message: str(body.message) };
}

/** Turns a failed response into an ElevenError with a readable reason. Keeps the HTTP status. */
export function errorFromResponse(status: number, text: string): ElevenError {
  const { code, message } = readDetail(text);
  const perm = /permission\s+([a-z0-9_]+)/i.exec(message)?.[1];
  const missing = code === 'missing_permissions' || /missing.*permission/i.test(message);
  let kind: FailureKind = 'other';
  if (missing || status === 403) kind = 'permission';
  else if (status === 401 && /invalid|unknown/i.test(`${code} ${message}`)) kind = 'invalid_key';

  const reason = missing && perm ? `missing permission: ${perm}` : message || code;
  let msg: string;
  if (kind === 'invalid_key') msg = `ElevenLabs rejected the key (HTTP ${status})`;
  else if (reason) msg = `ElevenLabs says: ${reason} (HTTP ${status})`;
  else msg = `ElevenLabs error (HTTP ${status})`;
  return new ElevenError(msg, status, kind, reason, missing ? perm : undefined);
}

/** True when the key is real but cannot do this one call (missing permission, or 403). Speech may still work. */
export function lacksPermissionOnly(e: unknown): boolean {
  return e instanceof ElevenError && e.kind === 'permission' && (e.status === 401 || e.status === 403);
}

/** Built-in premade voices, used when the key cannot list voices (no voices_read). */
export const FALLBACK_VOICES: Required<Voices> = {
  didi: { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', gender: 'female' },
  asha: { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', gender: 'female' },
  veer: { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', gender: 'male' },
  default: { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', gender: 'female' },
};

/** Give each character a fitting voice: two different women for Didi and Dr. Asha, a man for Captain Veer. */
export function pickVoices(list: Voice[]): Voices {
  const women = list.filter((v) => v.gender === 'female');
  const men = list.filter((v) => v.gender === 'male');
  const any = list[0];
  return {
    didi: women[0] ?? any,
    asha: women[1] ?? women[0] ?? any,
    veer: men[0] ?? any,
    default: women[0] ?? any,
  };
}
