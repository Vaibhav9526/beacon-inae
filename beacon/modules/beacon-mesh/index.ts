import { NativeModule, requireNativeModule } from 'expo';

export type MeshRadioEvents = {
  onPacket(e: { link: string; data: string }): void;
  onLink(e: { link: string; up: boolean }): void;
  onState(e: { state: string }): void;
};

declare class BeaconMeshNative extends NativeModule<MeshRadioEvents> {
  isSupported(): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(link: string, base64: string): Promise<void>;
  broadcast(base64: string, exceptLink: string | null): Promise<void>;
  getLinks(): string[];
}

let native: BeaconMeshNative | null = null;
try {
  native = requireNativeModule<BeaconMeshNative>('BeaconMesh');
} catch {
  native = null; // Expo Go, web or iOS: the mesh simply stays offline
}

export default native;
