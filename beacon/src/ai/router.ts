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

function keywordRoute(text: string): RouteResult {
  const t = text.trim();
  if (!t) return { action: { type: 'none' }, source: 'keywords', confidence: 0, alternatives: [] };

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
    return { action: { type: 'guide', id: g.item.id }, source: 'keywords', confidence: conf, alternatives: guides.slice(1).map((x) => x.item.id) };
  }
  return { action: { type: 'none' }, source: 'keywords', confidence: 0, alternatives: [] };
}

/**
 * Text (typed, spoken or described from a photo) -> the thing the app should do.
 * Needle picks the tool when the native engine is present; otherwise, or when it declines,
 * the offline keyword router answers. The *content* shown afterwards always comes from the curated KB.
 */
export async function route(text: string, engine?: NeedleEngine | null): Promise<RouteResult> {
  const fallback = keywordRoute(text);
  if (!engine || !text.trim()) return fallback;
  try {
    const r = await engine.complete(text);
    const call = r.calls[0];
    if (call) {
      const action = toAction(call);
      if (action.type !== 'none') {
        const confidence = r.confidence ?? 0.75;
        // If Needle's pick disagrees with a strong keyword result for an emergency, surface the keyword guide as an alternative.
        const alts = fallback.action.type === 'guide' && JSON.stringify(fallback.action) !== JSON.stringify(action) ? [fallback.action.id, ...fallback.alternatives] : fallback.alternatives;
        return { action, source: 'needle', confidence, alternatives: alts };
      }
    }
  } catch {
    /* engine failed: fall through to keywords */
  }
  return fallback;
}
