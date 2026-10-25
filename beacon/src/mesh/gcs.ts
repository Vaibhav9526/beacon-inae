// Golomb-coded set, used for gossip sync ("which packets do you already have?").
// A request carries a compact filter of the packet IDs the sender holds; the receiver replies with
// the cached packets whose ID is not in the filter.

export const GCS_P = 16;

/** Stable 32-bit hash of a packet key. */
export function hashKey(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  return h >>> 0;
}

class BitWriter {
  bytes: number[] = [];
  cur = 0;
  n = 0;
  bit(b: number) {
    this.cur = (this.cur << 1) | b;
    if (++this.n === 8) {
      this.bytes.push(this.cur);
      this.cur = 0;
      this.n = 0;
    }
  }
  bits(v: number, count: number) {
    for (let i = count - 1; i >= 0; i--) this.bit((v >>> i) & 1);
  }
  finish() {
    while (this.n !== 0) this.bit(0);
    return Uint8Array.from(this.bytes);
  }
}

class BitReader {
  pos = 0;
  constructor(private b: Uint8Array) {}
  get eof() {
    return this.pos >= this.b.length * 8;
  }
  bit() {
    const v = (this.b[this.pos >> 3] >> (7 - (this.pos & 7))) & 1;
    this.pos++;
    return v;
  }
  bits(count: number) {
    let v = 0;
    for (let i = 0; i < count; i++) v = (v << 1) | this.bit();
    return v >>> 0;
  }
}

function range(n: number) {
  return Math.max(1, n) * 2 ** GCS_P;
}

function mapped(keys: string[]): number[] {
  const r = range(keys.length);
  return keys.map((k) => hashKey(k) % r).sort((a, b) => a - b);
}

export function buildGcs(keys: string[]): { n: number; data: Uint8Array } {
  const vals = mapped(keys);
  const w = new BitWriter();
  let prev = 0;
  for (const v of vals) {
    const d = v - prev;
    prev = v;
    const q = Math.floor(d / 2 ** GCS_P);
    for (let i = 0; i < q; i++) w.bit(1);
    w.bit(0);
    w.bits(d % 2 ** GCS_P, GCS_P);
  }
  return { n: keys.length, data: w.finish() };
}

export function decodeGcs(n: number, data: Uint8Array): Set<number> {
  const out = new Set<number>();
  const r = new BitReader(data);
  let prev = 0;
  for (let i = 0; i < n && !r.eof; i++) {
    let q = 0;
    while (!r.eof && r.bit() === 1) q++;
    const d = q * 2 ** GCS_P + r.bits(GCS_P);
    prev += d;
    out.add(prev);
  }
  return out;
}

/** True when the key is (probably) present in a filter built from `n` items. */
export function gcsHas(set: Set<number>, n: number, key: string): boolean {
  return set.has(hashKey(key) % range(n));
}
