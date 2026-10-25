import type { IconName } from '../components/Icon';
import type { T } from './types';

export interface DrillStep {
  icon: IconName;
  prompt: T;
  options: { label: T; correct: boolean }[];
  why: T; // shown after answering
}

export interface Drill {
  id: string;
  icon: IconName;
  title: T;
  tint: 'peach' | 'pink' | 'blue' | 'lilac';
  intro: T;
  steps: DrillStep[];
}

export const DRILLS: Drill[] = [
  {
    id: 'earthquake',
    icon: 'mountain',
    title: ['Earthquake drill', 'भूकंप अभ्यास'],
    tint: 'peach',
    intro: ['The ground is shaking! What do you do? Remember: Drop, Cover, Hold on.', 'ज़मीन हिल रही है! तुम क्या करोगे? याद रखो: झुको, ढको, पकड़ो।'],
    steps: [
      {
        icon: 'mountain',
        prompt: ['The floor starts to shake. What is the FIRST thing to do?', 'फ़र्श हिलने लगा। सबसे पहले क्या करना है?'],
        options: [
          { label: ['Run outside', 'बाहर भागो'], correct: false },
          { label: ['Drop to the floor', 'नीचे झुक जाओ'], correct: true },
          { label: ['Stand in the door', 'दरवाज़े में खड़े हो'], correct: false },
        ],
        why: ['Drop down so you do not fall. Running can hurt you.', 'नीचे झुको ताकि गिरो नहीं। भागने से चोट लग सकती है।'],
      },
      {
        icon: 'mountain',
        prompt: ['Where is the safest place to hide?', 'छिपने की सबसे सुरक्षित जगह कौन-सी है?'],
        options: [
          { label: ['Under a strong table', 'मज़बूत मेज़ के नीचे'], correct: true },
          { label: ['Next to a window', 'खिड़की के पास'], correct: false },
          { label: ['Under a hanging lamp', 'लटके लैंप के नीचे'], correct: false },
        ],
        why: ['A strong table protects your head from falling things. Windows can break.', 'मज़बूत मेज़ गिरती चीज़ों से सिर बचाती है। खिड़की टूट सकती है।'],
      },
      {
        icon: 'mountain',
        prompt: ['Under the table, what do you protect and hold?', 'मेज़ के नीचे तुम किसे बचाओगे और पकड़ोगे?'],
        options: [
          { label: ['Cover my head, hold the table leg', 'सिर ढको, मेज़ का पाया पकड़ो'], correct: true },
          { label: ['Play on my phone', 'फ़ोन पर खेलो'], correct: false },
          { label: ['Stand up to look', 'खड़े होकर देखो'], correct: false },
        ],
        why: ['Cover your head and neck, and hold on until the shaking stops.', 'सिर और गर्दन ढको और झटके रुकने तक पकड़े रहो।'],
      },
      {
        icon: 'mountain',
        prompt: ['The shaking stopped. What now?', 'झटके रुक गए। अब क्या?'],
        options: [
          { label: ['Use stairs, go outside, stay away from buildings', 'सीढ़ियों से बाहर जाओ, इमारतों से दूर रहो'], correct: true },
          { label: ['Take the lift', 'लिफ़्ट लो'], correct: false },
          { label: ['Go back for my toys', 'खिलौने लेने वापस जाओ'], correct: false },
        ],
        why: ['Never use a lift. Aftershocks can come, so stay in an open place with your grown-ups.', 'लिफ़्ट कभी नहीं। और झटके आ सकते हैं, इसलिए बड़ों के साथ खुली जगह रहो।'],
      },
    ],
  },
  {
    id: 'fire',
    icon: 'fire',
    title: ['Fire drill', 'आग अभ्यास'],
    tint: 'pink',
    intro: ['Fire is dangerous. Learn the safe way out!', 'आग ख़तरनाक है। बाहर निकलने का सुरक्षित तरीक़ा सीखो!'],
    steps: [
      {
        icon: 'fire',
        prompt: ['You see smoke in the room. What do you do?', 'कमरे में धुआँ दिखा। तुम क्या करोगे?'],
        options: [
          { label: ['Hide under the bed', 'पलंग के नीचे छिपो'], correct: false },
          { label: ['Get out fast and shout "Fire!"', 'जल्दी बाहर निकलो और "आग!" चिल्लाओ'], correct: true },
          { label: ['Try to put it out', 'आग बुझाने की कोशिश करो'], correct: false },
        ],
        why: ['Get out first and tell a grown-up. Never hide, and never fight a fire yourself.', 'पहले बाहर निकलो और बड़े को बताओ। छिपना या ख़ुद आग बुझाना नहीं।'],
      },
      {
        icon: 'fire',
        prompt: ['The room is filling with smoke. How do you move?', 'कमरा धुएँ से भर रहा है। कैसे चलोगे?'],
        options: [
          { label: ['Low, near the floor', 'नीचे झुककर, फ़र्श के पास'], correct: true },
          { label: ['Standing tall', 'सीधे खड़े होकर'], correct: false },
          { label: ['Jumping', 'कूदते हुए'], correct: false },
        ],
        why: ['Smoke rises, so the air near the floor is cleaner. Cover your nose with a cloth.', 'धुआँ ऊपर उठता है, इसलिए फ़र्श के पास हवा साफ़ होती है। नाक कपड़े से ढको।'],
      },
      {
        icon: 'fire',
        prompt: ['The door feels HOT. What do you do?', 'दरवाज़ा गर्म लग रहा है। क्या करोगे?'],
        options: [
          { label: ['Open it quickly', 'जल्दी से खोलो'], correct: false },
          { label: ['Do not open it, find another way and signal from a window', 'मत खोलो, दूसरा रास्ता ढूँढो और खिड़की से इशारा करो'], correct: true },
          { label: ['Wait quietly', 'चुपचाप इंतज़ार करो'], correct: false },
        ],
        why: ['A hot door means fire on the other side. Use another way out or call for help.', 'गर्म दरवाज़ा यानी दूसरी तरफ़ आग है। दूसरा रास्ता लो या मदद बुलाओ।'],
      },
      {
        icon: 'fire',
        prompt: ['Your clothes catch fire. Remember what?', 'कपड़ों में आग लग जाए तो क्या याद रखना है?'],
        options: [
          { label: ['Run', 'दौड़ो'], correct: false },
          { label: ['Stop, drop and roll', 'रुको, लेटो और लुढ़को'], correct: true },
          { label: ['Wave your arms', 'हाथ हिलाओ'], correct: false },
        ],
        why: ['Running feeds the fire. Stop, drop, cover your face and roll.', 'दौड़ने से आग बढ़ती है। रुको, लेटो, चेहरा ढको और लुढ़को।'],
      },
    ],
  },
  {
    id: 'flood',
    icon: 'flood',
    title: ['Flood drill', 'बाढ़ अभ्यास'],
    tint: 'blue',
    intro: ['The water is rising. Go UP and stay dry!', 'पानी बढ़ रहा है। ऊपर जाओ और सूखे रहो!'],
    steps: [
      {
        icon: 'flood',
        prompt: ['Water is coming into the street. Where do you go?', 'गली में पानी आ रहा है। कहाँ जाओगे?'],
        options: [
          { label: ['To high ground or an upper floor', 'ऊँची जगह या ऊपरी मंज़िल पर'], correct: true },
          { label: ['Into the water to play', 'पानी में खेलने'], correct: false },
          { label: ['Down to the basement', 'तहख़ाने में'], correct: false },
        ],
        why: ['Water flows down and fills low places. Always move UP.', 'पानी नीचे की ओर बहता है और निचली जगह भरता है। हमेशा ऊपर जाओ।'],
      },
      {
        icon: 'flood',
        prompt: ['Can you walk through moving flood water?', 'क्या बहते बाढ़ के पानी में चल सकते हैं?'],
        options: [
          { label: ['Never. It is strong and dirty', 'कभी नहीं। यह तेज़ और गंदा है'], correct: true },
          { label: ['Yes, if it is shallow', 'हाँ, अगर कम है'], correct: false },
          { label: ['Yes, with boots', 'हाँ, जूते पहनकर'], correct: false },
        ],
        why: ['Even a little moving water can knock you down. It can hide holes and wires.', 'थोड़ा बहता पानी भी गिरा सकता है। उसमें गड्ढे और तार छिपे हो सकते हैं।'],
      },
      {
        icon: 'flood',
        prompt: ['You are thirsty after the flood. What is safe to drink?', 'बाढ़ के बाद प्यास लगी है। क्या पीना सुरक्षित है?'],
        options: [
          { label: ['Boiled or bottled water', 'उबला या बोतलबंद पानी'], correct: true },
          { label: ['Water from the street', 'सड़क का पानी'], correct: false },
          { label: ['Water from the river', 'नदी का पानी'], correct: false },
        ],
        why: ['Flood water carries germs. Ask a grown-up for boiled or bottled water.', 'बाढ़ का पानी कीटाणु लाता है। बड़ों से उबला या बोतलबंद पानी माँगो।'],
      },
    ],
  },
  {
    id: 'lost',
    icon: 'compass',
    title: ['If I am lost', 'अगर मैं खो जाऊँ'],
    tint: 'lilac',
    intro: ['What should you do if you cannot find your family?', 'अगर परिवार न मिले तो क्या करना चाहिए?'],
    steps: [
      {
        icon: 'compass',
        prompt: ['You cannot see your family. What do you do?', 'परिवार दिख नहीं रहा। क्या करोगे?'],
        options: [
          { label: ['Stay where I am and look for a helper', 'वहीं रुको और मददगार ढूँढो'], correct: true },
          { label: ['Wander around to find them', 'ढूँढने के लिए घूमते रहो'], correct: false },
          { label: ['Go with anyone who offers', 'जो भी ले जाना चाहे उसके साथ चले जाओ'], correct: false },
        ],
        why: ['Staying put makes it easier for your family to find you.', 'एक जगह रुकने से परिवार को तुम्हें ढूँढना आसान होता है।'],
      },
      {
        icon: 'compass',
        prompt: ['Who is a safe person to ask for help?', 'मदद के लिए कौन सुरक्षित व्यक्ति है?'],
        options: [
          { label: ['A police officer, a shop worker or a mum with kids', 'पुलिस, दुकानदार या बच्चों वाली माँ'], correct: true },
          { label: ['Someone who offers sweets', 'मिठाई देने वाला अजनबी'], correct: false },
          { label: ['Someone who says "come with me"', '"मेरे साथ चलो" कहने वाला'], correct: false },
        ],
        why: ['Look for someone in a uniform or a shop. Never go away with a stranger.', 'वर्दी वाले या दुकान के लोगों को ढूँढो। अजनबी के साथ कभी मत जाओ।'],
      },
      {
        icon: 'compass',
        prompt: ['What should you know by heart?', 'तुम्हें क्या ज़ुबानी याद होना चाहिए?'],
        options: [
          { label: ["My parent's phone number", 'माता-पिता का फ़ोन नंबर'], correct: true },
          { label: ['My game password', 'गेम का पासवर्ड'], correct: false },
          { label: ["My friend's birthday", 'दोस्त का जन्मदिन'], correct: false },
        ],
        why: ['A helper can call your parents if you know the number. Press the SOS button in Beacon too.', 'नंबर पता हो तो मददगार माता-पिता को फ़ोन कर सकता है। Beacon का SOS बटन भी दबाओ।'],
      },
    ],
  },
];

