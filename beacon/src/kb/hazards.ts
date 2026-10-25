export type HazardId = 'seismic' | 'flood' | 'cyclone' | 'heatwave' | 'landslide' | 'drought' | 'lightning';
export type HazardLevel = 0 | 1 | 2 | 3;
export type SeismicZone = 2 | 3 | 4 | 5;
export type CalendarHazard = HazardId | 'coldwave';

/** Approximate, public-domain risk picture. Not a substitute for local engineering or authority advice. */
export const DISCLAIMER = 'Approximate, from public zoning maps. Check your local authority for exact risk.';

export interface Hazard {
  id: HazardId;
  level: HazardLevel;
  /** One line in plain words: what this hazard means for this place. */
  why: string;
  /** Present for the seismic hazard only, because BIS zones are more precise than a 0-3 level. */
  zone?: SeismicZone;
}

export interface HazardPlace {
  state?: string;
  city?: string;
  lat?: number;
  lon?: number;
}

type OtherHazardId = Exclude<HazardId, 'seismic'>;
type LevelMap = Record<OtherHazardId, HazardLevel>;

const ZERO: LevelMap = {
  flood: 0,
  cyclone: 0,
  heatwave: 0,
  landslide: 0,
  drought: 0,
  lightning: 0,
};

const levels = (p: Partial<LevelMap>): LevelMap => ({ ...ZERO, ...p });

const SEISMIC_LEVEL: Record<SeismicZone, HazardLevel> = { 2: 1, 3: 2, 4: 3, 5: 3 };
const ROMAN: Record<SeismicZone, string> = { 2: 'II', 3: 'III', 4: 'IV', 5: 'V' };

const SEISMIC_WHY: Record<SeismicZone, string> = {
  2: 'Zone II: shaking is usually light, but keep heavy furniture fixed to the wall.',
  3: 'Zone III: moderate shaking can happen. Fix tall furniture and know a safe spot in every room.',
  4: 'Zone IV: strong shaking is possible. Fix tall furniture and practise Drop, Cover, Hold On.',
  5: 'Zone V: very strong shaking is possible. Fix furniture, practise Drop, Cover, Hold On, and keep a go-bag ready.',
};

const WHY: Record<OtherHazardId, string> = {
  flood: 'Low-lying streets and rivers can flood. Know a high route and keep papers and medicines dry.',
  cyclone: 'Coastal winds and storm surge can arrive fast. Know your nearest cyclone shelter and move early.',
  heatwave: 'Long hot spells can cause heat stroke. Keep water ready and avoid the afternoon sun.',
  landslide: 'Heavy rain can weaken slopes. Move away if you see cracks, tilting trees or muddy streams.',
  drought: 'Long dry spells can cut the water supply. Store safe water and use it sparingly.',
  lightning: 'Thunderstorms bring deadly strikes. Go indoors when you hear thunder, and stay off open ground.',
};

interface StateRow {
  name: string;
  zone: SeismicZone;
  levels: LevelMap;
  aliases?: string[];
}

interface CityRow {
  city: string;
  state: string;
  lat: number;
  lon: number;
  zone: SeismicZone;
  levels?: Partial<LevelMap>;
  aliases?: string[];
}

