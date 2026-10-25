// Family breadcrumbs: small encrypted "last seen here" notes that ride the mesh. Pure TypeScript, no react-native imports.
//
// A note is a Breadcrumb as compact JSON, padded to a fixed size, sealed with ChaCha20-Poly1305 under the 32-byte family key.
// The mesh only sees (tag, blob). The tag is a daily HMAC of the key, so family phones can spot their own notes
// cheaply and an outsider cannot link notes across days.
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import type { Breadcrumb, OpaqueNote } from '../mesh/appTypes';
import { concat, fromBase64, toBase64, toHex, utf8 } from '../mesh/bytes';

export const CRUMB_AAD = utf8('beacon-crumb-v1');
/** Plaintext is always this long (2-byte length + JSON + zero padding), so a note's size reveals nothing. */
export const CRUMB_PLAIN_BYTES = 192;
const NONCE = 12;
const DAY_MS = 86_400_000;
const FUTURE_SLACK_MS = 5 * 60_000;
const MAX_WHO = 24;
const MAX_NOTE = 80;

export const KEY_BYTES = 32;
export const KEY_PREFIX = 'BCNKEY1:';

export const dayNumber = (now: number) => Math.floor(now / DAY_MS);

/** 8 bytes of HMAC-SHA256(key, 'bcn-crumb-day:' + day) as 16 hex chars. */
export function dayTag(key: Uint8Array, day: number): string {
  return toHex(hmac(sha256, key, utf8(`bcn-crumb-day:${day}`)).slice(0, 8));
}

/** Tags a family phone should accept at `now`: today and `back` earlier days (default 1, for clock skew). */
export function acceptedTags(key: Uint8Array, now: number, back = 1): Set<string> {
  const d = dayNumber(now);
  const out = new Set<string>();
  for (let i = 0; i <= back; i++) out.add(dayTag(key, d - i));
  return out;
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

function pack(c: Breadcrumb): Uint8Array {
  const base: Record<string, unknown> = {
    w: c.who.slice(0, MAX_WHO),
    a: round(c.lat, 5),
    o: round(c.lon, 5),
    t: Math.round(c.at),
  };
  if (c.acc != null && Number.isFinite(c.acc)) base.c = Math.round(c.acc);
  if (c.batt != null && Number.isFinite(c.batt)) base.b = Math.max(0, Math.min(100, Math.round(c.batt)));
  let note = (c.note ?? '').slice(0, MAX_NOTE);
  for (;;) {
    const json = utf8(JSON.stringify(note ? { ...base, n: note } : base));
    if (json.length <= CRUMB_PLAIN_BYTES - 2) {
      const out = new Uint8Array(CRUMB_PLAIN_BYTES);
      out[0] = json.length >> 8;
      out[1] = json.length & 255;
      out.set(json, 2);
      return out;
    }
    if (note) note = note.slice(0, Math.max(0, note.length - 8));
    else if (base.w && (base.w as string).length > 4) base.w = (base.w as string).slice(0, (base.w as string).length - 2);
    else throw new Error('crumb too large');
  }
}

/** Seal a breadcrumb: blob = nonce(12) || ciphertext(192) || tag(16) = 220 bytes, always. */
export function sealCrumb(c: Breadcrumb, key: Uint8Array, now: number): { tag: string; blobB64: string } {
  const nonce = randomBytes(NONCE);
  const ct = chacha20poly1305(key, nonce, CRUMB_AAD).encrypt(pack(c));
  return { tag: dayTag(key, dayNumber(now)), blobB64: toBase64(concat(nonce, ct)) };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Open a note. Null on wrong key, tamper, bad JSON, impossible values or a timestamp from the future. */
export function openCrumb(note: OpaqueNote, key: Uint8Array, now = Date.now()): Breadcrumb | null {
  try {
    const raw = fromBase64(note.blob);
    if (raw.length !== NONCE + CRUMB_PLAIN_BYTES + 16) return null;
    const plain = chacha20poly1305(key, raw.slice(0, NONCE), CRUMB_AAD).decrypt(raw.slice(NONCE));
    const len = (plain[0] << 8) | plain[1];
    if (len < 2 || len > plain.length - 2) return null;
    const j = JSON.parse(new TextDecoder().decode(plain.slice(2, 2 + len))) as Record<string, unknown>;
    if (typeof j.w !== 'string' || !isNum(j.a) || !isNum(j.o) || !isNum(j.t)) return null;
    if (j.a < -90 || j.a > 90 || j.o < -180 || j.o > 180) return null;
    if (j.t <= 0 || j.t > now + FUTURE_SLACK_MS) return null;
    const out: Breadcrumb = { who: j.w.slice(0, MAX_WHO), lat: j.a, lon: j.o, at: j.t };
    if (j.c != null) {
      if (!isNum(j.c) || j.c < 0) return null;
      out.acc = j.c;
    }
    if (j.b != null) {
      if (!isNum(j.b) || j.b < 0 || j.b > 100) return null;
      out.batt = j.b;
    }
    if (j.n != null) {
      if (typeof j.n !== 'string') return null;
      out.note = j.n.slice(0, MAX_NOTE);
    }
    return out;
  } catch {
    return null;
  }
}

/** Newest crumb per person (by `who`). */
export function latestPerPerson(crumbs: Breadcrumb[]): Breadcrumb[] {
  const best = new Map<string, Breadcrumb>();
  for (const c of crumbs) {
    const cur = best.get(c.who);
    if (!cur || c.at > cur.at) best.set(c.who, c);
  }
  return [...best.values()];
}

export function agoText(ageMs: number): string {
  const m = Math.max(0, Math.round(ageMs / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `about ${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `about ${h} h ago`;
  return `about ${Math.round(h / 24)} days ago`;
}

export function describe(c: Breadcrumb, now: number): { when: string; where: string } {
  return { when: agoText(now - c.at), where: `${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}` };
}

export function encodeKey(key: Uint8Array): string {
  return KEY_PREFIX + toBase64(key);
}

/** Accepts 'BCNKEY1:<base64>' or bare base64. Returns 32 bytes, or null. */
export function decodeKey(text: string): Uint8Array | null {
  const t = text.trim();
  const b64 = t.startsWith(KEY_PREFIX) ? t.slice(KEY_PREFIX.length) : t;
  if (!/^[A-Za-z0-9+/]{43}=?$/.test(b64)) return null;
  const k = fromBase64(b64);
  return k.length === KEY_BYTES ? k : null;
}
