// One source of truth for every screen a voice command can open. navigate.ts (exact phrases), tools.ts (the model's
// `open_screen` enum) and actions.ts (router.navigate) all read this table, so they cannot drift apart.
//
// Keys are the short everyday words the on-device model is asked to pick from. `route` may carry a query string
// (the screen file is the part before "?"). No imports here: this file is a leaf so every other ai file can use it.

export interface ScreenInfo {
  route: string;
  /** English name, also used in "Opening <en>". */
  en: string;
  hi: string;
  /** Spoken or typed ways to ask for it: English, Hinglish (Latin script) and Devanagari. */
  aliases: string[];
}

const S = (route: string, en: string, hi: string, aliases: string[]): ScreenInfo => ({ route, en, hi, aliases });

export const SCREENS: Record<string, ScreenInfo> = {
  home: S('/', 'home', 'होम', ['home', 'home screen', 'start screen', 'होम', 'होम स्क्रीन', 'मुख्य पेज']),
  map: S('/map', 'map', 'नक्शा', ['map', 'maps', 'nakshe', 'naksha', 'नक्शा', 'नक्शे', 'नक़्शा', 'नक़्शे', 'मानचित्र']),
  shelters: S('/map?place=shelter', 'shelter map', 'आश्रय का नक्शा', ['shelter', 'shelters', 'shelter map', 'relief camp', 'ashray', 'aashray', 'sharan', 'शेल्टर', 'आश्रय', 'शरण', 'राहत शिविर']),
  hospitals: S('/map?place=hospital', 'hospital map', 'अस्पताल का नक्शा', ['hospital', 'hospitals', 'hospital map', 'aspatal', 'aspataal', 'hospital ka naksha', 'अस्पताल', 'हॉस्पिटल', 'अस्पताल का नक्शा']),
  chat: S('/adult/community', 'community chat', 'समुदाय चैट', ['chat', 'community', 'community chat', 'neighbours', 'neighbors', 'samudaay', 'batcheet', 'चैट', 'समुदाय', 'बातचीत', 'पड़ोसी']),
  aid: S('/adult/aid', 'first aid', 'प्राथमिक उपचार', ['first aid', 'firstaid', 'aid', 'pratham upchar', 'upchar', 'प्राथमिक उपचार', 'फ़र्स्ट एड', 'फर्स्ट एड', 'उपचार']),
  news: S('/news', 'news', 'ख़बर', ['news', 'khabar', 'khabrein', 'samachar', 'ख़बर', 'खबर', 'खबरें', 'समाचार']),
  weather: S('/weather', 'weather', 'मौसम', ['weather', 'forecast', 'weather report', 'mausam', 'मौसम', 'मौसम की जानकारी']),
  prepare: S('/prepare', 'prepare', 'तैयारी', ['prepare', 'preparedness', 'readiness', 'be ready', 'tayyari', 'taiyari', 'तैयारी', 'तैयार']),
  recover: S('/recover', 'recover', 'रिकवरी', ['recover', 'recovery', 'after disaster', 'punarvas', 'रिकवरी', 'पुनर्वास']),
  signals: S('/tools', 'signal tools', 'सिग्नल टूल', ['signal tools', 'signals', 'signal', 'tools', 'torch', 'flashlight', 'siren', 'whistle', 'टॉर्च', 'सायरन', 'सीटी', 'सिग्नल', 'टूल्स']),
  locate: S('/locate', 'locate me', 'मुझे ढूंढो', ['locate me', 'locate', 'where am i', 'my location', 'mujhe dhundho', 'mujhe dhoondho', 'मुझे ढूंढो', 'मुझे ढूँढो', 'मेरी लोकेशन']),
  familydrill: S('/familydrill', 'family drills', 'परिवार अभ्यास', ['family drill', 'family drills', 'parivar abhyas', 'parivar drill', 'परिवार अभ्यास', 'परिवार ड्रिल']),
  lifeboat: S('/lifeboat', 'lifeboat mode', 'लाइफबोट', ['lifeboat', 'lifeboat mode', 'life boat', 'लाइफबोट', 'लाइफ़बोट']),
  shake: S('/quake', 'shake warning', 'झटका चेतावनी', ['shake warning', 'shake alert', 'shake', 'quake warning', 'earthquake warning', 'jhatka chetavni', 'झटका चेतावनी', 'भूकंप चेतावनी']),
  findfamily: S('/findfamily', 'find family', 'परिवार खोजो', ['find family', 'family breadcrumbs', 'breadcrumbs', 'family trail', 'parivar khojo', 'parivar dhundho', 'परिवार खोजो', 'परिवार ढूंढो', 'परिवार को ढूंढो']),
  roads: S('/road', 'road reports', 'सड़क रिपोर्ट', ['road report', 'road reports', 'road status', 'roads', 'road', 'sadak', 'sadak report', 'सड़क रिपोर्ट', 'सड़क', 'सड़कें']),
  household: S('/household', 'household', 'घर की जानकारी', ['household', 'household profile', 'household info', 'home profile', 'ghar ki jankari', 'घर की जानकारी', 'घरेलू']),
  gobag: S('/gobag', 'go bag', 'गो बैग', ['go bag', 'gobag', 'emergency bag', 'emergency kit', 'kit', 'गो बैग', 'गोबैग', 'इमरजेंसी बैग']),
  drills: S('/drills', 'drills', 'ड्रिल', ['drill', 'drills', 'start drill', 'start drills', 'mock drill', 'practice', 'ड्रिल', 'अभ्यास', 'अभ्यास करो']),
  medical: S('/medical', 'medical ID', 'मेडिकल आईडी', ['medical id', 'medical', 'medical card', 'medical info', 'medical qr', 'मेडिकल', 'मेडिकल आईडी', 'मेडिकल कार्ड']),
  family: S('/family', 'family', 'परिवार', ['family', 'parivar', 'family members', 'family contacts', 'परिवार']),
  photo: S('/photo', 'photo check', 'फोटो जाँच', ['photo check', 'photo', 'check photo', 'scan photo', 'camera check', 'फोटो', 'फोटो जांच', 'फोटो जाँच', 'तस्वीर']),
  mesh: S('/mesh', 'mesh health', 'मेश स्थिति', ['mesh', 'mesh health', 'mesh status', 'nearby phones', 'मेश', 'मेश स्थिति']),
  privacy: S('/privacy', 'privacy', 'गोपनीयता', ['privacy', 'privacy policy', 'privacy settings', 'प्राइवेसी', 'गोपनीयता']),
  settings: S('/settings', 'settings', 'सेटिंग', ['settings', 'setting', 'preferences', 'सेटिंग', 'सेटिंग्स', 'सेटींग']),
  hub: S('/hub', 'hub', 'हब', ['hub', 'desktop hub', 'desktop', 'हब', 'डेस्कटॉप']),
  more: S('/more', 'more menu', 'और मेनू', ['more', 'more menu', 'menu', 'मेनू', 'और मेनू']),
  update: S('/update', 'update', 'अपडेट', ['update', 'updates', 'check for update', 'update app', 'अपडेट']),
  report: S('/report/new', 'report', 'रिपोर्ट', ['report', 'report something', 'report incident', 'report problem', 'रिपोर्ट', 'शिकायत']),
};

