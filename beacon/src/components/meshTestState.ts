import type { RadioDiagnostics } from '../../modules/beacon-mesh';
import type { MeshStatus } from '../mesh/radioPolicy';

// Pure checklist logic for the /meshtest self-test: no React, no native modules, so node tests can import it.

export type Level = 'ok' | 'warn' | 'bad' | 'na';
export type FixKind = 'bluetooth' | 'nearby' | 'notifications' | 'location' | 'locationServices' | 'restart';

export interface CheckRow {
  id: string;
  level: Level;
  title: [string, string];
  detail: string;
  fix?: FixKind;
}

export interface StoreView {
  status: MeshStatus;
  radioError: string | null;
  radioAvailable: boolean;
}

export function buildChecklist(d: RadioDiagnostics | null, s: StoreView): CheckRow[] {
  if (!s.radioAvailable) {
    return [
      {
        id: 'radio',
        level: 'bad',
        title: ['Bluetooth radio module', 'Bluetooth रेडियो मॉड्यूल'],
        detail: 'This build has no Bluetooth module (Expo Go, web or an emulator). Install the Beacon APK on a real Android phone.',
      },
    ];
  }
  if (!d) {
    return [{ id: 'diag', level: 'warn', title: ['Reading the radio', 'रेडियो की जाँच'], detail: 'Waiting for the radio to answer...' }];
  }
  const p = d.permissions;
  const rows: CheckRow[] = [];
  rows.push({
    id: 'bt',
    level: d.bluetoothOn ? 'ok' : 'bad',
    title: ['Bluetooth is on', 'Bluetooth चालू है'],
    detail: d.bluetoothOn ? 'On.' : 'Bluetooth is off. Turn it on: the mesh starts again by itself.',
    fix: d.bluetoothOn ? undefined : 'bluetooth',
  });
  const nearby = p.scan && p.advertise && p.connect;
  rows.push({
    id: 'nearby',
    level: nearby ? 'ok' : 'bad',
    title: ['Nearby devices permission', 'आस-पास के डिवाइस की अनुमति'],
    detail: d.apiLevel >= 31 ? `Scan ${yn(p.scan)}, advertise ${yn(p.advertise)}, connect ${yn(p.connect)}.` : 'Android 11 or older: uses the location permission instead.',
    fix: nearby ? undefined : 'nearby',
  });
  rows.push({
    id: 'notif',
    level: p.notifications ? 'ok' : 'warn',
    title: ['Notifications allowed', 'सूचनाओं की अनुमति'],
    detail: p.notifications ? 'The "Beacon is connecting nearby phones" notice can show.' : 'Without it the keep-alive notice is hidden and some phones stop the mesh sooner.',
    fix: p.notifications ? undefined : 'notifications',
  });
  rows.push({
    id: 'loc',
    level: p.location ? 'ok' : d.locationRequired ? 'bad' : 'warn',
    title: ['Location permission', 'स्थान की अनुमति'],
    detail: p.location
      ? 'Granted.'
      : d.locationRequired
        ? 'Android 11 and older cannot scan for Bluetooth without it.'
        : 'Optional: only used to pick your neighbourhood chat channel. Without it you chat in the shared "local" room.',
    fix: p.location ? undefined : 'location',
  });
  if (d.locationRequired) {
    rows.push({
      id: 'locsvc',
      level: d.locationServicesOn ? 'ok' : 'bad',
      title: ['Location services on', 'लोकेशन सेवा चालू'],
      detail: d.locationServicesOn ? 'On.' : 'Android 11 and older return no scan results while the Location switch is off.',
      fix: d.locationServicesOn ? undefined : 'locationServices',
    });
  }
  rows.push({
    id: 'svc',
    level: d.serviceRunning ? 'ok' : d.running ? 'warn' : 'bad',
    title: ['Keep-alive service running', 'बैकग्राउंड सेवा चालू'],
    detail: d.serviceRunning ? 'Foreground service is up.' : d.serviceError ?? 'Not running. The mesh may stop when Beacon is in the background.',
    fix: d.serviceRunning ? undefined : 'restart',
  });
  rows.push({
    id: 'adv',
    level: d.advertising ? 'ok' : !d.advertiserAvailable ? 'bad' : 'warn',
    title: ['Advertising (others can find me)', 'प्रसारण (दूसरे मुझे ढूँढ सकें)'],
    detail: d.advertising ? 'Advertising the Beacon service.' : !d.advertiserAvailable ? 'This phone has no BLE advertiser.' : 'Not advertising yet.',
    fix: d.advertising ? undefined : 'restart',
  });
  rows.push({
    id: 'scan',
    level: d.scanning ? 'ok' : 'warn',
    title: ['Scanning (I can find others)', 'स्कैन (मैं दूसरों को ढूँढ सकूँ)'],
    detail: d.scanning ? `Scanning (${d.scanFast ? 'fast' : 'balanced'} mode, ${d.scanStartsLast30s} start(s) in the last 30 s).` : 'Not scanning.',
    fix: d.scanning ? undefined : 'restart',
  });
  const up = d.links.filter((l) => l.ready).length;
  rows.push({
    id: 'links',
    level: up > 0 ? 'ok' : 'warn',
    title: ['Phones connected', 'जुड़े हुए फ़ोन'],
    detail: up > 0 ? `${up} link${up === 1 ? '' : 's'} up.` : d.nearby.length > 0 ? `${d.nearby.length} Beacon phone(s) heard but not connected yet.` : 'None yet. Put both phones side by side with the app open.',
  });
  const err = s.radioError ?? d.lastError;
  rows.push({
    id: 'err',
    level: err ? 'warn' : 'ok',
    title: ['Last error', 'आख़िरी त्रुटि'],
    detail: err ?? 'None.',
  });
  return rows;
}

const yn = (b: boolean) => (b ? 'yes' : 'NO');

/** Worst level wins: bad > warn > ok. */
export function overall(rows: CheckRow[]): Level {
  if (rows.some((r) => r.level === 'bad')) return 'bad';
  if (rows.some((r) => r.level === 'warn')) return 'warn';
  return 'ok';
}

/** RSSI in plain words; Bluetooth LE signal is roughly -40 (touching) to -100 (barely there). */
export function signalWord(rssi: number | null | undefined): string {
  if (rssi == null) return 'unknown';
  if (rssi >= -60) return 'strong';
  if (rssi >= -75) return 'good';
  if (rssi >= -88) return 'weak';
  return 'very weak';
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
