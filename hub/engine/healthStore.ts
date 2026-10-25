// Encrypted local store for family health readings.
// File layout: 12-byte iv | 16-byte GCM tag | ciphertext (AES-256-GCM over UTF-8 JSON).

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { HealthReading } from './types.ts';

const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const MAX_PER_MEMBER = 5000;
/** Readings older than this (relative to `now`) are ignored by latest(). */
export const STALE_MS = 48 * 60 * 60 * 1000;

const DECRYPT_ERROR = 'Health data could not be decrypted';
const READING_FIELDS = ['hr', 'spo2', 'steps', 'sleepHours'] as const;

/** A fresh random 32-byte AES-256 key. Store it safely; without it the data is unreadable. */
export function newKey(): Buffer {
  return randomBytes(KEY_LEN);
}

function dirOf(file: string): string {
  const idx = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  return idx > 0 ? file.slice(0, idx) : '.';
}

export class HealthStore {
  private readonly file: string;
  private readonly key: Buffer;
  private readonly data = new Map<string, HealthReading[]>();

  constructor(file: string, key: Buffer) {
    if (!Buffer.isBuffer(key) || key.length !== KEY_LEN) {
      throw new Error('Health store key must be 32 bytes');
    }
    this.file = file;
    this.key = key;
  }

  /** Adds one reading. Readings per member are kept sorted by time, capped at 5000 (oldest dropped). */
  add(r: HealthReading): void {
    if (!r.member || typeof r.member !== 'string') throw new TypeError('Reading needs a member name');
    if (!Number.isFinite(r.at)) throw new TypeError('Reading needs a numeric time (ms)');
    const list = this.data.get(r.member) ?? [];
    list.push({ ...r });
    list.sort((a, b) => a.at - b.at);
    if (list.length > MAX_PER_MEMBER) list.splice(0, list.length - MAX_PER_MEMBER);
    this.data.set(r.member, list);
  }

  addMany(rs: HealthReading[]): void {
    for (const r of rs) this.add(r);
  }

  /**
   * Newest value of each field for a member, merged across readings.
   * Readings older than 48h (relative to `now`) are ignored entirely.
   * Returns undefined when nothing fresh exists.
   */
  latest(member: string, now: number = Date.now()): HealthReading | undefined {
    const list = this.data.get(member);
    if (!list || list.length === 0) return undefined;
    const cutoff = now - STALE_MS;
    const merged: HealthReading = { member, at: Number.NEGATIVE_INFINITY };
    let found = false;
    // Newest first.
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (r.at < cutoff) break; // list is sorted ascending, so everything earlier is older still
      found = true;
      if (r.at > merged.at) merged.at = r.at;
      for (const f of READING_FIELDS) {
        if (merged[f] === undefined && r[f] !== undefined) merged[f] = r[f];
      }
    }
    return found ? merged : undefined;
  }

  members(): string[] {
    return [...this.data.keys()];
  }

  /** Readings for a member at or after `sinceMs`, oldest first. */
  history(member: string, sinceMs: number): HealthReading[] {
    const list = this.data.get(member) ?? [];
    return list.filter((r) => r.at >= sinceMs).map((r) => ({ ...r }));
  }

  /** Encrypts and writes the whole store atomically (tmp file, then rename). */
  save(): void {
    const obj: Record<string, HealthReading[]> = {};
    for (const [m, list] of this.data) obj[m] = list;
    const plain = Buffer.from(JSON.stringify({ v: 1, members: obj }), 'utf8');

    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    const out = Buffer.concat([iv, tag, ct]);

    mkdirSync(dirOf(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, out);
    renameSync(tmp, this.file);
  }

  /** Loads and decrypts a store. A missing file gives an empty store. Wrong key or tampering throws. */
  static load(file: string, key: Buffer): HealthStore {
    const store = new HealthStore(file, key);
    if (!existsSync(file)) return store;

    const buf = readFileSync(file);
    if (buf.length < IV_LEN + TAG_LEN) throw new Error(DECRYPT_ERROR);
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = buf.subarray(IV_LEN + TAG_LEN);

    let parsed: { v?: number; members?: Record<string, HealthReading[]> };
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
      parsed = JSON.parse(plain.toString('utf8'));
    } catch {
      throw new Error(DECRYPT_ERROR);
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.members) throw new Error(DECRYPT_ERROR);

    for (const [member, list] of Object.entries(parsed.members)) {
      if (!Array.isArray(list)) throw new Error(DECRYPT_ERROR);
      for (const r of list) store.add(r);
    }
    return store;
  }
}