export type ScreenId = string;

export const SCREEN_IDS = Object.keys(SCREENS);

export function isScreenId(x: unknown): x is ScreenId {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(SCREENS, x);
}

/** The file part of a route ("/map?place=shelter" -> "/map"). */
export const routePath = (route: string) => route.split('?')[0];

/**
 * Hindi and Hinglish words -> a plain English word. The model only fills arguments from words in the request, so these
 * are appended to the request in brackets ("mere ghar ka naksha dikhao (house map)").
 */
export const HINT_WORDS: Record<string, string> = {
  naksha: 'map', nakshe: 'map', नक्शा: 'map', नक्शे: 'map', नक़्शा: 'map', मानचित्र: 'map',
  davai: 'medicine', dawai: 'medicine', dawa: 'medicine', दवाई: 'medicine', दवा: 'medicine', दवाइयाँ: 'medicine',
  aspatal: 'hospital', aspataal: 'hospital', अस्पताल: 'hospital',
  madad: 'help', मदद: 'help', bachao: 'rescue', बचाओ: 'rescue',
  ghar: 'house', घर: 'house', parivar: 'family', परिवार: 'family', bachche: 'kids', बच्चे: 'kids', bacche: 'kids',
  mausam: 'weather', मौसम: 'weather', khabar: 'news', खबर: 'news', ख़बर: 'news',
  sadak: 'road', सड़क: 'road', rasta: 'road', रास्ता: 'road', tayyari: 'prepare', तैयारी: 'prepare',
  aag: 'fire', आग: 'fire', bhukamp: 'earthquake', भूकंप: 'earthquake', baadh: 'flood', बाढ़: 'flood', toofan: 'cyclone', तूफान: 'cyclone',
  abhyas: 'drill', अभ्यास: 'drill', ड्रिल: 'drill', टॉर्च: 'torch', सायरन: 'siren',
  aashray: 'shelter', ashray: 'shelter', आश्रय: 'shelter', pani: 'water', पानी: 'water', पुलिस: 'police',
  सेटिंग: 'settings', फोटो: 'photo', dhundho: 'find', ढूंढो: 'find', khojo: 'find',
  chetavni: 'warning', चेतावनी: 'warning', jankari: 'info', जानकारी: 'info',
};

/** "Hindi text" -> "Hindi text (english words)" so the small model has English words to pick arguments from. */
export function addHints(text: string): string {
  const words = text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .split(/\s+/);
  const out: string[] = [];
  for (const w of words) {
    const h = HINT_WORDS[w];
    if (h && !out.includes(h)) out.push(h);
  }
  return out.length ? `${text} (${out.join(' ')})` : text;
}
