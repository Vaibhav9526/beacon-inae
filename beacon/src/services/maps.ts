import * as FS from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { type OfflineArea, overpassQuery, parseOverpass } from '../maps/osm';
import { getFix } from './location';

const DIR = `${FS.documentDirectory ?? ''}maps/`;
const FILE = `${DIR}area.json`;
const RADIUS_KM = 3;

// Overpass asks API clients to identify themselves.
const HEADERS = {
  'content-type': 'application/x-www-form-urlencoded',
  accept: 'application/json',
  'user-agent': 'BeaconDisasterApp/1.0 (offline area download)',
};
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

interface MapState {
  area: OfflineArea | null;
  loaded: boolean;
  downloading: boolean;
  error: string | null;
  load(): Promise<void>;
  download(): Promise<void>;
}

export const useMap = create<MapState>((set, get) => ({
  area: null,
  loaded: false,
  downloading: false,
  error: null,

  async load() {
    if (get().loaded) return;
    try {
      if (Platform.OS !== 'web') {
        const info = await FS.getInfoAsync(FILE);
        if (info.exists) set({ area: JSON.parse(await FS.readAsStringAsync(FILE)) as OfflineArea });
      }
    } catch {
      /* corrupt file: ignore, the user can download again */
    }
    set({ loaded: true });
  },

  async download() {
    if (get().downloading) return;
    set({ downloading: true, error: null });
    try {
      const fix = await getFix({ maxWaitMs: 8000 });
      if (!fix) throw new Error('Could not get your location');
      const center = { lat: fix.lat, lon: fix.lon };
      let json: { elements: never[] } | null = null;
      let lastErr = '';
      for (const url of ENDPOINTS) {
        try {
          const res = await fetch(url, { method: 'POST', headers: HEADERS, body: 'data=' + encodeURIComponent(overpassQuery(center.lat, center.lon, RADIUS_KM)) });
          if (res.ok) {
            json = await res.json();
            break;
          }
          lastErr = `map server said ${res.status}`;
        } catch (e) {
          lastErr = (e as Error).message;
        }
      }
      if (!json) throw new Error(lastErr || 'download failed');
      const area = parseOverpass(json, center, RADIUS_KM);
      if (Platform.OS !== 'web') {
        await FS.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
        await FS.writeAsStringAsync(FILE, JSON.stringify(area));
      }
      set({ area, downloading: false });
    } catch (e) {
      set({ downloading: false, error: (e as Error).message });
    }
  },
}));
