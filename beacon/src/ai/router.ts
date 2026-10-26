import { searchDisasters, searchGuides } from '../kb';
import { type Action, type PlaceKind, type ToolCall, toAction } from './tools';

/** What the native Needle engine looks like from TypeScript. */
export interface NeedleEngine {
  complete(text: string): Promise<{ calls: ToolCall[]; confidence: number | null }>;
}

export interface RouteResult {
  action: Action;
  source: 'needle' | 'keywords';
  /** 0..1. Below CONFIRM_BELOW the UI should ask "did you mean ...?" before acting. */
  confidence: number;
  /** Other plausible guides, so the screen can offer "not what you meant?" */
  alternatives: string[];
  /** Guide ids to offer as a clarifying question. Set instead of steps when the match is unsure. */
  ask?: string[];
  /** Second-best tool calls from the model, as actions (for "or did you mean ...?"). */
  options?: Action[];
}

export const CONFIRM_BELOW = 0.7;

const rx = (...parts: string[]) => new RegExp(parts.join('|'), 'iu');

const INTENTS: { test: RegExp; action: Action }[] = [
  { test: rx('\\b(call|dial)\\b.*\\b(112|police|ambulance|emergency)\\b', '\\b112\\b', 'एम्बुलेंस|एंबुलेंस', 'आपातकालीन नंबर'), action: { type: 'call112' } },
  { test: rx('\\bi am safe\\b', "\\bi'?m safe\\b", '\\bmark (me )?safe\\b', 'मैं सुरक्षित', 'main surakshit', 'सुरक्षित हूँ'), action: { type: 'safe' } },
  { test: rx('\\bsos\\b', '\\bsave me\\b', '\\brescue me\\b', '\\bsend help\\b', '\\bi am in danger\\b', 'बचाओ', 'मुझे बचा', 'खतरे में'), action: { type: 'sos' } },
  { test: rx('\\balerts?\\b', '\\bwarnings?\\b', '\\bnews\\b', 'चेतावनी', 'अलर्ट', 'ख़बर|खबर'), action: { type: 'alerts' } },
  { test: rx('\\bchat\\b', '\\btalk to (people|neighbou?rs)\\b', 'चैट', 'बात करना'), action: { type: 'chat' } },
  { test: rx('\\bhindi\\b', 'हिंदी|हिन्दी'), action: { type: 'settings', setting: 'hindi' } },
  { test: rx('\\benglish\\b', 'अंग्रेज़ी|अंग्रेजी'), action: { type: 'settings', setting: 'english' } },
  { test: rx('\\b(bigger|large|larger) (text|font)\\b', 'बड़े अक्षर|बड़ा टेक्स्ट'), action: { type: 'settings', setting: 'large_text' } },
  { test: rx('\\bhigh contrast\\b'), action: { type: 'settings', setting: 'high_contrast' } },
  { test: rx('\\bread (it )?(out|aloud)\\b', 'पढ़कर सुनाओ|पढ़ो'), action: { type: 'settings', setting: 'read_aloud' } },
];

const PLACE_WORDS: [PlaceKind, RegExp][] = [
  ['shelter', rx('\\bshelters?\\b', '\\brefuge\\b', '\\brelief camp\\b', 'आश्रय|शरण|राहत शिविर')],
  ['hospital', rx('\\bhospitals?\\b', '\\bclinic\\b', '\\bdoctor\\b', 'अस्पताल|क्लिनिक|डॉक्टर')],
  ['water', rx('\\b(drinking )?water point\\b', '\\bwater (source|supply)\\b', 'पानी का स्थान|पीने का पानी कहाँ')],
  ['police', rx('\\bpolice\\b', 'पुलिस|थाना')],
  ['pharmacy', rx('\\bpharmacy\\b', '\\bmedical store\\b', '\\bchemist\\b', 'दवाई की दुकान|दवा की दुकान|फ़ार्मेसी|फार्मेसी')],
];

const FIND = rx('\\b(find|nearest|nearby|closest|where|locate|show)\\b', 'पास|नज़दीक|नजदीक|कहाँ|कहां|ढूँढ|ढूंढ');

// A clause that says what is NOT happening ("not bleeding", "no blood", "नहीं") must not route to that topic.
const NEGATED = /\b(not|no|never|without|nothing|isn't|aren't|don't|doesn't|didn't|cannot|can't)\b|नहीं|नही|बिना/iu;

/** Drop every clause (split on punctuation, "and", "but") that contains a negation. Keeps the rest of the words. */
// "not breathing" or "not conscious" is an emergency, so those clauses are always kept (they route to CPR and recovery)
const KEEP_NEGATED = /breath|conscious|respon|pulse|awake|साँस|होश/iu;

export function stripNegated(text: string): string {
  return text
    .split(/[.,;!?]|\band\b|\bbut\b|\bor\b|और|लेकिन/iu)
    .filter((clause) => clause.trim() && (!NEGATED.test(clause) || KEEP_NEGATED.test(clause)))
    .join(' ')
    .trim();
}

/**
 * Phrases where a first-aid word means something else. These never route to a guide: they ask the person what they
 * meant (an empty list means "no first-aid match at all").
 */
const AMBIGUOUS: { test: RegExp; ask: string[] }[] = [
  { test: rx('\\bburning (smell|smells|odou?r)\\b', '\\bsmells? (of |like )?burn', '\\bsmell of burning\\b'), ask: ['smoke-fire', 'burns'] },
  { test: rx('\\bcut (a |the |an |some )?(bandage|cake|bread|paper|rope|wire|cloth|hair|onion|fruit|vegetables?|tape)\\b'), ask: ['cloth-bandage'] },
  { test: rx('\\bsting operation\\b', '\\bsting (video|movie|film|show)\\b'), ask: [] },
];

