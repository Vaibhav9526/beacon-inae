import { NativeModule, requireNativeModule } from 'expo';

export type VoiceEvents = {
  onVoiceResult(e: { text: string; final: boolean; alternatives?: string[] }): void;
  onVoiceState(e: { state: 'listening' | 'stopped' | 'error'; message?: string }): void;
};

declare class BeaconAINative extends NativeModule<VoiceEvents> {
  needleStart(system: string, toolsJson: string): Promise<{ ok: boolean; error: string | null }>;
  needleComplete(text: string): Promise<string>;
  needleReady(): boolean;
  voiceStatus(): { available: boolean; onDevice: boolean };
  voiceStart(language: string, continuous: boolean): Promise<void>;
  voiceStop(): Promise<void>;
}

let native: BeaconAINative | null = null;
try {
  native = requireNativeModule<BeaconAINative>('BeaconAI');
} catch {
  native = null; // Expo Go / web / iOS: AI falls back to the keyword router, voice to typing
}

export default native;
