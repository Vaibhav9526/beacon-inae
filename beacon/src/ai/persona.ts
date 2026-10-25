import { type Guide, type Lang, type T, DISASTERS, FIRST_AID, getDisaster, getGuide, pick } from '../kb';
import { type NeedleEngine, CONFIRM_BELOW, route } from './router';
import type { Action } from './tools';

export type PersonaKey = 'didi' | 'asha' | 'veer';

export interface PersonaDef {
  id: PersonaKey;
  name: T;
  role: T;
  greeting: T;
  /** Suggested first questions (chips). */
  starters: T[];
  /** kids only ever talk to Didi, and Didi's answers are age-appropriate */
  kidSafe: boolean;
}

export const PERSONAS: Record<PersonaKey, PersonaDef> = {
  didi: {
    id: 'didi',
    name: ['Didi', 'दीदी'],
    role: ['Your safety friend', 'आपकी सुरक्षा की दोस्त'],
    greeting: ["Hi! I'm Didi. Ask me what to do if something scary happens, and I'll tell you the safe way. 🧡", 'नमस्ते! मैं दीदी हूँ। कुछ डरावना हो तो क्या करना है, मुझसे पूछो। मैं सुरक्षित तरीका बताऊँगी। 🧡'],
    starters: [
      ['What do I do in an earthquake?', 'भूकंप में क्या करूँ?'],
      ['I got a small cut', 'मुझे छोटा कट लगा'],
      ['There is a fire!', 'आग लगी है!'],
      ['I am lost', 'मैं खो गया हूँ'],
    ],
    kidSafe: true,
  },
  asha: {
    id: 'asha',
    name: ['Dr. Asha', 'डॉ. आशा'],
    role: ['First-aid doctor', 'प्राथमिक उपचार डॉक्टर'],
    greeting: ["I'm Dr. Asha. Tell me what happened and I will walk you through the first-aid steps. In an emergency, call 112 first.", 'मैं डॉ. आशा हूँ। बताइए क्या हुआ, मैं प्राथमिक उपचार के चरण बताऊँगी। आपात स्थिति में पहले 112 पर कॉल करें।'],
    starters: [
      ['Someone is bleeding badly', 'किसी को तेज़ खून बह रहा है'],
      ['How do I make ORS at home?', 'घर पर ORS कैसे बनाएँ?'],
      ['Snake bite', 'साँप ने काटा'],
      ['Splint a broken arm', 'टूटे हाथ पर स्प्लिंट'],
    ],
    kidSafe: false,
  },
  veer: {
    id: 'veer',
    name: ['Captain Veer', 'कैप्टन वीर'],
    role: ['Rescue and disaster guide', 'बचाव और आपदा मार्गदर्शक'],
    greeting: ["Captain Veer here. Tell me the hazard and I'll give you the plan: before, during and after.", 'कैप्टन वीर यहाँ। ख़तरा बताइए, मैं योजना दूँगा: पहले, दौरान और बाद में।'],
    starters: [
      ['Flood warning, what now?', 'बाढ़ की चेतावनी, अब क्या करें?'],
      ['Cyclone is coming', 'चक्रवात आ रहा है'],
      ['Trapped under debris', 'मलबे में फँसे हैं'],
      ['Clean drinking water in a flood', 'बाढ़ में साफ़ पीने का पानी'],
    ],
    kidSafe: false,
  },
};

export type Block =
  | { type: 'text'; text: string }
  | { type: 'steps'; title: string; steps: string[] }
  | { type: 'warn'; text: string }
  | { type: 'guide'; id: string }
  | { type: 'disaster'; id: string }
  | { type: 'action'; action: Action; label: string }
  | { type: 'chips'; items: { label: string; query: string }[] };

export interface Reply {
  blocks: Block[];
  /** Text to read aloud. */
  speech: string;
  source: 'needle' | 'keywords' | 'none';
  confidence: number;
}

