import { allowedByVoice, runAction } from '../ai/actions';
import { needleEngine, needleSupported } from '../ai/needle';
import { CONFIRM_BELOW, route } from '../ai/router';
import type { Action } from '../ai/tools';
import { getDisaster, getGuide, pick } from '../kb';
import type { Lang } from '../kb/types';
import { useSettings } from '../state/settings';
import { speak } from './speech';

const SAY = {
  map: (place: string, l: Lang) => (l === 'hi' ? `सबसे नज़दीकी ${({ shelter: 'आश्रय', hospital: 'अस्पताल', water: 'पीने का पानी', police: 'पुलिस थाना', pharmacy: 'दवाई की दुकान' } as Record<string, string>)[place] ?? place} खोल रहा हूँ।` : `Opening the nearest ${place}.`),
  guide: (title: string, l: Lang) => (l === 'hi' ? `${title}। ये चरण पढ़ रहा हूँ।` : `${title}. Here are the steps.`),
  sos: (l: Lang) => (l === 'hi' ? 'SOS भेजने के लिए लाल SOS बटन दबाए रखिए। या 112 पर कॉल करें।' : 'To send an SOS, press and hold the red SOS button. Or say "call 112".'),
  none: (l: Lang) => (l === 'hi' ? 'मैं समझ नहीं पाया। दोबारा कहें।' : 'I did not understand. Please say it again.'),
  unsure: (l: Lang) => (l === 'hi' ? 'क्या आपका मतलब यह था?' : 'Did you mean this?'),
  safe: (l: Lang) => (l === 'hi' ? 'आपके परिवार को बता दिया कि आप सुरक्षित हैं।' : 'I told your family you are safe.'),
  alerts: (l: Lang) => (l === 'hi' ? 'आपके इलाक़े के अलर्ट खोल रहा हूँ।' : 'Opening alerts near you.'),
  settings: (l: Lang) => (l === 'hi' ? 'सेटिंग बदल दी।' : 'Setting changed.'),
  call: (l: Lang) => (l === 'hi' ? '112 मिला रहा हूँ।' : 'Calling 112.'),
  chat: (l: Lang) => (l === 'hi' ? 'समुदाय चैट खोल रहा हूँ।' : 'Opening community chat.'),
};

function describe(a: Action, lang: Lang): string {
  switch (a.type) {
    case 'map':
      return SAY.map(a.place, lang);
    case 'guide':
      return SAY.guide(pick(getGuide(a.id)?.title ?? ['', ''], lang), lang);
    case 'disaster':
      return SAY.guide(pick(getDisaster(a.id)?.title ?? ['', ''], lang), lang);
    case 'sos':
      return SAY.sos(lang);
    case 'safe':
      return SAY.safe(lang);
    case 'alerts':
      return SAY.alerts(lang);
    case 'settings':
      return SAY.settings(lang);
    case 'call112':
      return SAY.call(lang);
    case 'chat':
      return SAY.chat(lang);
    default:
      return SAY.none(lang);
  }
}

export interface VoiceOutcome {
  said: string;
  action: Action;
  ran: boolean;
}

/** A spoken or typed command -> the action it means, carried out and read back. Never sends an SOS on its own. */
export async function handleVoiceCommand(text: string): Promise<VoiceOutcome> {
  const lang = useSettings.getState().lang;
  const r = await route(text, needleSupported ? needleEngine : null);
  const a = r.action;
  if (a.type === 'none') {
    const said = SAY.none(lang);
    void speak(said, lang, 'veer');
    return { said, action: a, ran: false };
  }
  if (!allowedByVoice(a)) {
    const said = SAY.sos(lang);
    void speak(said, lang, 'veer');
    return { said, action: a, ran: false };
  }
  // an uncertain match is shown, not run, for anything that has side effects
  const risky = a.type === 'safe' || a.type === 'call112';
  if (r.confidence < CONFIRM_BELOW && risky) {
    const said = SAY.unsure(lang);
    void speak(said, lang, 'veer');
    return { said, action: a, ran: false };
  }
  const said = describe(a, lang);
  void speak(said, lang, 'veer');
  await runAction(a);
  return { said, action: a, ran: true };
}
