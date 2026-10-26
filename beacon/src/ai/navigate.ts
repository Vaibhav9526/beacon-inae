// Fast, deterministic voice-to-screen matcher. No model, no network: it only answers "which screen does this phrase name?".
// Anything it does not recognise returns null, and the caller falls back to the keyword/Needle router or the persona chat.
//
// Matching: the text is normalised (case, punctuation, Unicode NFC), filler words ("please", "open", "show me", "खोलो", ...)
// are dropped, and what is left must equal a known alias exactly. Exact matching keeps "open map" -> map while
// "I want to report a flood" does not get hijacked into a navigation.

import { getDisaster, getGuide, pick } from '../kb';
import type { Lang } from '../kb/types';
import { fuzzyAliasScore } from './fuzzy';
import { SCREENS, addHints } from './intents';
import { CONFIRM_BELOW, route, stripNegated, type NeedleEngine, type RouteResult } from './router';
import { FIRST_AID_TOPICS, type Action, isNavigation, needsConfirmation } from './tools';

export interface NavigationTarget {
  route: string;
  label: string;
}

const FILLER = new Set(
  [
    // English
    'please', 'pls', 'plz', 'kindly', 'now', 'quickly', 'open', 'show', 'go', 'to', 'take', 'me', 'can', 'you', 'the', 'a', 'an',
    'my', 'i', 'want', 'need', 'see', 'view', 'visit', 'screen', 'page', 'tab', 'section', 'guide', 'let', 'lets', 'hi', 'hey', 'beacon',
    // Hinglish
    'kholo', 'khol', 'kholiye', 'kholen', 'dikhao', 'dikhaao', 'dikhaiye', 'dikha', 'dekho', 'batao', 'jao', 'jaao', 'le', 'chalo',
    'mujhe', 'mera', 'meri', 'mere', 'ko', 'ka', 'ki', 'ke', 'mein', 'main', 'kar', 'karo', 'karen', 'do', 'chahiye', 'hai',
    // Devanagari
    'खोलो', 'खोलिए', 'खोलें', 'खोल', 'दिखाओ', 'दिखाइए', 'दिखा', 'बताओ', 'जाओ', 'मुझे', 'मेरा', 'मेरी', 'मेरे',
    'को', 'का', 'की', 'के', 'में', 'मैं', 'करो', 'कर', 'दो', 'चाहिए', 'दिखाएं', 'गाइड',
  ].map((w) => w.normalize('NFC')),
);