const INTRO: Record<PersonaKey, Record<Guide['level'], T>> = {
  didi: {
    emergency: ['Stay calm, you are doing great. FIRST tell a grown-up or call 112. Then we do this together:', 'शांत रहो, तुम बहुत अच्छा कर रहे हो। सबसे पहले किसी बड़े को बताओ या 112 पर कॉल करो। फिर हम साथ यह करेंगे:'],
    urgent: ['Okay, let us take care of this. Tell a grown-up too. Here is what to do:', 'ठीक है, इसका ध्यान रखते हैं। किसी बड़े को भी बताओ। यह करना है:'],
    minor: ['Easy! Here is how to look after it:', 'आसान है! ऐसे ध्यान रखते हैं:'],
  },
  asha: {
    emergency: ['This is an emergency. Call 112 now, then follow these steps:', 'यह आपात स्थिति है। अभी 112 पर कॉल करें, फिर ये चरण अपनाएँ:'],
    urgent: ['Let us take it step by step. You will also need a doctor soon:', 'चलिए एक-एक चरण में करते हैं। जल्द डॉक्टर को भी दिखाना होगा:'],
    minor: ['This can be managed at home. Here is how:', 'यह घर पर सँभाला जा सकता है। ऐसे करें:'],
  },
  veer: {
    emergency: ['Priority one: call 112 and stay safe. Then:', 'सबसे पहले: 112 पर कॉल करें और सुरक्षित रहें। फिर:'],
    urgent: ['Listen up, here is the plan:', 'ध्यान से सुनिए, योजना यह है:'],
    minor: ['Easy fix. Here is the drill:', 'आसान उपाय। तरीक़ा यह है:'],
  },
};

const NO_MATCH: Record<PersonaKey, T> = {
  didi: ["Hmm, I am not sure about that one. Ask a grown-up, or try one of these:", 'हम्म, इसके बारे में मुझे पक्का नहीं पता। किसी बड़े से पूछो, या इनमें से कोई आज़माओ:'],
  asha: ['I can only share verified first-aid guidance, and I could not match that. Try different words, or pick a topic:', 'मैं सिर्फ़ जाँची हुई प्राथमिक उपचार जानकारी देती हूँ और इसका मिलान नहीं हो पाया। दूसरे शब्द आज़माएँ, या विषय चुनें:'],
  veer: ['That is outside what I can verify. Try another way to say it, or pick a hazard:', 'यह मेरे सत्यापित ज्ञान से बाहर है। दूसरे तरीक़े से कहें, या ख़तरा चुनें:'],
};

const CALL: T = ['If it is serious, call 112 now.', 'गंभीर हो तो अभी 112 पर कॉल करें।'];
const KID_GROWNUP: T = ['Always tell a grown-up, a teacher or a neighbour you trust.', 'हमेशा किसी बड़े, टीचर या भरोसेमंद पड़ोसी को बताओ।'];

const chipsFor = (p: PersonaKey, lang: Lang) => PERSONAS[p].starters.map((s) => ({ label: pick(s, lang), query: pick(s, lang) }));

function guideBlocks(g: Guide, persona: PersonaKey, lang: Lang, kid: boolean): Block[] {
  const blocks: Block[] = [{ type: 'text', text: pick(INTRO[persona][g.level], lang) }];
  const steps = kid ? g.steps.slice(0, 4) : g.steps;
  blocks.push({ type: 'steps', title: pick(g.title, lang), steps: steps.map((s) => pick(s, lang)) });
  if (!kid && g.avoid?.length) blocks.push({ type: 'warn', text: g.avoid.map((a) => pick(a, lang)).join(' ') });
  if (kid) blocks.push({ type: 'text', text: pick(KID_GROWNUP, lang) });
  if (g.household?.length && !kid) blocks.push({ type: 'text', text: pick(g.household[0], lang) });
  blocks.push({ type: 'warn', text: pick(CALL, lang) });
  blocks.push({ type: 'guide', id: g.id });
  return blocks;
}