function clarify(ask: string[], confidence: number): RouteResult {
  return { action: { type: 'none' }, source: 'keywords', confidence, alternatives: [], ask };
}

// Life-threatening states are matched first and answered directly. Never a guess, never a question.
const CPR_STATE = rx('\\bnot breathing\\b', "\\bisn'?t breathing\\b", '\\bstopped breathing\\b', '\\bno pulse\\b', '\\bnot breathe\\b', 'साँस नहीं|साँस बंद');
const UNCONSCIOUS_STATE = rx('\\bunconscious\\b', '\\bpassed out\\b', '\\bnot responding\\b', '\\bnot conscious\\b', '\\bwon\'?t wake\\b', 'बेहोश|होश नहीं');
const BREATH_TROUBLE = rx("\\bcan'?t breathe\\b", '\\bcannot breathe\\b', '\\btrouble breathing\\b', '\\bdifficulty breathing\\b', '\\bstruggling to breathe\\b', '\\bgasping\\b', 'साँस लेने में दिक़्क़त|साँस लेने में दिक्कत');

/** Words that stem badly in the guide search ("burnt" is not "burn"). */
const NORMALISE: [RegExp, string][] = [
  [/\bburnt\b/giu, 'burn'],
  [/\bscalded\b/giu, 'scald'],
  [/\bbitten\b/giu, 'bite'],
  [/\bstung\b/giu, 'sting'],
];

function keywordRoute(text: string): RouteResult {
  const t = text.trim();
  if (!t) return { action: { type: 'none' }, source: 'keywords', confidence: 0, alternatives: [] };

  for (const a of AMBIGUOUS) if (a.test.test(t)) return clarify(a.ask, 0.5);

  if (CPR_STATE.test(t)) return { action: { type: 'guide', id: 'cpr-adult' }, source: 'keywords', confidence: 0.95, alternatives: [] };
  if (UNCONSCIOUS_STATE.test(t)) return { action: { type: 'guide', id: 'recovery-position' }, source: 'keywords', confidence: 0.95, alternatives: [] };
  // trouble breathing has several causes, so the person chooses; the emergency number is always the first answer
  if (BREATH_TROUBLE.test(t)) return clarify(['choking-adult', 'asthma'], 0.5);

  for (const i of INTENTS) if (i.test.test(t)) return { action: i.action, source: 'keywords', confidence: 0.9, alternatives: [] };

  if (FIND.test(t)) {
    for (const [place, re] of PLACE_WORDS) if (re.test(t)) return { action: { type: 'map', place }, source: 'keywords', confidence: 0.85, alternatives: [] };
  }

  const guides = searchGuides(t, { limit: 4 });
  const disasters = searchDisasters(t);
  const g = guides[0];
  const d = disasters[0];
  if (d && (!g || d.score > g.score)) {
    return { action: { type: 'disaster', id: d.item.id }, source: 'keywords', confidence: Math.min(0.9, 0.4 + d.score * 0.15), alternatives: [] };
  }
  if (g) {
    // confidence grows with how many words matched and how far ahead of the runner-up it is
    const margin = g.score - (guides[1]?.score ?? 0);
    const conf = Math.min(0.9, 0.35 + g.score * 0.1 + margin * 0.1);
    // unsure: ask first, do not give steps for a guess
    if (conf < CONFIRM_BELOW) return clarify([g.item.id, ...guides.slice(1).map((x) => x.item.id)].slice(0, 3), conf);
    return { action: { type: 'guide', id: g.item.id }, source: 'keywords', confidence: conf, alternatives: guides.slice(1).map((x) => x.item.id) };
  }
  return { action: { type: 'none' }, source: 'keywords', confidence: 0, alternatives: [] };
}

/**
 * Text (typed, spoken or described from a photo) -> the thing the app should do.
 * Needle picks the tool when the native engine is present; otherwise, or when it declines,
 * the offline keyword router answers. The *content* shown afterwards always comes from the curated KB.
 */
export async function route(input: string, engine?: NeedleEngine | null): Promise<RouteResult> {
  const text = NORMALISE.reduce((s, [re, to]) => s.replace(re, to), input);
  // negated clauses are removed first, for both Needle and the keyword router ("not bleeding" must not show bleeding steps)
  const q = stripNegated(text);
  if (!q) return keywordRoute('');
  for (const a of AMBIGUOUS) if (a.test.test(q)) return clarify(a.ask, 0.5);
  const fallback = keywordRoute(q);
  if (!engine) return fallback;
  try {
    const r = await engine.complete(q);
    const call = r.calls[0];
    if (call) {
      const action = toAction(call);
      if (action.type !== 'none') {
        const confidence = r.confidence ?? 0.75;
        if (action.type === 'guide' && confidence < CONFIRM_BELOW) return clarify([action.id, ...fallback.alternatives].slice(0, 3), confidence);
        // If Needle's pick disagrees with a strong keyword result for an emergency, surface the keyword guide as an alternative.
        const alts = fallback.action.type === 'guide' && JSON.stringify(fallback.action) !== JSON.stringify(action) ? [fallback.action.id, ...fallback.alternatives] : fallback.alternatives;
        const options = r.calls
          .slice(1, 4)
          .map(toAction)
          .filter((x) => x.type !== 'none' && JSON.stringify(x) !== JSON.stringify(action));
        return { action, source: 'needle', confidence, alternatives: alts, options };
      }
    }
  } catch {
    /* engine failed: fall through to keywords */
  }
  return fallback;
}
