const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function encodeGeohash(lat: number, lon: number, precision = 7): string {
  let latR: [number, number] = [-90, 90];
  let lonR: [number, number] = [-180, 180];
  let hash = '';
  let bits = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    const r = even ? lonR : latR;
    const v = even ? lon : lat;
    const mid = (r[0] + r[1]) / 2;
    if (v >= mid) {
      ch = (ch << 1) | 1;
      r[0] = mid;
    } else {
      ch <<= 1;
      r[1] = mid;
    }
    even = !even;
    if (++bits === 5) {
      hash += BASE32[ch];
      bits = 0;
      ch = 0;
    }
  }
  return hash;
}

export function decodeGeohash(hash: string): { lat: number; lon: number } {
  let latR: [number, number] = [-90, 90];
  let lonR: [number, number] = [-180, 180];
  let even = true;
  for (const c of hash) {
    const idx = BASE32.indexOf(c);
    for (let b = 4; b >= 0; b--) {
      const r = even ? lonR : latR;
      const mid = (r[0] + r[1]) / 2;
      if ((idx >> b) & 1) r[0] = mid;
      else r[1] = mid;
      even = !even;
    }
  }
  return { lat: (latR[0] + latR[1]) / 2, lon: (lonR[0] + lonR[1]) / 2 };
}

/** Channel precisions, same ladder as bitchat's location channels. */
export const CHANNEL_LEVELS = [
  { name: 'block', precision: 7 },
  { name: 'neighborhood', precision: 6 },
  { name: 'city', precision: 5 },
  { name: 'province', precision: 4 },
  { name: 'region', precision: 2 },
] as const;

export const channelFor = (hash: string) => `geo:${hash}`;

/** All channels a phone at this position listens to (its own cell at every level). */
export function channelsAt(lat: number, lon: number): string[] {
  const full = encodeGeohash(lat, lon, 7);
  return CHANNEL_LEVELS.map((l) => channelFor(full.slice(0, l.precision)));
}