function speechOf(blocks: Block[]): string {
  return blocks
    .map((b) => (b.type === 'text' || b.type === 'warn' ? b.text : b.type === 'steps' ? `${b.title}. ${b.steps.map((s, i) => `${i + 1}. ${s}`).join(' ')}` : ''))
    .filter(Boolean)
    .join(' ');
}

/**
 * Answer a question as a character. Needle (when present) or the keyword router picks WHAT to show;
 * every word of medical or safety content comes from the curated knowledge base.
 */
export async function reply(persona: PersonaKey, text: string, lang: Lang, engine?: NeedleEngine | null): Promise<Reply> {
  const kid = PERSONAS[persona].kidSafe;
  const r = await route(text, engine);
  const a = r.action;
  let blocks: Block[] = [];

  if (a.type === 'guide') {
    const g = getGuide(a.id);
    if (g) {
      blocks = guideBlocks(g, persona, lang, kid);
      if (r.confidence < CONFIRM_BELOW) {
        const alts = r.alternatives.map(getGuide).filter((x): x is Guide => !!x).slice(0, 2);
        if (alts.length)
          blocks.push({ type: 'chips', items: alts.map((x) => ({ label: pick(x.title, lang), query: pick(x.title, lang) })) });
      }
    }
  } else if (a.type === 'disaster') {
    const d = getDisaster(a.id);
    if (d) {
      const steps = [...d.during, ...(kid ? [] : d.after.slice(0, 2))].map((s) => pick(s, lang));
      blocks = [
        { type: 'text', text: pick(INTRO[persona].urgent, lang) },
        { type: 'steps', title: pick(d.title, lang), steps: kid ? steps.slice(0, 4) : steps },
        ...(kid ? [{ type: 'text', text: pick(KID_GROWNUP, lang) } as Block] : []),
        { type: 'disaster', id: d.id },
      ];
    }
  } else if (a.type === 'sos') {
    blocks = kid
      ? [{ type: 'text', text: lang === 'hi' ? 'अगर तुम्हें मदद चाहिए तो बड़ा लाल मदद बटन दबाए रखो। मैं तुम्हारे माता-पिता को बता दूँगी। 🆘' : 'If you need help, hold the big red Help button. It tells your parents right away. 🆘' }]
      : [{ type: 'action', action: a, label: lang === 'hi' ? 'SOS भेजें' : 'Send SOS' }];
  } else if (a.type !== 'none') {
    const label: Record<string, T> = {
      map: ['Show on map', 'नक्शे पर दिखाएँ'],
      safe: ['Tell them I am safe', 'बताएँ कि मैं सुरक्षित हूँ'],
      call112: ['Call 112', '112 पर कॉल करें'],
      alerts: ['See alerts', 'अलर्ट देखें'],
      chat: ['Open community chat', 'समुदाय चैट खोलें'],
      settings: ['Change setting', 'सेटिंग बदलें'],
    };
    if (!(kid && (a.type === 'chat' || a.type === 'settings'))) {
      blocks = [{ type: 'action', action: a, label: pick(label[a.type] ?? label.map, lang) }];
    }
  }

  if (blocks.length === 0) {
    return {
      blocks: [{ type: 'text', text: pick(NO_MATCH[persona], lang) }, { type: 'chips', items: chipsFor(persona, lang) }],
      speech: pick(NO_MATCH[persona], lang),
      source: 'none',
      confidence: 0,
    };
  }
  return { blocks, speech: speechOf(blocks), source: r.source, confidence: r.confidence };
}

export const suggestedTopics = (lang: Lang) => ({
  firstAid: FIRST_AID.slice(0, 8).map((g) => ({ id: g.id, label: pick(g.title, lang), emoji: g.emoji })),
  disasters: DISASTERS.map((d) => ({ id: d.id, label: pick(d.title, lang), emoji: d.emoji })),
});
