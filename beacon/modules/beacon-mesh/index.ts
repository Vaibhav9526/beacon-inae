import { NativeModule, requireNativeModule } from 'expo';

export type MeshRadioEvents = {
  onPacket(e: { link: string; data: string }): void;
  onLink(e: { link: string; up: boolean }): void;
  onState(e: { state: string }): void;
};

export interface RadioDiagnostics {
  apiLevel: number;
  manufacturer: string;
  model: string;
  bleSupported: boolean;
  bluetoothOn: boolean;
  advertiserAvailable: boolean;
  permissions: { scan: boolean; advertise: boolean; connect: boolean; location: boolean; notifications: boolean };
  locationRequired: boolean;
  locationServicesOn: boolean;
  wanted: boolean;
  running: boolean;
  serviceRunning: boolean;
  serviceError: string | null;
  serverReady: boolean;
  advertising: boolean;
  scanning: boolean;
  scanFast: boolean;
  scanStartsLast30s: number;
  token: string;
  links: { id: string; role: 'client' | 'server' | 'both'; ready: boolean; mtu: number; rssi: number | null; queued: number }[];
  nearby: { id: string; addr: string; rssi: number; ageMs: number; linked: boolean; failures: number }[];
  txFrames: number;
  txBytes: number;
  rxFrames: number;
  rxBytes: number;
  lastError: string | null;
}

declare class BeaconMeshNative extends NativeModule<MeshRadioEvents> {
  isSupported(): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(link: string, base64: string): Promise<void>;
  broadcast(base64: string, exceptLink: string | null): Promise<void>;
  getDiagnostics(): Promise<RadioDiagnostics>;
}

let native: BeaconMeshNative | null = null;
try {
  native = requireNativeModule<BeaconMeshNative>('BeaconMesh');
} catch {
  native = null; // Expo Go, web or iOS: the mesh simply stays offline
}

export default native;