export const getDrill = (id: string) => DRILLS.find((d) => d.id === id);

export interface BagItem {
  icon: IconName;
  name: T;
  good: boolean;
}

export const BAG_ITEMS: BagItem[] = [
  { icon: 'water', name: ['Water', 'पानी'], good: true },
  { icon: 'sun', name: ['Torch', 'टॉर्च'], good: true },
  { icon: 'package', name: ['Biscuits', 'बिस्कुट'], good: true },
  { icon: 'aid', name: ['First-aid kit', 'फ़र्स्ट-एड किट'], good: true },
  { icon: 'radio', name: ['Radio', 'रेडियो'], good: true },
  { icon: 'cold', name: ['Warm shawl', 'गर्म शॉल'], good: true },
  { icon: 'siren', name: ['Whistle', 'सीटी'], good: true },
  { icon: 'doc', name: ['Family phone numbers', 'परिवार के फ़ोन नंबर'], good: true },
  { icon: 'play', name: ['Video game', 'वीडियो गेम'], good: false },
  { icon: 'star', name: ['Lollipops', 'लॉलीपॉप'], good: false },
  { icon: 'fire', name: ['Candle', 'मोमबत्ती'], good: false },
  { icon: 'steps', name: ['Skateboard', 'स्केटबोर्ड'], good: false },
  { icon: 'baby', name: ['Big teddy', 'बड़ा टेडी'], good: false },
  { icon: 'cloud', name: ['Balloons', 'गुब्बारे'], good: false },
];