/** Lower-case, NFC, punctuation to spaces, single spaces. Devanagari combining marks are kept. */
export function normaliseSpeech(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalised words with filler removed. */
function core(text: string): string {
  return normaliseSpeech(text)
    .split(' ')
    .filter((w) => w && !FILLER.has(w))
    .join(' ');
}

interface Entry {
  aliases: string[];
  route: string;
  label: string;
}

const GUIDE_ENTRIES: Entry[] = [
  // First-aid guides (ids from src/kb/firstaid.ts)
  { aliases: ['bleeding', 'severe bleeding', 'खून बहना', 'खून'], route: '/guide/severe-bleeding', label: 'Opening bleeding guide' },
  { aliases: ['cpr', 'सीपीआर'], route: '/guide/cpr-adult', label: 'Opening CPR guide' },
  { aliases: ['burn', 'burns', 'जलना'], route: '/guide/burns', label: 'Opening burns guide' },
  { aliases: ['snake bite', 'snakebite', 'साँप'], route: '/guide/snake-bite', label: 'Opening snake bite guide' },
  { aliases: ['choking', 'choke'], route: '/guide/choking-adult', label: 'Opening choking guide' },
  { aliases: ['fracture', 'broken bone'], route: '/guide/fracture', label: 'Opening fracture guide' },
  { aliases: ['heart attack'], route: '/guide/heart-attack', label: 'Opening heart attack guide' },
  { aliases: ['stroke'], route: '/guide/stroke', label: 'Opening stroke guide' },
  { aliases: ['drowning'], route: '/guide/drowning', label: 'Opening drowning guide' },
  { aliases: ['fire', 'smoke fire', 'आग'], route: '/guide/smoke-fire', label: 'Opening fire guide' },

  // Disaster guides (ids from src/kb/disasters.ts)
  { aliases: ['earthquake', 'quake', 'भूकंप', 'भूकम्प'], route: '/disaster/earthquake', label: 'Opening earthquake guide' },
  { aliases: ['flood', 'floods', 'बाढ़', 'बाढ'], route: '/disaster/flood', label: 'Opening flood guide' },
  { aliases: ['cyclone', 'hurricane', 'typhoon', 'चक्रवात', 'तूफ़ान', 'तूफान'], route: '/disaster/cyclone', label: 'Opening cyclone guide' },
  { aliases: ['landslide', 'landslides', 'भूस्खलन'], route: '/disaster/landslide', label: 'Opening landslide guide' },
  { aliases: ['heatwave', 'heat wave', 'loo', 'लू'], route: '/disaster/heatwave', label: 'Opening heatwave guide' },
  { aliases: ['lightning', 'आसमानी बिजली'], route: '/disaster/lightning', label: 'Opening lightning guide' },
  { aliases: ['tsunami', 'सुनामी'], route: '/disaster/tsunami', label: 'Opening tsunami guide' },
];

// Screens come from the shared SCREENS table (src/ai/intents.ts); guides and disasters are listed above.
const ENTRIES: Entry[] = [
  ...Object.values(SCREENS).map((sc) => ({ aliases: sc.aliases, route: sc.route, label: `Opening ${sc.en}` })),
  ...GUIDE_ENTRIES,
];

const INDEX = new Map<string, NavigationTarget>();
for (const e of ENTRIES) {
  for (const alias of e.aliases) {
    const key = core(alias);
    if (key && !INDEX.has(key)) INDEX.set(key, { route: e.route, label: e.label });
  }
}

/**
 * Map a spoken or typed phrase to an app screen. Returns null when the phrase is not a navigation request,
 * including calls (112) and "I am safe", which the keyword router handles as actions.
 */
export function parseNavigation(text: string): NavigationTarget | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  let hit = INDEX.get(core(text));
  // "first aid for burns" / "first aid on snake bite": the topic after the prefix is the guide
  if (!hit) {
    const topic = normaliseSpeech(text).replace(/^(first aid|प्राथमिक उपचार)\s+(for|on|of|about|के लिए|पर)?\s*/u, '');
    if (topic && topic !== normaliseSpeech(text)) hit = INDEX.get(core(topic));
  }
  return hit ? { route: hit.route, label: hit.label } : null;
}

/** Static (non-guide) routes this file can return. Each one must exist in SCREENS (checked in the tests). */
export const NAVIGATION_ROUTES: string[] = [...new Set(ENTRIES.map((e) => e.route).filter((r) => !r.startsWith('/guide/') && !r.startsWith('/disaster/')))];

// ---------------------------------------------------------------------------------------------------------------------
// Voice pipeline: emergencies -> exact phrases -> (on-device model) -> keyword guesses -> chip. Pure logic, no UI.
// ---------------------------------------------------------------------------------------------------------------------

export interface Choice {
  action: Action;
  label: string;
}

export type Decision =
  /** Life-threatening words: open the guide at once and offer to call 112. Never waits for the model. */
  | { kind: 'emergency'; guideId: string; label: string; say: string; callQuestion: string }
  /** Safe to do now. `route` is set for exact-phrase screens, `action` for everything else. */
  | { kind: 'run'; label: string; route?: string; action?: Action; undo: boolean; source: 'fast' | 'model' | 'keywords' }
  /** Ask first: "Did you mean: X?" with Yes/No and up to two other guesses. */
  | { kind: 'confirm'; question: string; primary: Choice; alternatives: Choice[]; source: 'model' | 'keywords' }
  /** Nothing understood: offer the persona chat. */
  | { kind: 'chip' };

const L = (lang: Lang, en: string, hi: string) => (lang === 'hi' ? hi : en);

/** Three commands the app always offers when it does not understand (shown on screen and read aloud). */
export const EXAMPLE_COMMANDS = ['open weather', 'first aid for burns', 'call 112'] as const;

