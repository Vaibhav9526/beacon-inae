/** Google Maps deep-link builders. Pure: no react-native imports, no keys needed. */

export type TravelMode = 'walking' | 'driving' | 'transit';

export interface DirectionsOpts {
  lat: number;
  lon: number;
  mode?: TravelMode;
  originLat?: number;
  originLon?: number;
}

const coords = (lat: number, lon: number) => `${lat},${lon}`;

/** Turn-by-turn directions to a destination. Origin is optional (Maps uses current location when omitted). */
export function directionsUrl({ lat, lon, mode = 'walking', originLat, originLon }: DirectionsOpts): string {
  let url = `https://www.google.com/maps/dir/?api=1&destination=${coords(lat, lon)}&travelmode=${mode}`;
  if (originLat !== undefined && originLon !== undefined) url += `&origin=${coords(originLat, originLon)}`;
  return url;
}

/** Text search, optionally biased toward a point ("hospital" near the user). */
export function searchUrl(query: string, near?: { lat: number; lon: number }): string {
  const q = near ? `${query} ${coords(near.lat, near.lon)}` : query;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** Pin a single coordinate on Google Maps. */
export function placeUrl(lat: number, lon: number, label?: string): string {
  void label; // the place pin is identified by coordinates; the label is for geoIntent only
  return `https://www.google.com/maps/search/?api=1&query=${coords(lat, lon)}`;
}

/** Android/system geo: intent (opens whichever map app the device prefers). */
export function geoIntent(lat: number, lon: number, label?: string): string {
  const c = coords(lat, lon);
  return label ? `geo:${c}?q=${c}(${encodeURIComponent(label)})` : `geo:${c}?q=${c}`;
}