export interface SafeCard {
  icon: IconName;
  text: T;
  safe: boolean;
  why: T;
}

export const SAFE_CARDS: SafeCard[] = [
  { icon: 'info', text: ['Taking the lift in a fire', 'आग में लिफ़्ट लेना'], safe: false, why: ['Lifts can stop. Use the stairs.', 'लिफ़्ट रुक सकती है। सीढ़ियाँ लो।'] },
  { icon: 'info', text: ['Using the stairs to leave', 'बाहर जाने के लिए सीढ़ियाँ लेना'], safe: true, why: ['Stairs are the safe way out.', 'सीढ़ियाँ बाहर निकलने का सुरक्षित रास्ता हैं।'] },
  { icon: 'info', text: ['Touching a fallen wire', 'गिरे तार को छूना'], safe: false, why: ['Stay far away and tell a grown-up.', 'दूर रहो और बड़े को बताओ।'] },
  { icon: 'info', text: ['Drinking boiled water', 'उबला पानी पीना'], safe: true, why: ['Boiling kills germs.', 'उबालने से कीटाणु मर जाते हैं।'] },
  { icon: 'info', text: ['Swimming in flood water', 'बाढ़ के पानी में तैरना'], safe: false, why: ['It is strong, dirty and hides dangers.', 'यह तेज़, गंदा और ख़तरों से भरा है।'] },
  { icon: 'info', text: ['Hiding under a strong table in an earthquake', 'भूकंप में मज़बूत मेज़ के नीचे छिपना'], safe: true, why: ['It protects your head.', 'यह सिर को बचाती है।'] },
  { icon: 'info', text: ['Going with a stranger who has sweets', 'मिठाई वाले अजनबी के साथ जाना'], safe: false, why: ['Never go with strangers.', 'अजनबी के साथ कभी मत जाओ।'] },
  { icon: 'info', text: ['Telling a grown-up when I am scared', 'डर लगने पर बड़े को बताना'], safe: true, why: ['Grown-ups can help you.', 'बड़े तुम्हारी मदद कर सकते हैं।'] },
  { icon: 'info', text: ['Playing with matches', 'माचिस से खेलना'], safe: false, why: ['Fire is not a toy.', 'आग खिलौना नहीं है।'] },
  { icon: 'siren', text: ['Blowing a whistle to get help', 'मदद के लिए सीटी बजाना'], safe: true, why: ['A whistle is loud and easy.', 'सीटी तेज़ और आसान है।'] },
];
