import type { T } from './types';

export type RecoveryTint = 'pink' | 'yellow' | 'blue' | 'green' | 'lilac' | 'peach';

export interface RecoveryItem {
  id: string;
  text: T;
}

export interface RecoveryGroup {
  id: string;
  title: T;
  tint: RecoveryTint;
  items: RecoveryItem[];
}

export const RECOVERY_GROUPS: RecoveryGroup[] = [
  {
    id: 'safety',
    title: ['Safety first', 'सबसे पहले सुरक्षा'],
    tint: 'pink',
    items: [
      {
        id: 'safety.buildings',
        text: [
          'Do not enter damaged buildings until an engineer or official says they are safe.',
          'क्षतिग्रस्त इमारत में तब तक न जाएँ जब तक इंजीनियर या अधिकारी उसे सुरक्षित न बताएँ।',
        ],
      },
      {
        id: 'safety.gas',
        text: [
          'If you smell gas, open windows and leave. Do not switch lights or flames on. If water touches wiring, turn off the main power.',
          'गैस की बदबू आए तो खिड़कियाँ खोलकर बाहर निकलें। बत्ती या आग न जलाएँ। पानी वायरिंग तक पहुँचा हो तो मेन बिजली बंद करें।',
        ],
      },
      {
        id: 'safety.floodwater',
        text: [
          'Flood water is contaminated. Keep children and pets out of it, and wear shoes and gloves when you must wade.',
          'बाढ़ का पानी गंदा होता है। बच्चों और जानवरों को उससे दूर रखें, और पानी में जाना पड़े तो जूते और दस्ताने पहनें।',
        ],
      },
      {
        id: 'safety.water',
        text: [
          'Boil or purify water before drinking: boil for one minute, or use chlorine tablets or a filter.',
          'पीने से पहले पानी उबालें (एक मिनट), या क्लोरीन की गोली या फ़िल्टर का उपयोग करें।',
        ],
      },
    ],
  },
  {
    id: 'documents',
    title: ['Documents and money', 'दस्तावेज़ और पैसा'],
    tint: 'yellow',
    items: [
      {
        id: 'docs.photos',
        text: [
          'Photograph the damage before you clean anything.',
          'कुछ भी साफ करने से पहले नुकसान की तस्वीरें लें।',
        ],
      },
      {
        id: 'docs.list',
        text: [
          'List lost items with rough value and date bought.',
          'खोई चीज़ों की सूची बनाएँ, अनुमानित कीमत और खरीद की तारीख़ के साथ।',
        ],
      },
      {
        id: 'docs.insurance',
        text: [
          'Call your insurer, get a claim number, and keep every message in writing.',
          'बीमा कंपनी को फ़ोन करें, क्लेम नंबर लें, और हर संदेश लिखित में रखें।',
        ],
      },
      {
        id: 'docs.copies',
        text: [
          'Keep copies of Aadhaar, ration card and voter ID. Store them on your phone too.',
          'आधार, राशन कार्ड और वोटर ID की प्रतियाँ रखें। फ़ोन में भी सहेजें।',
        ],
      },
      {
        id: 'docs.bank',
        text: [
          'Tell your bank what happened, and keep receipts for emergency spending.',
          'बैंक को स्थिति बताएँ, और आपातकालीन खर्च की रसीदें संभालकर रखें।',
        ],
      },
    ],
  },
  {
    id: 'health',
    title: ['Health', 'स्वास्थ्य'],
    tint: 'green',
    items: [
      {
        id: 'health.tetanus',
        text: [
          'If a cut or wound came from debris, get a tetanus shot.',
          'मलबे से लगे कट या घाव पर टिटनेस का टीका लगवाएँ।',
        ],
      },
      {
        id: 'health.wound',
        text: [
          'Wash cuts with clean water and soap, cover them, and watch for redness, swelling or pus.',
          'कट को साफ पानी और साबुन से धोएँ, ढकें, और लालिमा, सूजन या मवाद पर नज़र रखें।',
        ],
      },
      {
        id: 'health.medicine',
        text: [
          'Restock medicines first: prescriptions, insulin and inhalers.',
          'दवाइयाँ सबसे पहले दोबारा लें: पर्चे की दवाइयाँ, इंसुलिन और इनहेलर।',
        ],
      },
      {
        id: 'health.mould',
        text: [
          'Dry rooms in sunlight, avoid breathing mould dust, and wear a mask when cleaning.',
          'कमरों को धूप में सुखाएँ, फफूंद की धूल से बचें, और सफाई के समय मास्क पहनें।',
        ],
      },
    ],
  },
  {
    id: 'wellbeing',
    title: ['Wellbeing', 'मन की सेहत'],
    tint: 'blue',
    items: [
      {
        id: 'well.talk',
        text: [
          'Talk to someone you trust about how you feel.',
          'जिस पर भरोसा हो, उससे अपनी भावनाओं के बारे में बात करें।',
        ],
      },
      {
        id: 'well.kids',
        text: [
          'Children need routine: regular meals, sleep, and a little play every day.',
          'बच्चों को नियमित दिनचर्या चाहिए: समय पर खाना, नींद, और रोज़ थोड़ा खेल।',
        ],
      },
      {
        id: 'well.news',
        text: [
          'Limit news. Check updates twice a day, from official sources only.',
          'खबरें कम देखें। दिन में दो बार, केवल आधिकारिक स्रोतों से अपडेट लें।',
        ],
      },
      {
        id: 'well.help',
        text: [
          'If you cannot cope for more than two weeks, ask for professional help.',
          'अगर दो हफ़्ते से ज़्यादा परेशानी रहे, तो पेशेवर मदद लें।',
        ],
      },
    ],
  },
  {
    id: 'community',
    title: ['Community', 'समुदाय'],
    tint: 'peach',
    items: [
      {
        id: 'com.neighbours',
        text: [
          'Check on neighbours, especially older people and people with disabilities.',
          'पड़ोसियों का हाल पूछें, ख़ासकर बुज़ुर्गों और दिव्यांग लोगों का।',
        ],
      },
      {
        id: 'com.volunteer',
        text: [
          'Volunteer only through official or trusted relief groups.',
          'राहत कार्य में स्वयंसेवा केवल आधिकारिक या भरोसेमंद समूहों के साथ करें।',
        ],
      },
      {
        id: 'com.needs',
        text: [
          'Report what your area needs (water, food, shelter) so responders can reach it.',
          'अपने इलाके की ज़रूरतें (पानी, खाना, आश्रय) बताएँ, ताकि मदद वहाँ पहुँचे।',
        ],
      },
    ],
  },
];

export interface GroupProgress {
  id: string;
  done: number;
  total: number;
  /** 0 to 1 */
  fraction: number;
}

/** Counts finished items per group. Unknown ids in `done` are ignored. */
export function groupProgress(done: string[]): GroupProgress[] {
  const set = new Set(done);
  return RECOVERY_GROUPS.map((g) => {
    const total = g.items.length;
    const n = g.items.filter((i) => set.has(i.id)).length;
    return { id: g.id, done: n, total, fraction: total ? n / total : 0 };
  });
}

export interface Helpline {
  id: string;
  number: string;
  label: T;
  note: T;
}

export const HELPLINES: Helpline[] = [
  { id: 'emergency', number: '112', label: ['Emergency', 'आपातकाल'], note: ['Police, fire, ambulance', 'पुलिस, दमकल, एंबुलेंस'] },
  { id: 'manas', number: '14416', label: ['Tele-MANAS', 'टेली-मानस'], note: ['Free mental health support, 24 hours', 'मुफ़्त मानसिक स्वास्थ्य सहायता, 24 घंटे'] },
  { id: 'childline', number: '1098', label: ['Childline', 'चाइल्डलाइन'], note: ['Help for any child in distress', 'संकट में किसी भी बच्चे के लिए मदद'] },
];