const STATES: StateRow[] = [
  { name: 'Andhra Pradesh', zone: 3, levels: levels({ flood: 2, cyclone: 3, heatwave: 2, drought: 2, lightning: 2 }) },
  { name: 'Arunachal Pradesh', zone: 5, levels: levels({ flood: 2, landslide: 3, lightning: 2 }) },
  { name: 'Assam', zone: 5, levels: levels({ flood: 3, heatwave: 1, landslide: 2, drought: 1, lightning: 3 }) },
  { name: 'Bihar', zone: 4, levels: levels({ flood: 3, heatwave: 2, drought: 1, lightning: 2 }) },
  { name: 'Chhattisgarh', zone: 2, levels: levels({ flood: 1, heatwave: 2, drought: 1, lightning: 2 }) },
  { name: 'Goa', zone: 3, levels: levels({ flood: 1, cyclone: 2, heatwave: 1, landslide: 1, drought: 1, lightning: 1 }) },
  { name: 'Gujarat', zone: 3, levels: levels({ flood: 2, cyclone: 2, heatwave: 2, drought: 2, lightning: 1 }) },
  { name: 'Haryana', zone: 3, levels: levels({ flood: 1, heatwave: 2, drought: 2, lightning: 1 }) },
  { name: 'Himachal Pradesh', zone: 4, levels: levels({ flood: 2, landslide: 3, lightning: 1 }), aliases: ['HP'] },
  { name: 'Jharkhand', zone: 2, levels: levels({ flood: 1, heatwave: 2, drought: 2, lightning: 2 }) },
  { name: 'Karnataka', zone: 2, levels: levels({ flood: 1, cyclone: 1, heatwave: 1, landslide: 1, drought: 2, lightning: 1 }) },
  { name: 'Kerala', zone: 3, levels: levels({ flood: 3, cyclone: 1, heatwave: 1, landslide: 2, drought: 1, lightning: 2 }) },
  { name: 'Madhya Pradesh', zone: 2, levels: levels({ flood: 1, heatwave: 2, drought: 2, lightning: 2 }), aliases: ['MP'] },
  { name: 'Maharashtra', zone: 3, levels: levels({ flood: 2, cyclone: 2, heatwave: 2, landslide: 1, drought: 2, lightning: 1 }) },
  { name: 'Manipur', zone: 5, levels: levels({ flood: 1, landslide: 3, lightning: 2 }) },
  { name: 'Meghalaya', zone: 5, levels: levels({ flood: 2, landslide: 3, lightning: 3 }) },
  { name: 'Mizoram', zone: 5, levels: levels({ flood: 1, landslide: 3, lightning: 2 }) },
  { name: 'Nagaland', zone: 5, levels: levels({ flood: 1, landslide: 3, lightning: 2 }) },
  { name: 'Odisha', zone: 3, levels: levels({ flood: 2, cyclone: 3, heatwave: 2, drought: 1, lightning: 3 }), aliases: ['Orissa'] },
  { name: 'Punjab', zone: 3, levels: levels({ flood: 1, heatwave: 2, drought: 1, lightning: 1 }) },
  { name: 'Rajasthan', zone: 2, levels: levels({ heatwave: 3, drought: 3, lightning: 1 }) },
  { name: 'Sikkim', zone: 4, levels: levels({ flood: 1, landslide: 3, lightning: 1 }) },
  { name: 'Tamil Nadu', zone: 3, levels: levels({ flood: 2, cyclone: 3, heatwave: 1, landslide: 1, drought: 2, lightning: 1 }), aliases: ['TN'] },
  { name: 'Telangana', zone: 2, levels: levels({ flood: 2, heatwave: 2, drought: 2, lightning: 2 }) },
  { name: 'Tripura', zone: 5, levels: levels({ flood: 2, landslide: 2, lightning: 2 }) },
  { name: 'Uttar Pradesh', zone: 3, levels: levels({ flood: 2, heatwave: 2, landslide: 1, drought: 1, lightning: 2 }), aliases: ['UP'] },
  { name: 'Uttarakhand', zone: 4, levels: levels({ flood: 2, landslide: 3, lightning: 1 }), aliases: ['Uttaranchal'] },
  { name: 'West Bengal', zone: 3, levels: levels({ flood: 2, cyclone: 3, heatwave: 2, landslide: 1, drought: 1, lightning: 2 }) },
  {
    name: 'Andaman and Nicobar Islands',
    zone: 5,
    levels: levels({ flood: 1, cyclone: 3, landslide: 1, lightning: 1 }),
    aliases: ['Andaman & Nicobar', 'Andaman Nicobar'],
  },
  { name: 'Chandigarh', zone: 4, levels: levels({ flood: 1, heatwave: 2, drought: 1, lightning: 1 }) },
  {
    name: 'Dadra and Nagar Haveli and Daman and Diu',
    zone: 3,
    levels: levels({ flood: 1, cyclone: 1, heatwave: 2, drought: 1, lightning: 1 }),
    aliases: ['DNH and DD', 'Dadra Nagar Haveli', 'Daman and Diu'],
  },
  { name: 'Delhi', zone: 4, levels: levels({ flood: 2, heatwave: 2, drought: 1, lightning: 1 }), aliases: ['NCT of Delhi', 'National Capital Territory of Delhi'] },
  { name: 'Jammu and Kashmir', zone: 4, levels: levels({ flood: 2, landslide: 2, lightning: 1 }), aliases: ['J&K', 'Jammu & Kashmir'] },
  { name: 'Ladakh', zone: 4, levels: levels({ flood: 1, landslide: 2 }) },
  { name: 'Lakshadweep', zone: 3, levels: levels({ cyclone: 2, lightning: 1 }) },
  { name: 'Puducherry', zone: 3, levels: levels({ flood: 2, cyclone: 3, heatwave: 2, drought: 1, lightning: 1 }), aliases: ['Pondicherry'] },
];

