import type { Lang } from './types';

/** Short, standard, offline do and don't lists for one hazard, shown big in Alert mode. */
export interface DoDont {
  do: string[];
  dont: string[];
}

// Ids match src/kb/disasters.ts; `fire` covers fire and smoke. Keep 4 + 4 per language.
const DODONT: Record<string, Record<Lang, DoDont>> = {
  earthquake: {
    en: {
      do: [
        'Drop to your hands and knees, cover your head and neck, and hold on until the shaking stops.',
        'Stay inside. Move away from windows, glass and heavy furniture.',
        'Outdoors, move to an open space away from buildings, wires and trees.',
        'After the shaking, check for injuries and expect aftershocks.',
      ],
      dont: [
        'Do not run outside or use lifts.',
        'Do not stand in a doorway.',
        'If you smell gas, do not light a flame or touch switches.',
        'Do not drive onto bridges or flyovers.',
      ],
    },
    hi: {
      do: [
        'हाथ-घुटनों पर झुकें, सिर और गर्दन ढकें, और झटके रुकने तक पकड़े रहें।',
        'अंदर रहें। खिड़कियों, काँच और भारी फ़र्नीचर से दूर हटें।',
        'बाहर हों तो इमारतों, तारों और पेड़ों से दूर खुली जगह जाएँ।',
        'झटके रुकने पर चोट देखें और आफ़्टरशॉक की आशंका रखें।',
      ],
      dont: [
        'बाहर न भागें और लिफ़्ट का इस्तेमाल न करें।',
        'दरवाज़े में खड़े न हों।',
        'गैस की गंध हो तो आग न जलाएँ और स्विच न छुएँ।',
        'पुल या फ़्लाईओवर पर गाड़ी न चलाएँ।',
      ],
    },
  },
  flood: {
    en: {
      do: [
        'Move to higher ground early. Do not wait for the water to reach you.',
        'Stay on high ground and follow official evacuation orders.',
        'If it is safe to reach, switch off the mains electricity.',
        'If trapped, go to the highest floor or roof and signal for help.',
      ],
      dont: [
        'Never walk, swim or drive through floodwater.',
        'Do not touch power lines, poles or electrical equipment in water.',
        'Do not drink or cook with flood or tap water unless it is boiled or treated.',
        'Do not enter a closed attic or a basement.',
      ],
    },
    hi: {
      do: [
        'ऊँची जगह जल्दी जाएँ। पानी आने का इंतज़ार न करें।',
        'ऊँची जगह पर रहें और निकलने के आदेश मानें।',
        'सुरक्षित हो तो मेन से बिजली बंद करें।',
        'फँस जाएँ तो सबसे ऊँची मंज़िल या छत पर जाकर संकेत दें।',
      ],
      dont: [
        'बाढ़ के पानी में पैदल, तैरकर या गाड़ी से न जाएँ।',
        'पानी में पड़े तारों, खंभों या बिजली के उपकरणों को न छुएँ।',
        'बिना उबाले या शुद्ध किए पानी न पिएँ और न उससे खाना बनाएँ।',
        'बंद टांड या तहख़ाने में न जाएँ।',
      ],
    },
  },
  cyclone: {
    en: {
      do: [
        'Shelter in a strong building, away from windows and glass doors.',
        'Go to the nearest cyclone shelter when officials ask you to.',
        'If the roof is damaged, lie under a sturdy table.',
        'Keep a radio or phone on for official updates.',
      ],
      dont: [
        'Do not go out during the calm eye. The storm comes back from the other side.',
        'Do not stay near windows, glass doors or loose roofing.',
        'Do not walk near fallen power lines or standing water.',
        'Do not go to the coast to watch the waves.',
      ],
    },
    hi: {
      do: [
        'मज़बूत इमारत में, खिड़कियों और काँच के दरवाज़ों से दूर रहें।',
        'अधिकारियों के कहने पर नज़दीकी चक्रवात आश्रय जाएँ।',
        'छत टूटी हो तो मज़बूत मेज़ के नीचे लेटें।',
        'सरकारी सूचनाओं के लिए रेडियो या फ़ोन चालू रखें।',
      ],
      dont: [
        'शांत आँख के दौरान बाहर न निकलें; तूफ़ान उल्टी ओर से लौटता है।',
        'खिड़कियों, काँच के दरवाज़ों और ढीली छत के पास न रहें।',
        'गिरे तारों और जमे पानी के पास न जाएँ।',
        'लहरें देखने तट पर न जाएँ।',
      ],
    },
  },
  landslide: {
    en: {
      do: [
        'If you hear a rumble, move sideways out of the debris path to high ground.',
        'If you cannot escape, curl into a tight ball and protect your head.',
        'Watch for cracks in ground or walls, tilting trees and muddy streams.',
        'In heavy rain below a steep slope, leave early.',
      ],
      dont: [
        'Do not run downhill along the flow of debris.',
        'Do not go back to the slide area; more slides may follow.',
        'Do not enter unstable debris to search for people.',
        'Do not ignore new springs or fresh cracks on a slope.',
      ],
    },
    hi: {
      do: [
        'गड़गड़ाहट सुनें तो मलबे के रास्ते से बगल में ऊँचाई पर जाएँ।',
        'न बच सकें तो गेंद की तरह सिमटकर सिर बचाएँ।',
        'ज़मीन और दीवारों में दरारें, झुकते पेड़ और मटमैला पानी देखें।',
        'तेज़ ढलान के नीचे हों और भारी बारिश हो तो समय रहते हटें।',
      ],
      dont: [
        'मलबे के बहाव के साथ नीचे की ओर न दौड़ें।',
        'भूस्खलन वाली जगह पर वापस न जाएँ; और मलबा खिसक सकता है।',
        'अस्थिर मलबे में लोगों को ढूँढने न जाएँ।',
        'ढलान पर नए झरने या ताज़ा दरारों को नज़रअंदाज़ न करें।',
      ],
    },
  },
  heatwave: {
    en: {
      do: [
        'Stay in a cool room between 12 and 4 pm.',
        'Drink water, ORS, buttermilk or lemon water often.',
        'Wear light cotton clothes and cover your head outdoors.',
        'Check on elders and children, and move anyone who feels unwell to a cool place.',
      ],
      dont: [
        'Do not go out in the midday sun if you can avoid it.',
        'Do not leave children or pets in a parked vehicle.',
        'Do not wait until you feel thirsty to drink.',
        'Do not do heavy work in the afternoon heat.',
      ],
    },
    hi: {
      do: [
        'दोपहर 12 से 4 बजे के बीच ठंडे कमरे में रहें।',
        'पानी, ORS, छाछ या नींबू पानी बार-बार पिएँ।',
        'हल्के सूती कपड़े पहनें और बाहर सिर ढकें।',
        'बुज़ुर्गों और बच्चों का हाल लें; बीमार लगे तो उसे ठंडी जगह पर लाएँ।',
      ],
      dont: [
        'हो सके तो दोपहर की धूप में बाहर जाने से बचें।',
        'बच्चों या पालतू जानवरों को खड़ी गाड़ी में न छोड़ें।',
        'प्यास लगने का इंतज़ार न करें।',
        'दोपहर की गर्मी में भारी काम न करें।',
      ],
    },
  },
  lightning: {
    en: {
      do: [
        'Go into a solid building or a hard-topped vehicle.',
        'Stay away from windows, wired phones and plumbing.',
        'If caught outside, crouch low on the balls of your feet with your head down.',
        'Wait 30 minutes after the last thunder before going out.',
      ],
      dont: [
        'Do not shelter under a tree or near a pole.',
        'Do not stand in open fields or near water.',
        'Do not lie flat on the ground.',
        'Do not use a corded phone or running taps during a storm.',
      ],
    },
    hi: {
      do: [
        'पक्की इमारत या पक्की छत वाली गाड़ी में जाएँ।',
        'खिड़कियों, तार वाले फ़ोन और नल से दूर रहें।',
        'बाहर फँसें तो पंजों पर बैठें और सिर झुकाएँ।',
        'आख़िरी गरज के 30 मिनट बाद ही बाहर निकलें।',
      ],
      dont: [
        'पेड़ या खंभे के नीचे शरण न लें।',
        'खुले खेत या पानी के पास न खड़े हों।',
        'ज़मीन पर लेटें नहीं।',
        'आँधी में तार वाला फ़ोन या चलता नल इस्तेमाल न करें।',
      ],
    },
  },
  tsunami: {
    en: {
      do: [
        'After a strong or long quake near the coast, go up and inland at once.',
        'If the sea suddenly pulls back, move to high ground immediately.',
        'Walk or run if the roads are jammed.',
        'Stay on high ground until officials say it is safe.',
      ],
      dont: [
        'Do not wait for an official alert when you have seen a natural warning.',
        'Do not go to the beach to watch the waves.',
        'Do not return to the coast after the first wave; more waves follow.',
        'Do not think the danger is over because the sea has pulled back.',
      ],
    },
    hi: {
      do: [
        'तट के पास तेज़ या लंबे भूकंप के बाद तुरंत ऊँचाई और अंदर की ओर जाएँ।',
        'समुद्र अचानक पीछे हटे तो तुरंत ऊँची जगह पर जाएँ।',
        'सड़कें जाम हों तो पैदल या दौड़कर जाएँ।',
        'अधिकारियों के सुरक्षित बताने तक ऊँची जगह पर रहें।',
      ],
      dont: [
        'प्राकृतिक चेतावनी दिखने पर सरकारी अलर्ट का इंतज़ार न करें।',
        'लहरें देखने समुद्र तट पर न जाएँ।',
        'पहली लहर के बाद तट पर वापस न लौटें; और लहरें आती हैं।',
        'समुद्र पीछे हटने को ख़तरा टलना न मानें।',
      ],
    },
  },
  fire: {
    en: {
      do: [
        'Crawl low under smoke, where the air is cleaner.',
        'Feel a door before opening it. If it is hot, use another way out.',
        'Get out, close the door behind you and call 112 from outside.',
        'If your clothes catch fire, stop, drop and roll.',
      ],
      dont: [
        'Do not use lifts.',
        'Do not go back inside for belongings.',
        'Do not open a hot door.',
        'Do not hide under beds or in cupboards.',
      ],
    },
    hi: {
      do: [
        'धुएँ के नीचे झुककर चलें, जहाँ हवा साफ़ होती है।',
        'दरवाज़ा खोलने से पहले छूकर देखें; गर्म हो तो दूसरा रास्ता लें।',
        'बाहर निकलें, दरवाज़ा बंद करें और बाहर से 112 पर कॉल करें।',
        'कपड़ों में आग लगे तो रुकें, ज़मीन पर लेटें और लोटें।',
      ],
      dont: [
        'लिफ़्ट का इस्तेमाल न करें।',
        'सामान लेने अंदर वापस न जाएँ।',
        'गर्म दरवाज़ा न खोलें।',
        'बिस्तर या अलमारी के नीचे न छिपें।',
      ],
    },
  },
};

/** The do and don't list for a hazard id in one language, or undefined for an unknown id. */
export function dodontFor(id: string, lang: Lang): DoDont | undefined {
  return DODONT[id]?.[lang];
}

/** Every id that has do and don't lists. */
export const DODONT_IDS: string[] = Object.keys(DODONT);
