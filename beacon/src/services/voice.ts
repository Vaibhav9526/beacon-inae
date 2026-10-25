import { PermissionsAndroid, Platform } from 'react-native';
import { create } from 'zustand';
import native from '../../modules/beacon-ai';
import type { Lang } from '../kb/types';
import { useSettings } from '../state/settings';

/** Phrases the recogniser may produce for "Hey Beacon" in English and Hindi (it is a made-up word, so it is spelled many ways). */
const WAKE = [
  /\bh?ey,? (beacon|beckon|bacon|bikon|beakon|bekan|beeken)\b/i,
  /\bok(ay)? (beacon|beckon|bikon)\b/i,
  /\bhi,? (beacon|beckon)\b/i,
  /(हे|हेय|हैलो|ओके)\s*(बीकन|बिकन|बेकन|बीकॉन|बीकान)/,
  /\bbeacon\b/i,
];

export const stripWake = (text: string): { woke: boolean; command: string } => {
  for (const re of WAKE) {
    const m = text.match(re);
    if (m && m.index !== undefined) return { woke: true, command: text.slice(m.index + m[0].length).replace(/^[\s,.!:-]+/, '').trim() };
  }
  return { woke: false, command: '' };
};

export const voiceSupported = () => !!native && Platform.OS === 'android';

export function voiceStatus() {
  try {
    return native?.voiceStatus() ?? { available: false, onDevice: false };
  } catch {
    return { available: false, onDevice: false };
  }
}

export async function ensureMic(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

const code = (l: Lang) => (l === 'hi' ? 'hi-IN' : 'en-IN');

interface VoiceState {
  listening: boolean;
  partial: string;
  wake: boolean; // continuous "Hey Beacon" mode on
  error: string | null;
}
export const useVoice = create<VoiceState>(() => ({ listening: false, partial: '', wake: false, error: null }));

/** Listen once and resolve with what was said (or null on silence, error or no support). */
export async function listenOnce(lang: Lang, timeoutMs = 9000): Promise<string | null> {
  if (!native || !(await ensureMic())) return null;
  await stopVoice();
  return new Promise<string | null>((resolve) => {
    let done = false;
    const subs: { remove(): void }[] = [];
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      subs.forEach((s) => s.remove());
      clearTimeout(timer);
      void native!.voiceStop();
      useVoice.setState({ listening: false, partial: '' });
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    subs.push(
      native!.addListener('onVoiceResult', (e) => {
        useVoice.setState({ partial: e.text });
        if (e.final) finish(e.text);
      }),
      native!.addListener('onVoiceState', (e) => {
        if (e.state === 'listening') useVoice.setState({ listening: true, error: null });
        if (e.state === 'error') {
          useVoice.setState({ error: e.message ?? 'error' });
          finish(null);
        }
      }),
    );
    void native!.voiceStart(code(lang), false);
  });
}

let wakeSubs: { remove(): void }[] = [];
let awaiting = false;

/**
 * "Hey Beacon, ..." mode. Keeps the recogniser running; when it hears the wake phrase followed by a command it calls
 * `onCommand(command)`. If only "Hey Beacon" is heard the next utterance is taken as the command.
 */
export async function startWake(lang: Lang, onCommand: (text: string) => void, onWake?: () => void): Promise<boolean> {
  if (!native || !(await ensureMic())) return false;
  stopWake();
  awaiting = false;
  wakeSubs.push(
    native.addListener('onVoiceResult', (e) => {
      useVoice.setState({ partial: e.text });
      if (!e.final) return;
      const { woke, command } = stripWake(e.text);
      if (awaiting) {
        awaiting = false;
        onCommand((woke ? command : e.text).trim());
      } else if (woke) {
        if (command) onCommand(command);
        else {
          awaiting = true;
          onWake?.();
        }
      }
    }),
    native.addListener('onVoiceState', (e) => {
      if (e.state === 'listening') useVoice.setState({ listening: true, error: null });
      if (e.state === 'error') useVoice.setState({ error: e.message ?? 'error' });
      if (e.state === 'stopped') useVoice.setState({ listening: false });
    }),
  );
  await native.voiceStart(code(lang), true);
  useVoice.setState({ wake: true });
  return true;
}

export function stopWake() {
  wakeSubs.forEach((s) => s.remove());
  wakeSubs = [];
  useVoice.setState({ wake: false, listening: false, partial: '' });
  void native?.voiceStop();
}

export async function stopVoice() {
  stopWake();
  await native?.voiceStop();
}

export const voiceEnabledSetting = () => useSettings.getState().voiceControl;
