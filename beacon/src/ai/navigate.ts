// Fast, deterministic voice-to-screen matcher. No model, no network: it only answers "which screen does this phrase name?".
// Anything it does not recognise returns null, and the caller falls back to the keyword/Needle router or the persona chat.
//
// Matching: the text is normalised (case, punctuation, Unicode NFC), filler words ("please", "open", "show me", "खोलो", ...)
// are dropped, and what is left must equal a known alias exactly. Exact matching keeps "open map" -> map while
// "I want to report a flood" does not get hijacked into a navigation.

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

const ENTRIES: Entry[] = [
  // Screens
  { aliases: ['map', 'maps', 'nakshe', 'naksha', 'नक्शा', 'नक्शे', 'नक़्शा', 'नक़्शे', 'मानचित्र'], route: '/map', label: 'Opening map' },
  { aliases: ['settings', 'setting', 'preferences', 'सेटिंग', 'सेटिंग्स', 'सेटींग'], route: '/settings', label: 'Opening settings' },
  { aliases: ['go bag', 'gobag', 'emergency bag', 'गो बैग', 'गोबैग', 'इमरजेंसी बैग'], route: '/gobag', label: 'Opening go bag' },
  { aliases: ['drill', 'drills', 'start drill', 'start drills', 'mock drill', 'practice', 'ड्रिल', 'अभ्यास', 'अभ्यास करो'], route: '/drills', label: 'Opening drills' },
  { aliases: ['medical id', 'medical', 'medical card', 'medical info', 'मेडिकल', 'मेडिकल आईडी', 'मेडिकल कार्ड'], route: '/medical', label: 'Opening medical ID' },
  { aliases: ['family', 'parivar', 'परिवार'], route: '/family', label: 'Opening family' },
  { aliases: ['hub', 'हब'], route: '/hub', label: 'Opening hub' },
  { aliases: ['report', 'report something', 'report incident', 'report problem', 'रिपोर्ट', 'शिकायत'], route: '/report/new', label: 'Opening report' },
  { aliases: ['first aid', 'aid', 'प्राथमिक उपचार', 'फ़र्स्ट एड', 'फर्स्ट एड'], route: '/adult/aid', label: 'Opening first aid' },

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
  const hit = INDEX.get(core(text));
  return hit ? { route: hit.route, label: hit.label } : null;
}