const CITIES: CityRow[] = [
  { city: 'Delhi', state: 'Delhi', lat: 28.6139, lon: 77.209, zone: 4, aliases: ['New Delhi'] },
  { city: 'Mumbai', state: 'Maharashtra', lat: 19.076, lon: 72.8777, zone: 3, levels: { flood: 3, cyclone: 2, heatwave: 2 } },
  { city: 'Kolkata', state: 'West Bengal', lat: 22.5726, lon: 88.3639, zone: 3, levels: { flood: 2, cyclone: 3, heatwave: 2 } },
  { city: 'Chennai', state: 'Tamil Nadu', lat: 13.0827, lon: 80.2707, zone: 3, levels: { flood: 2, cyclone: 3, heatwave: 2 } },
  { city: 'Bengaluru', state: 'Karnataka', lat: 12.9716, lon: 77.5946, zone: 2, aliases: ['Bangalore'] },
  { city: 'Hyderabad', state: 'Telangana', lat: 17.385, lon: 78.4867, zone: 2, levels: { flood: 2, heatwave: 2, drought: 2 } },
  { city: 'Ahmedabad', state: 'Gujarat', lat: 23.0225, lon: 72.5714, zone: 3, levels: { flood: 2, heatwave: 2, drought: 2 } },
  { city: 'Pune', state: 'Maharashtra', lat: 18.5204, lon: 73.8567, zone: 2, levels: { flood: 2 } },
  { city: 'Surat', state: 'Gujarat', lat: 21.1702, lon: 72.8311, zone: 3, levels: { flood: 3, cyclone: 2, heatwave: 2 } },
  { city: 'Jaipur', state: 'Rajasthan', lat: 26.9124, lon: 75.7873, zone: 2, levels: { heatwave: 3, drought: 3 } },
  { city: 'Lucknow', state: 'Uttar Pradesh', lat: 26.8467, lon: 80.9462, zone: 3, levels: { flood: 2, heatwave: 2 } },
  { city: 'Kanpur', state: 'Uttar Pradesh', lat: 26.4499, lon: 80.3319, zone: 3, levels: { flood: 2, heatwave: 2 } },
  { city: 'Nagpur', state: 'Maharashtra', lat: 21.1458, lon: 79.0882, zone: 2, levels: { heatwave: 3, drought: 2 } },
  { city: 'Indore', state: 'Madhya Pradesh', lat: 22.7196, lon: 75.8577, zone: 2, levels: { heatwave: 2, drought: 2 } },
  { city: 'Bhopal', state: 'Madhya Pradesh', lat: 23.2599, lon: 77.4126, zone: 2, levels: { heatwave: 2, drought: 1 } },
  { city: 'Patna', state: 'Bihar', lat: 25.5941, lon: 85.1376, zone: 4, levels: { flood: 3, heatwave: 2, lightning: 2 } },
  { city: 'Varanasi', state: 'Uttar Pradesh', lat: 25.3176, lon: 82.9739, zone: 3, levels: { flood: 2, heatwave: 2 } },
  { city: 'Ranchi', state: 'Jharkhand', lat: 23.3441, lon: 85.3096, zone: 2, levels: { heatwave: 2, drought: 2, lightning: 2 } },
  { city: 'Bhubaneswar', state: 'Odisha', lat: 20.2961, lon: 85.8245, zone: 3, levels: { flood: 2, cyclone: 3, heatwave: 2, lightning: 3 } },
  { city: 'Guwahati', state: 'Assam', lat: 26.1445, lon: 91.7362, zone: 5, levels: { flood: 3, landslide: 2, lightning: 3 } },
  { city: 'Imphal', state: 'Manipur', lat: 24.817, lon: 93.9368, zone: 5, levels: { landslide: 3 } },
  { city: 'Aizawl', state: 'Mizoram', lat: 23.7271, lon: 92.7176, zone: 5, levels: { landslide: 3 } },
  { city: 'Shillong', state: 'Meghalaya', lat: 25.5788, lon: 91.8933, zone: 5, levels: { flood: 2, landslide: 3, lightning: 3 } },
  { city: 'Agartala', state: 'Tripura', lat: 23.8315, lon: 91.2868, zone: 5, levels: { flood: 2, landslide: 2, lightning: 2 } },
  { city: 'Kohima', state: 'Nagaland', lat: 25.6751, lon: 94.1086, zone: 5, levels: { landslide: 3 } },
  { city: 'Itanagar', state: 'Arunachal Pradesh', lat: 27.0844, lon: 93.6053, zone: 5, levels: { flood: 2, landslide: 3 } },
  { city: 'Gangtok', state: 'Sikkim', lat: 27.3389, lon: 88.6065, zone: 4, levels: { landslide: 3 } },
  { city: 'Shimla', state: 'Himachal Pradesh', lat: 31.1048, lon: 77.1734, zone: 4, levels: { flood: 2, landslide: 3 } },
  { city: 'Dehradun', state: 'Uttarakhand', lat: 30.3165, lon: 78.0322, zone: 4, levels: { flood: 2, landslide: 3 } },
  { city: 'Chandigarh', state: 'Chandigarh', lat: 30.7333, lon: 76.7794, zone: 4, levels: { heatwave: 2 } },
  { city: 'Jammu', state: 'Jammu and Kashmir', lat: 32.7266, lon: 74.857, zone: 4, levels: { flood: 2, landslide: 2 } },
  { city: 'Srinagar', state: 'Jammu and Kashmir', lat: 34.0837, lon: 74.7973, zone: 4, levels: { flood: 2, landslide: 2 } },
  { city: 'Kochi', state: 'Kerala', lat: 9.9312, lon: 76.2673, zone: 3, levels: { flood: 3, cyclone: 2, landslide: 2 } },
  { city: 'Thiruvananthapuram', state: 'Kerala', lat: 8.5241, lon: 76.9366, zone: 3, levels: { flood: 3, cyclone: 1, landslide: 2 } },
  { city: 'Visakhapatnam', state: 'Andhra Pradesh', lat: 17.6868, lon: 83.2185, zone: 2, levels: { flood: 2, cyclone: 3, heatwave: 2 } },
  { city: 'Vijayawada', state: 'Andhra Pradesh', lat: 16.5062, lon: 80.648, zone: 3, levels: { flood: 2, cyclone: 3, heatwave: 2 } },
  { city: 'Coimbatore', state: 'Tamil Nadu', lat: 11.0168, lon: 76.9558, zone: 3, levels: { flood: 1, cyclone: 2, heatwave: 2 } },
  { city: 'Madurai', state: 'Tamil Nadu', lat: 9.9252, lon: 78.1198, zone: 3, levels: { flood: 1, cyclone: 2, heatwave: 2, drought: 2 } },
  { city: 'Ludhiana', state: 'Punjab', lat: 30.901, lon: 75.8573, zone: 3, levels: { flood: 1, heatwave: 2 } },
  { city: 'Amritsar', state: 'Punjab', lat: 31.634, lon: 74.8723, zone: 3, levels: { heatwave: 2 } },
  { city: 'Raipur', state: 'Chhattisgarh', lat: 21.2514, lon: 81.6296, zone: 2, levels: { heatwave: 3, drought: 2 } },
  { city: 'Panaji', state: 'Goa', lat: 15.4909, lon: 73.8278, zone: 3, levels: { flood: 1, cyclone: 2 } },
  { city: 'Puducherry', state: 'Puducherry', lat: 11.9416, lon: 79.8083, zone: 3, levels: { flood: 2, cyclone: 3, heatwave: 2 } },
  { city: 'Port Blair', state: 'Andaman and Nicobar Islands', lat: 11.6234, lon: 92.7265, zone: 5, levels: { cyclone: 3 } },
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const matches = (name: string, aliases: string[] | undefined, input: string) => {
  const n = norm(input);
  return n === norm(name) || (aliases ?? []).some((a) => norm(a) === n);
};

const findState = (input?: string) => (input ? STATES.find((s) => matches(s.name, s.aliases, input)) : undefined);
const findCity = (input?: string) => (input ? CITIES.find((c) => matches(c.city, c.aliases, input)) : undefined);

/** Public so the screen can name the closest city it used. */
export function nearestCity(lat: number, lon: number): CityRow | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best: CityRow | null = null;
  let bestKm = Infinity;
  for (const c of CITIES) {
    const km = haversineKm(lat, lon, c.lat, c.lon);
    if (km < bestKm) {
      best = c;
      bestKm = km;
    }
  }
  return best;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const asHazard = (id: OtherHazardId, level: HazardLevel): Hazard => ({ id, level, why: WHY[id] });
const seismicHazard = (zone: SeismicZone): Hazard => ({
  id: 'seismic',
  level: SEISMIC_LEVEL[zone],
  why: SEISMIC_WHY[zone],
  zone,
});

const ORDER: HazardId[] = ['seismic', 'flood', 'cyclone', 'heatwave', 'landslide', 'drought', 'lightning'];

function fromLevels(zone: SeismicZone, base: LevelMap, override?: Partial<LevelMap>): Hazard[] {
  const merged = { ...base, ...override };
  return [seismicHazard(zone), ...ORDER.slice(1).map((id) => asHazard(id as OtherHazardId, merged[id as OtherHazardId]))];
}

function rank(hazards: Hazard[]): Hazard[] {
  return hazards
    .filter((h) => h.level > 0)
    .sort((a, b) => b.level - a.level || ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
}

/**
 * Coarse hazard exposure for a state or city. City beats state; if both are unknown, the
 * nearest city on our short list is used when coordinates are present.
 */
export function hazardProfile(place: HazardPlace): Hazard[] {
  const city = findCity(place.city);
  if (city) {
    const state = findState(city.state);
    return rank(fromLevels(city.zone, state?.levels ?? ZERO, city.levels));
  }

  const state = findState(place.state);
  if (state) return rank(fromLevels(state.zone, state.levels));

  if (Number.isFinite(place.lat) && Number.isFinite(place.lon)) {
    const near = nearestCity(place.lat as number, place.lon as number);
    if (near) {
      const nearState = findState(near.state);
      return rank(fromLevels(near.zone, nearState?.levels ?? ZERO, near.levels));
    }
  }

  return [];
}

/** Hazards that are typically in season in India during a calendar month (0 = January). */
export function hazardCalendar(month: number): CalendarHazard[] {
  const m = Number.isFinite(month) ? Math.max(0, Math.min(11, Math.trunc(month))) : 0;
  const table: CalendarHazard[][] = [
    ['coldwave'],
    ['coldwave'],
    ['heatwave'],
    ['cyclone', 'heatwave', 'lightning'],
    ['cyclone', 'heatwave', 'lightning'],
    ['flood', 'cyclone', 'heatwave', 'landslide', 'lightning'],
    ['flood', 'landslide', 'lightning'],
    ['flood', 'landslide', 'lightning'],
    ['flood', 'landslide', 'lightning'],
    ['cyclone', 'flood', 'lightning'],
    ['cyclone', 'flood', 'coldwave'],
    ['cyclone', 'coldwave'],
  ];
  return table[m];
}
