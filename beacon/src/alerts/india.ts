import type { Point } from './sources';

// Rough bounding boxes [minLat, minLon, maxLat, maxLon] per state / UT. NDMA's per-alert polygons are
// not openly downloadable, so we match an alert's issuing state to the user's position instead.
// Coarse by design: overlaps near borders are accepted, it is better to show a neighbour's alert than to miss one.
export const STATE_BOXES: Record<string, [number, number, number, number]> = {
  'andhra pradesh': [12.6, 76.7, 19.9, 84.8],
  'arunachal pradesh': [26.6, 91.5, 29.5, 97.4],
  assam: [24.1, 89.7, 28.2, 96.0],
  bihar: [24.3, 83.3, 27.5, 88.3],
  chhattisgarh: [17.8, 80.2, 24.1, 84.4],
  goa: [14.9, 73.7, 15.8, 74.3],
  gujarat: [20.1, 68.1, 24.7, 74.5],
  haryana: [27.6, 74.5, 30.9, 77.6],
  'himachal pradesh': [30.4, 75.6, 33.3, 79.0],
  jharkhand: [21.9, 83.3, 25.4, 87.9],
  karnataka: [11.5, 74.0, 18.5, 78.6],
  kerala: [8.2, 74.8, 12.8, 77.4],
  'madhya pradesh': [21.1, 74.0, 26.9, 82.8],
  maharashtra: [15.6, 72.6, 22.1, 80.9],
  manipur: [23.8, 93.0, 25.7, 94.8],
  meghalaya: [25.0, 89.8, 26.1, 92.8],
  mizoram: [21.9, 92.2, 24.5, 93.4],
  nagaland: [25.2, 93.3, 27.0, 95.3],
  odisha: [17.8, 81.3, 22.6, 87.5],
  punjab: [29.5, 73.9, 32.5, 76.9],
  rajasthan: [23.0, 69.5, 30.2, 78.3],
  sikkim: [27.0, 88.0, 28.2, 88.9],
  'tamil nadu': [8.0, 76.2, 13.6, 80.4],
  telangana: [15.8, 77.2, 19.9, 81.8],
  tripura: [22.9, 91.1, 24.6, 92.3],
  'uttar pradesh': [23.9, 77.1, 30.4, 84.7],
  uttarakhand: [28.7, 77.6, 31.5, 81.1],
  'west bengal': [21.5, 85.8, 27.2, 89.9],
  delhi: [28.4, 76.8, 28.9, 77.4],
  'jammu and kashmir': [32.3, 73.7, 37.1, 80.3],
  ladakh: [32.3, 75.8, 36.0, 80.3],
  chandigarh: [30.6, 76.7, 30.8, 76.9],
  puducherry: [11.8, 79.7, 12.0, 79.9],
  'andaman and nicobar': [6.7, 92.2, 13.7, 94.0],
  lakshadweep: [8.0, 71.6, 12.4, 74.0],
  'dadra and nagar haveli': [20.0, 72.7, 20.5, 73.3],
  'daman and diu': [20.3, 70.8, 20.8, 73.1],
};

export const INDIA_BOX: [number, number, number, number] = [6.5, 68.0, 37.2, 97.5];

const MARGIN = 0.25;
const inBox = (p: Point, b: [number, number, number, number], m = 0) =>
  p.lat >= b[0] - m && p.lat <= b[2] + m && p.lon >= b[1] - m && p.lon <= b[3] + m;

export const inIndia = (p: Point) => inBox(p, INDIA_BOX);

// IMD regional centres and big cities -> state, since bulletins are signed by the office, not the state.
const PLACE_TO_STATE: Record<string, string> = {
  thiruvananthapuram: 'kerala', kochi: 'kerala', kozhikode: 'kerala', chennai: 'tamil nadu', mumbai: 'maharashtra', pune: 'maharashtra', nagpur: 'maharashtra',
  kolkata: 'west bengal', guwahati: 'assam', hyderabad: 'telangana', bhubaneswar: 'odisha', ahmedabad: 'gujarat', bengaluru: 'karnataka', bangalore: 'karnataka',
  dehradun: 'uttarakhand', jaipur: 'rajasthan', lucknow: 'uttar pradesh', patna: 'bihar', ranchi: 'jharkhand', raipur: 'chhattisgarh', bhopal: 'madhya pradesh',
  srinagar: 'jammu and kashmir', shimla: 'himachal pradesh', gangtok: 'sikkim', agartala: 'tripura', imphal: 'manipur', itanagar: 'arunachal pradesh',
  shillong: 'meghalaya', panaji: 'goa', amaravati: 'andhra pradesh', vijayawada: 'andhra pradesh', visakhapatnam: 'andhra pradesh', amritsar: 'punjab', ludhiana: 'punjab',
};

const norm = (text: string) => text.toLowerCase().replace(/[-_&]/g, ' ').replace(/\s+/g, ' ');

/** Every state or UT a piece of text refers to (an office name, an area list, a headline). */
export function statesIn(text: string): string[] {
  const t = norm(text);
  const out = new Set<string>();
  for (const name of Object.keys(STATE_BOXES)) if (t.includes(name)) out.add(name);
  for (const [place, st] of Object.entries(PLACE_TO_STATE)) if (t.includes(place)) out.add(st);
  if (t.includes('jammu') || t.includes('j&k')) out.add('jammu and kashmir');
  if (t.includes('nicobar') || t.includes('andaman')) out.add('andaman and nicobar');
  if (t.includes('orissa')) out.add('odisha');
  return [...out];
}

/** The first state a sender string refers to ("Andhra Pradesh SDMA", "Andhra-Pradesh-SDMA"). */
export function stateOf(text: string): string | null {
  return statesIn(text)[0] ?? null;
}

/**
 * True when an alert is relevant at `p`. States named by the sender or in the alert text are matched against the
 * user's position; only an alert that names no state at all (a national NDMA/IMD bulletin) applies across India.
 */
export function relevantHere(author: string, p: Point, extraText = ''): boolean {
  const states = statesIn(`${author} ${extraText}`);
  if (states.length) return states.some((st) => inBox(p, STATE_BOXES[st], MARGIN));
  return inIndia(p);
}