/** Every line the voice mic says or shows. Each one is spoken and written, so the user always gets feedback. */
export const VOICE_TEXT = {
  listening: (l: Lang) => L(l, 'Listening... keep holding and speak', 'सुन रहा हूँ... बटन दबाए रखें और बोलें'),
  holdToTalk: (l: Lang) => L(l, 'Hold to talk', 'बोलने के लिए दबाए रखें'),
  working: (l: Lang) => L(l, 'Working on it...', 'काम हो रहा है...'),
  cancelled: (l: Lang) => L(l, 'Cancelled', 'रद्द किया'),
  notHeard: (l: Lang) => L(l, 'I did not catch that, try again', 'मुझे समझ नहीं आया, दोबारा कोशिश करें'),
  /** The card for speech we could not map to an action: what was heard, then the three examples. */
  heardUnknown: (text: string, l: Lang) =>
    L(
      l,
      `I heard: "${text}". Try: ${EXAMPLE_COMMANDS.map((c) => `"${c}"`).join(', ')}`,
      `मैंने सुना: "${text}"। ऐसे कहें: ${EXAMPLE_COMMANDS.map((c) => `"${c}"`).join(', ')}`,
    ),
  tooShort: (l: Lang) => L(l, 'Hold the button a little longer and speak', 'बटन दबाए रखें और थोड़ा और बोलें'),
  micOff: (l: Lang) =>
    L(l, 'Microphone is off. Allow Beacon to use the microphone in the phone settings', 'माइक्रोफ़ोन बंद है। फ़ोन की सेटिंग में Beacon को माइक्रोफ़ोन की अनुमति दें'),
  noRecogniser: (l: Lang) =>
    L(l, 'Voice input is not available on this phone. Install or update the Google speech service, or type the command', 'इस फ़ोन पर आवाज़ से आदेश उपलब्ध नहीं है। Google speech सेवा लगाएँ, या आदेश लिखें'),
  recogniserError: (l: Lang) => L(l, 'The speech recogniser stopped. Try again, or type the command', 'आवाज़ पहचानने वाला रुक गया। दोबारा कोशिश करें या आदेश लिखें'),
  unknown: (l: Lang) =>
    L(
      l,
      `I did not understand. Try: ${EXAMPLE_COMMANDS.map((c) => `"${c}"`).join(', ')}`,
      `मैं समझ नहीं पाया। ऐसे कहें: ${EXAMPLE_COMMANDS.map((c) => `"${c}"`).join(', ')}`,
    ),
  error: (l: Lang) => L(l, 'Something went wrong. Please try again', 'कुछ गड़बड़ हो गई। दोबारा कोशिश करें'),
  heard: (text: string, l: Lang) => L(l, `Heard: "${text}"`, `सुना: "${text}"`),
  typeHint: (l: Lang) => L(l, 'Type a command', 'आदेश लिखें'),
  typeInstead: (l: Lang) => L(l, 'Type instead', 'लिखकर बताएँ'),
  askDidi: (l: Lang) => L(l, 'Ask Didi', 'दीदी से पूछें'),
  openSettings: (l: Lang) => L(l, 'Open settings', 'सेटिंग खोलें'),
  done: (l: Lang) => L(l, 'Done', 'हो गया'),
};

const PLACE_NAMES: Record<string, [string, string]> = {
  shelter: ['shelter', 'आश्रय'],
  hospital: ['hospital', 'अस्पताल'],
  water: ['drinking water', 'पीने का पानी'],
  police: ['police station', 'पुलिस थाना'],
  pharmacy: ['pharmacy', 'दवाई की दुकान'],
};

