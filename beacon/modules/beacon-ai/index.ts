import { NativeModule, requireNativeModule } from 'expo';

export type VoiceEvents = {
  onVoiceResult(e: { text: string; final: boolean; alternatives?: string[] }): void;
  onVoiceState(e: { state: 'listening' | 'stopped' | 'error'; message?: string }): void;
  // Vosk (offline recogniser)
  voskPartial(e: { text: string }): void;
  voskFinal(e: { text: string }): void;
  voskError(e: { code: string; message: string }): void;
  voskDownloadProgress(e: { lang: string; pct: number }): void;
};

declare class BeaconAINative extends NativeModule<VoiceEvents> {
  needleStart(system: string, toolsJson: string): Promise<{ ok: boolean; error: string | null }>;
  needleComplete(text: string): Promise<string>;
  needleReady(): boolean;
  voiceStatus(): { available: boolean; onDevice: boolean };
  voiceStart(language: string, continuous: boolean): Promise<void>;
  voiceStop(): Promise<void>;
  voskStatus(lang: string): { installed: boolean; sizeMb: number; downloading: boolean };
  voskDownload(lang: string): Promise<{ ok: boolean; error: string | null }>;
  voskCancelDownload(): void;
  voskRemove(lang: string): Promise<{ ok: boolean; error?: string }>;
  voskStart(lang: string, grammar: string[] | null): Promise<{ ok: boolean; error: string | null }>;
  voskStop(): Promise<{ text: string }>;
  voskCancel(): void;
}

let native: BeaconAINative | null = null;
try {
  native = requireNativeModule<BeaconAINative>('BeaconAI');
} catch {
  native = null; // Expo Go / web / iOS: AI falls back to the keyword router, voice to typing
}

export default native;
