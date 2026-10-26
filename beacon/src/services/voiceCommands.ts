import { router } from 'expo-router';
import { runAction } from '../ai/actions';
import { interpret, VOICE_TEXT } from '../ai/navigate';
import { needleEngine, needleSupported } from '../ai/needle';
import type { NeedleEngine } from '../ai/router';
import type { Action } from '../ai/tools';
import type { Lang } from '../kb/types';
import { useSettings } from '../state/settings';
import { speak } from './speech';

/** What the app says when it does not understand: the three example commands, never silence. */
const none = (l: Lang) => VOICE_TEXT.unknown(l);

/** The on-device model when this build has it, otherwise null (keywords only). */
export const voiceEngine = (): NeedleEngine | null => (needleSupported ? needleEngine : null);

export interface VoiceOutcome {
  said: string;
  action: Action;
  ran: boolean;
}

/**
 * A spoken or typed command -> the action it means, carried out and read back (hands-free path used by Home).
 * Emergencies open their guide first. Anything that sends or calls, and any unsure guess, is only read back as a
 * question: the bottom-bar mic shows the Yes/No card for those. Nothing is sent from a model guess.
 */
export async function handleVoiceCommand(text: string): Promise<VoiceOutcome> {
  const lang = useSettings.getState().lang;
  let d: Awaited<ReturnType<typeof interpret>>;
  try {
    d = await interpret(text, voiceEngine(), { lang });
  } catch {
    d = { kind: 'chip' };
  }
  switch (d.kind) {
    case 'emergency': {
      void speak(d.say, lang, 'veer');
      router.navigate(`/guide/${d.guideId}` as never);
      return { said: d.say, action: { type: 'guide', id: d.guideId }, ran: true };
    }
    case 'run': {
      void speak(d.label, lang, 'veer');
      if (d.route) router.navigate(d.route as never);
      else if (d.action) await runAction(d.action);
      return { said: d.label, action: d.action ?? { type: 'none' }, ran: true };
    }
    case 'confirm': {
      void speak(d.question, lang, 'veer');
      return { said: d.question, action: d.primary.action, ran: false };
    }
    default: {
      const said = none(lang);
      void speak(said, lang, 'veer');
      return { said, action: { type: 'none' }, ran: false };
    }
  }
}