/** Short phrase for an action. `open` is the "Opening X" toast, `ask` is the "Did you mean: X?" wording. */
export function describeAction(a: Action, lang: Lang = 'en'): { open: string; ask: string } {
  const both = (name: string) => ({
    open: L(lang, `Opening ${name}`, `${name} खोल रहा हूँ`),
    ask: L(lang, `Open ${name}`, `${name} खोलें`),
  });
  switch (a.type) {
    case 'screen': {
      const s = SCREENS[a.id];
      return both(L(lang, s?.en ?? a.id, s?.hi ?? a.id));
    }
    case 'guide':
      return both(pick(getGuide(a.id)?.title ?? [a.id, a.id], lang));
    case 'disaster':
      return both(pick(getDisaster(a.id)?.title ?? [a.id, a.id], lang));
    case 'map': {
      const n = PLACE_NAMES[a.place] ?? [a.place, a.place];
      return { open: L(lang, `Opening the nearest ${n[0]}`, `सबसे नज़दीकी ${n[1]} खोल रहा हूँ`), ask: L(lang, `Find the nearest ${n[0]}`, `सबसे नज़दीकी ${n[1]} ढूँढें`) };
    }
    case 'alerts':
      return both(L(lang, 'alerts', 'अलर्ट'));
    case 'chat':
      return both(L(lang, 'community chat', 'समुदाय चैट'));
    case 'lifeboat':
      return both(L(lang, 'lifeboat mode', 'लाइफबोट'));
    case 'sos':
      return { open: L(lang, 'Sending SOS', 'SOS भेज रहा हूँ'), ask: L(lang, 'Send an SOS', 'SOS भेजें') };
    case 'safe':
      return { open: L(lang, 'Telling family you are safe', 'परिवार को बता रहा हूँ कि आप सुरक्षित हैं'), ask: L(lang, 'Tell family you are safe', 'परिवार को बताएँ कि आप सुरक्षित हैं') };
    case 'call112':
      return { open: L(lang, 'Calling 112', '112 मिला रहा हूँ'), ask: L(lang, 'Call 112', '112 पर कॉल करें') };
    case 'drill':
      return { open: L(lang, `Opening the ${a.scenario} drill`, `${a.scenario} ड्रिल खोल रहा हूँ`), ask: L(lang, `Start a ${a.scenario} drill`, `${a.scenario} ड्रिल शुरू करें`) };
    case 'road':
      return { open: L(lang, 'Opening road report', 'सड़क रिपोर्ट खोल रहा हूँ'), ask: L(lang, `Report a ${a.status} road`, `सड़क की रिपोर्ट करें: ${a.status}`) };
    case 'settings':
      return { open: L(lang, 'Setting changed', 'सेटिंग बदल दी'), ask: L(lang, `Change setting: ${a.setting.replace('_', ' ')}`, `सेटिंग बदलें: ${a.setting}`) };
    default:
      return { open: '', ask: '' };
  }
}

// --- emergencies -----------------------------------------------------------------------------------------------------

const rx = (...p: string[]) => new RegExp(p.join('|'), 'iu');

// Matched on the text with negated clauses removed, so "he is not bleeding" never opens the bleeding guide.
const EMERGENCIES: { topic: keyof typeof FIRST_AID_TOPICS; test: RegExp; raw?: boolean }[] = [
  { topic: 'not_breathing', test: rx('\\bnot breathing\\b', "\\bisn'?t breathing\\b", '\\bstopped breathing\\b', '\\bno pulse\\b', '\\bcardiac arrest\\b', '\\bheart stopped\\b', 'साँस नहीं|सांस नहीं|साँस बंद|सांस बंद|साँस रुक|सांस रुक|sans nahi|saans nahi') },
  { topic: 'chest_pain', test: rx('\\bheart attack\\b', '\\bchest pain\\b', '\\bpain in (my |his |her |the )?chest\\b', '\\bchest (hurts|is hurting|tight)', 'दिल का दौरा|हार्ट अटैक|सीने में दर्द|छाती में दर्द|seene mein dard|dil ka daura'), raw: true },
  { topic: 'trapped', test: rx('\\btrapped\\b', '\\bstuck under\\b', '\\bburied\\b', '\\bunder the (rubble|debris)\\b', 'फ[ँं]स ?(गया|गई|गए|गयी|रहा|रही)|मलबे में|phans gaya|phas gaya|phans gayi'), raw: true },
  { topic: 'bleeding', test: rx('\\bbleeding (badly|heavily|a lot|profusely|non ?stop)', "\\bwon'?t stop bleeding\\b", '\\bblood everywhere\\b', '\\blosing (a lot of )?blood\\b', 'बहुत खून|खून बह रहा|खून नहीं रुक|khoon bah raha|bahut khoon') },
  { topic: 'snake_bite', test: rx('\\bsnake ?bite\\b', '\\bbitten by (a )?snake\\b', '\\bsnake (bit|bite)\\b', 'साँप ने काट|सांप ने काट|साँप काटा|सांप काटा|saanp ne kaat|saap ne kaat'), raw: true },
  { topic: 'unconscious', test: rx('\\bunconscious\\b', '\\bpassed out\\b', '\\bnot responding\\b', 'बेहोश|behosh') },
  { topic: 'choking', test: rx('\\bchoking\\b', '\\bchoked\\b', 'दम घुट|गले में अटक|gale mein atak') },
  { topic: 'drowning', test: rx('\\bdrowning\\b', 'डूब रहा|डूब रही|doob raha|doob rahi'), raw: true },
  { topic: 'stroke', test: rx('\\bhaving a stroke\\b', '\\bface (is )?drooping\\b', 'लकवा|lakwa') },
  { topic: 'electric_shock', test: rx('\\belectric shock\\b', '\\belectrocuted\\b', 'करंट लग|current lag') },
  { topic: 'poison', test: rx('\\bpoison(ed|ing)?\\b', 'ज़हर|जहर|zehar') },
];

