import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import type { Lang } from '../kb/types';
import { getKey, synthesize, useEleven } from './elevenlabs';
import type { VoiceRole } from './elevenlabs';

export type PersonaId = 'didi' | 'asha' | 'veer' | 'default';

// Fallback voice (used with no ElevenLabs key, no internet, or on error): each character gets its own pitch and pace.
const STYLE: Record<PersonaId, { pitch: number; rate: number; female: boolean }> = {
  didi: { pitch: 1.3, rate: 0.95, female: true },
  asha: { pitch: 1.05, rate: 0.9, female: true },
  veer: { pitch: 0.8, rate: 0.95, female: false },
  default: { pitch: 1, rate: 0.95, female: true },
};

// expo-audio has native code: load it lazily so a build without it still speaks with the phone's own voice
type AudioMod = typeof import('expo-audio');
let audioMod: AudioMod | null | undefined;
function audio(): AudioMod | null {
  if (audioMod === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      audioMod = require('expo-audio') as AudioMod;
    } catch {
      audioMod = null;
    }
  }
  return audioMod;
}

let voices: Speech.Voice[] | null = null;
let player: { pause(): void; remove(): void; play(): void; addListener(e: string, cb: (s: { didJustFinish?: boolean }) => void): unknown } | null = null;

async function pickVoice(lang: Lang, female: boolean): Promise<string | undefined> {
  if (Platform.OS === 'web') return undefined;
  try {
    voices ??= await Speech.getAvailableVoicesAsync();
    const code = lang === 'hi' ? 'hi' : 'en';
    const cands = voices.filter((v) => v.language.toLowerCase().startsWith(code));
    const want = cands.find((v) => (female ? /female|fem|-x-hia|-x-ena|-x-end/i : /male|-x-hic|-x-ene|-x-enc/i).test(v.identifier + v.name));
    return (want ?? cands[0])?.identifier;
  } catch {
    return undefined;
  }
}

/**
 * The phone's own voice. Never silent on purpose: no Hindi voice installed -> English voice (pickVoice returns no
 * voice for hi when none is installed, and the language drops to en-IN), and a failing engine is retried once with
 * the default voice.
 */
function localSpeak(text: string, lang: Lang, persona: PersonaId, onDone?: () => void) {
  const st = STYLE[persona];
  void pickVoice(lang, st.female)
    .then((voice) => {
      const useHi = lang === 'hi' && !!voice;
      if (lang === 'hi' && !useHi) console.log('[voice] no Hindi TTS voice installed, speaking with the English voice');
      const language = useHi ? 'hi-IN' : 'en-IN';
      const done = () => {
        console.log('[voice] tts done');
        onDone?.();
      };
      try {
        Speech.speak(text, {
          language,
          pitch: st.pitch,
          rate: st.rate,
          voice,
          onStart: () => console.log('[voice] tts start', language),
          onDone: done,
          onStopped: done,
          onError: (e: unknown) => {
            console.log('[voice] tts error', String(e));
            onDone?.();
          },
        });
      } catch (e) {
        console.log('[voice] tts threw, retrying with default voice', String(e));
        try {
          Speech.speak(text, { language: 'en-IN', onDone: done, onError: done });
        } catch (e2) {
          console.log('[voice] tts retry failed', String(e2));
          onDone?.();
        }
      }
    })
    .catch((e) => {
      console.log('[voice] tts voice lookup failed', String(e));
      onDone?.();
    });
}

function stopPlayer() {
  try {
    player?.pause();
    player?.remove();
  } catch {
    /* already gone */
  }
  player = null;
}

/**
 * Speak with the character's ElevenLabs voice when a key is set and the phone is online, otherwise with the phone's
 * own voice. Never throws: a voice that fails must not break the screen it is on.
 */
export async function speak(text: string, lang: Lang, persona: PersonaId = 'default', onDone?: () => void) {
  stopSpeaking();
  const au = audio();
  const key = await getKey().catch(() => null);
  if (au && Platform.OS !== 'web' && key) {
    try {
      const role = persona as VoiceRole;
      const voice = useEleven.getState().voices[role] ?? useEleven.getState().voices.default;
      if (voice) {
        const uri = await synthesize(text, voice.id, lang);
        if (uri) {
          await au.setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
          player = au.createAudioPlayer(uri) as NonNullable<typeof player>;
          const p = player;
          p.addListener('playbackStatusUpdate', (s: { didJustFinish?: boolean }) => {
            if (s.didJustFinish) {
              stopPlayer();
              onDone?.();
            }
          });
          p.play();
          return;
        }
      }
    } catch {
      /* fall through to the phone's own voice */
    }
  }
  localSpeak(text, lang, persona, onDone);
}

export function stopSpeaking(): void {
  stopPlayer();
  void Speech.stop();
}

export const isSpeaking = () => Speech.isSpeakingAsync();