/** Life-threatening wording -> the first-aid guide to open at once. Deterministic: this runs before the model. */
export function detectEmergency(text: string): { topic: string; guideId: string } | null {
  const raw = (text ?? '').normalize('NFC');
  if (!raw.trim()) return null;
  const kept = stripNegated(raw);
  for (const e of EMERGENCIES) {
    // the Hindi "not" (नहीं) sits in many positive sentences ("निकल नहीं पा रहा"), so these also test the full text
    if (e.test.test(kept) || (e.raw && e.test.test(raw) && !/\b(not|no|never)\b/iu.test(raw))) {
      const guideId = FIRST_AID_TOPICS[e.topic];
      if (guideId) return { topic: e.topic, guideId };
    }
  }
  return null;
}

// --- keyword guesses for screens (never run on their own, only offered) ------------------------------------------------

const GUESS_SKIP = new Set(['home', 'more', 'privacy', 'update']);

/** Screens whose alias appears somewhere in the text, best first. Used for "Did you mean" and when the model is off. */
export function guessScreens(text: string): string[] {
  const padded = ` ${normaliseSpeech(text)} `;
  if (padded.trim() === '') return [];
  const scored: [string, number][] = [];
  for (const [id, s] of Object.entries(SCREENS)) {
    if (GUESS_SKIP.has(id)) continue;
    let best = 0;
    for (const alias of s.aliases) {
      const a = normaliseSpeech(alias);
      if (a && padded.includes(` ${a} `)) best = Math.max(best, a.length + a.split(' ').length * 3);
    }
    if (best) scored.push([id, best]);
  }
  if (scored.length === 0) {
    // nothing matched exactly: allow a letter or two to be mis-heard ("open whether" -> weather)
    const tokens = core(text).split(' ').filter(Boolean);
    for (const [id, s] of Object.entries(SCREENS)) {
      if (GUESS_SKIP.has(id)) continue;
      let best = 0;
      for (const alias of s.aliases) {
        const a = normaliseSpeech(alias);
        if (a) best = Math.max(best, fuzzyAliasScore(tokens, a));
      }
      if (best) scored.push([id, best]);
    }
  }
  return scored.sort((x, y) => y[1] - x[1]).map(([id]) => id);
}

// --- the pipeline ----------------------------------------------------------------------------------------------------

const dev = () => typeof __DEV__ !== 'undefined' && __DEV__;

export interface InterpretOptions {
  lang?: Lang;
  /** How long the model gets before the keyword router answers instead. */
  timeoutMs?: number;
  /** Override the dev-only logging (tests). */
  log?: boolean;
}

export const MODEL_TIMEOUT_MS = 4000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

const sameAction = (a: Action, b: Action) => JSON.stringify(a) === JSON.stringify(b);

function toChoice(a: Action, lang: Lang): Choice {
  return { action: a, label: describeAction(a, lang).ask };
}

function confirm(primary: Action, others: Action[], source: 'model' | 'keywords', lang: Lang): Decision {
  const alts: Action[] = [];
  for (const o of others) if (o.type !== 'none' && !sameAction(o, primary) && !alts.some((x) => sameAction(x, o))) alts.push(o);
  const p = toChoice(primary, lang);
  return {
    kind: 'confirm',
    question: L(lang, `Did you mean: ${p.label}?`, `क्या आपका मतलब था: ${p.label}?`),
    primary: p,
    alternatives: alts.slice(0, 2).map((a) => toChoice(a, lang)),
    source,
  };
}

const screenActions = (text: string): Action[] => guessScreens(text).map((id) => ({ type: 'screen', id }));

/**
 * One spoken or typed sentence -> what the app should do. Order: emergency words (instant, no model), exact phrases
 * (instant, no model), the on-device model (4 s limit), keyword guesses, the Didi chip. Sending or calling anything is
 * never decided by a guess: those always come back as `confirm`.
 */
export async function interpret(text: string, engine: NeedleEngine | null | undefined, opts: InterpretOptions = {}): Promise<Decision> {
  const lang = opts.lang ?? 'en';
  const log = opts.log ?? dev();
  const say = (...args: unknown[]) => {
    if (log) console.debug('[voice]', ...args);
  };
  const input = (text ?? '').trim();
  if (!input) return { kind: 'chip' };

  // 1. emergencies: deterministic, before anything else
  const em = detectEmergency(input);
  if (em) {
    const title = pick(getGuide(em.guideId)?.title ?? [em.guideId, em.guideId], lang);
    say('emergency', em);
    return {
      kind: 'emergency',
      guideId: em.guideId,
      label: title,
      say: L(lang, `Call 112 now. Opening ${title}.`, `अभी 112 पर कॉल करें। ${title} खोल रहा हूँ।`),
      callQuestion: L(lang, 'Call 112?', '112 पर कॉल करें?'),
    };
  }

  // 2. exact phrases: instant, no model
  const nav = parseNavigation(input);
  if (nav) {
    say('fast path', nav);
    return { kind: 'run', label: nav.label, route: nav.route, undo: true, source: 'fast' };
  }

  // 3. explicit "call 112" / "I am safe" (keyword router, no model)
  const kw = await route(input);
  if ((kw.action.type === 'call112' || kw.action.type === 'safe') && kw.confidence >= CONFIRM_BELOW) {
    return { kind: 'run', label: describeAction(kw.action, lang).open, action: kw.action, undo: false, source: 'keywords' };
  }

  // 4. the on-device model, with a time limit; any failure falls back to the keyword result
  let r: RouteResult = kw;
  if (engine) {
    const logged: NeedleEngine = {
      async complete(t) {
        const hinted = addHints(t);
        const out = await engine.complete(hinted);
        say('model returned', { request: hinted, calls: out.calls, confidence: out.confidence });
        return out;
      },
    };
    try {
      r = await withTimeout(route(input, logged), opts.timeoutMs ?? MODEL_TIMEOUT_MS);
    } catch (e) {
      say('model unavailable, using keywords:', String((e as Error)?.message ?? e));
      r = kw;
    }
  }
  const source: 'model' | 'keywords' = r.source === 'needle' ? 'model' : 'keywords';
  const guesses = screenActions(input);

  // unsure guide: offer the likely guides
  if (r.ask && r.ask.length) {
    const guides: Action[] = r.ask.map((id) => ({ type: 'guide', id }));
    return confirm(guides[0], guides.slice(1), source, lang);
  }

  const a = r.action;
  if (a.type === 'none') {
    // keyword guesses at a screen are only ever offered, never opened
    if (guesses.length) return confirm(guesses[0], guesses.slice(1), 'keywords', lang);
    return { kind: 'chip' };
  }

  const others = [...(r.options ?? []), ...guesses];
  if (needsConfirmation(a)) return confirm(a, others, source, lang);
  if (r.confidence < CONFIRM_BELOW) return confirm(a, others, source, lang);
  return { kind: 'run', label: describeAction(a, lang).open, action: a, undo: isNavigation(a), source: source === 'model' ? 'model' : 'keywords' };
}
