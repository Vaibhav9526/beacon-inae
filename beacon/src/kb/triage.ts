import type { T } from './types';

// Guided photo triage: the phone asks a few plain yes/no questions instead of looking at the photo. Everything here
// is curated; the app only ever shows these questions and the guides they point to (ids from firstaid.ts / remedies.ts).

export type Severity = 'emergency' | 'urgent' | 'home';

export interface TriageOutcome {
  severity: Severity;
  guideIds: string[];
  reason: T;
}

export interface TriageQuestion {
  id: string;
  ask: T;
  /** What a "yes" adds. Answers can only raise severity and add guides, never remove them. */
  yes?: TriageOutcome;
}

export type TriageChoiceId = 'bleeding' | 'burn' | 'swelling' | 'cut' | 'bite' | 'rash' | 'fracture' | 'eye' | 'breathing' | 'unsure';

export interface TriageChoice {
  id: TriageChoiceId;
  emoji: string;
  label: T;
  /** Lower-case words (English and Hindi) used only to pre-select a chip from the vision model's sentence. */
  keywords: string[];
  base: TriageOutcome;
  questions: TriageQuestion[];
}

export const TRIAGE_CHOICES: TriageChoice[] = [
  {
    id: 'bleeding',
    emoji: '🩸',
    label: ['Bleeding', 'खून बहना'],
    keywords: ['bleeding', 'blood', 'bleed', 'खून', 'रक्त'],
    base: { severity: 'home', guideIds: ['minor-wound'], reason: ['Small bleeding: press with a clean cloth for 10 minutes, then cover.', 'छोटा रक्तस्राव: साफ़ कपड़े से 10 मिनट दबाएँ, फिर ढकें।'] },
    questions: [
      {
        id: 'bleed-spurt',
        ask: ['Is the blood spurting, or soaking through the cloth?', 'क्या खून फ़व्वारे की तरह निकल रहा है या कपड़ा भीग रहा है?'],
        yes: { severity: 'emergency', guideIds: ['severe-bleeding'], reason: ['Heavy bleeding can become dangerous within minutes. Press hard now and call 112.', 'तेज़ खून कुछ ही मिनटों में ख़तरनाक हो सकता है। अभी ज़ोर से दबाएँ और 112 पर कॉल करें।'] },
      },
      {
        id: 'bleed-deep',
        ask: ['Is the wound deep, long or gaping open?', 'क्या घाव गहरा, लंबा या खुला हुआ है?'],
        yes: { severity: 'urgent', guideIds: ['severe-bleeding'], reason: ['A deep or gaping wound may need stitches soon. Keep pressing and see a doctor today.', 'गहरे या खुले घाव को जल्द टाँकों की ज़रूरत हो सकती है। दबाए रखें और आज डॉक्टर को दिखाएँ।'] },
      },
    ],
  },
  {
    id: 'burn',
    emoji: '🔥',
    label: ['Burn', 'जलना'],
    keywords: ['burn', 'burnt', 'scald', 'blister', 'जल', 'जला', 'छाला'],
    base: { severity: 'home', guideIds: ['burns'], reason: ['Cool the burn under cool running water for 20 minutes. Do not use ice, ghee or toothpaste.', 'जले हुए हिस्से को 20 मिनट ठंडे बहते पानी में रखें। बर्फ़, घी या टूथपेस्ट न लगाएँ।'] },
    questions: [
      {
        id: 'burn-electric',
        ask: ['Was it caused by electricity or a chemical?', 'क्या यह बिजली या किसी रसायन से हुआ?'],
        yes: { severity: 'emergency', guideIds: ['electric-shock'], reason: ['Make sure the power or source is off before touching the person. Call 112.', 'व्यक्ति को छूने से पहले बिजली या स्रोत बंद करें। 112 पर कॉल करें।'] },
      },
      {
        id: 'burn-large',
        ask: ['Is the burn bigger than a palm, or on the face, hands, feet or a joint?', 'क्या जला हिस्सा हथेली से बड़ा है, या चेहरे, हाथ, पैर या जोड़ पर है?'],
        yes: { severity: 'urgent', guideIds: ['burns'], reason: ['Burns this size or place need a doctor the same day.', 'इतने बड़े या ऐसी जगह के जलने में उसी दिन डॉक्टर को दिखाएँ।'] },
      },
      {
        id: 'burn-deep',
        ask: ['Is the skin white, charred or leathery, or does it feel numb?', 'क्या त्वचा सफ़ेद, जली हुई या चमड़े जैसी है, या वहाँ सुन्नपन है?'],
        yes: { severity: 'emergency', guideIds: ['burns'], reason: ['Deep burns can cause shock and infection. Call 112 now.', 'गहरे जलने से सदमा और संक्रमण हो सकता है। अभी 112 पर कॉल करें।'] },
      },
    ],
  },
  {
    id: 'swelling',
    emoji: '🟣',
    label: ['Swelling or bruise', 'सूजन या नीला निशान'],
    keywords: ['swelling', 'swollen', 'bruise', 'bruised', 'bump', 'सूजन', 'सूजा', 'नील'],
    base: { severity: 'home', guideIds: ['cold-compress'], reason: ['Rest the area, put a cold pack wrapped in cloth for 15 to 20 minutes, and raise it above the heart.', 'हिस्से को आराम दें, कपड़े में लपेटा ठंडा पैक 15 से 20 मिनट रखें और दिल से ऊपर उठाकर रखें।'] },
    questions: [
      {
        id: 'swell-bent',
        ask: ['Is the limb bent, misshapen, or can the person not move it?', 'क्या अंग मुड़ा या टेढ़ा है, या व्यक्ति उसे हिला नहीं पा रहा?'],
        yes: { severity: 'urgent', guideIds: ['fracture', 'newspaper-splint'], reason: ['This may be a broken bone. Do not straighten it. Splint it and see a doctor today.', 'यह हड्डी टूटना हो सकता है। सीधा न करें। सहारा देकर आज डॉक्टर को दिखाएँ।'] },
      },
      {
        id: 'swell-numb',
        ask: ['Is the pain severe, or are the fingers or toes cold, pale, blue or numb?', 'क्या दर्द बहुत तेज़ है, या उँगलियाँ ठंडी, पीली, नीली या सुन्न हैं?'],
        yes: { severity: 'emergency', guideIds: ['fracture'], reason: ['Blood flow or nerves may be affected. Call 112 now.', 'रक्त-प्रवाह या नसों पर असर हो सकता है। अभी 112 पर कॉल करें।'] },
      },
      {
        id: 'swell-head',
        ask: ['Did they hit their head or pass out?', 'क्या सिर पर चोट लगी या वे बेहोश हुए?'],
        yes: { severity: 'emergency', guideIds: ['head-injury'], reason: ['A head injury needs checking right away. Call 112.', 'सिर की चोट की तुरंत जाँच ज़रूरी है। 112 पर कॉल करें।'] },
      },
    ],
  },
  {
    id: 'cut',
    emoji: '🩹',
    label: ['Cut or scrape', 'कट या खरोंच'],
    keywords: ['cut', 'scrape', 'scratch', 'graze', 'gash', 'wound', 'कट', 'खरोंच', 'घाव'],
    base: { severity: 'home', guideIds: ['minor-wound'], reason: ['Wash with clean water, cover with a clean dressing, and change it daily.', 'साफ़ पानी से धोएँ, साफ़ पट्टी लगाएँ और रोज़ बदलें।'] },
    questions: [
      {
        id: 'cut-bleeding',
        ask: ['Is it still bleeding after 10 minutes of pressure?', 'क्या 10 मिनट दबाने के बाद भी खून बह रहा है?'],
        yes: { severity: 'emergency', guideIds: ['severe-bleeding'], reason: ['Bleeding that does not stop needs help now. Keep pressing and call 112.', 'जो खून नहीं रुकता उसके लिए अभी मदद चाहिए। दबाए रखें और 112 पर कॉल करें।'] },
      },
      {
        id: 'cut-deep',
        ask: ['Is the cut deeper than a finger, or do the edges gape?', 'क्या कट उँगली से गहरा है, या उसके किनारे खुले हैं?'],
        yes: { severity: 'urgent', guideIds: ['minor-wound'], reason: ['It may need stitches, ideally within a few hours. See a doctor today.', 'इसे टाँकों की ज़रूरत हो सकती है, आदर्श रूप से कुछ घंटों में। आज डॉक्टर को दिखाएँ।'] },
      },
      {
        id: 'cut-dirty',
        ask: ['Was it made by a rusty or dirty object, or by an animal?', 'क्या यह ज़ंग लगी या गंदी चीज़ से, या किसी जानवर से हुआ?'],
        yes: { severity: 'urgent', guideIds: ['minor-wound', 'animal-bite'], reason: ['Dirty wounds, animal bites and scratches can get infected, and a tetanus shot may be needed. See a doctor today.', 'गंदे घाव, जानवर के काटने और खरोंच में संक्रमण हो सकता है, और टिटनेस का टीका चाहिए हो सकता है। आज डॉक्टर को दिखाएँ।'] },
      },
    ],
  },
  {
    id: 'bite',
    emoji: '🐍',
    label: ['Bite or sting', 'काटना या डंक'],
    keywords: ['bite', 'bitten', 'sting', 'stung', 'snake', 'dog', 'bee', 'wasp', 'काटा', 'डंक', 'साँप', 'कुत्ते'],
    base: { severity: 'urgent', guideIds: ['animal-bite'], reason: ['Wash the bite or sting with soap and water. Animal bites can carry infection and rabies, so see a doctor today.', 'काटने या डंक को साबुन और पानी से धोएँ। जानवर के काटने से संक्रमण और रेबीज़ हो सकता है, इसलिए आज डॉक्टर को दिखाएँ।'] },
    questions: [
      {
        id: 'bite-snake',
        ask: ['Could it be a snake bite?', 'क्या यह साँप का काटना हो सकता है?'],
        yes: { severity: 'emergency', guideIds: ['snake-bite'], reason: ['Snake bites can be deadly. Keep the person still and calm, and call 112.', 'साँप का काटना जानलेवा हो सकता है। व्यक्ति को शांत और स्थिर रखें और 112 पर कॉल करें।'] },
      },
      {
        id: 'bite-breath',
        ask: ['Is there trouble breathing or swallowing, or are the face or lips swelling?', 'क्या साँस या निगलने में दिक़्क़त है, या चेहरे या होंठ सूज रहे हैं?'],
        yes: { severity: 'emergency', guideIds: ['allergic-reaction'], reason: ['This can be a severe allergic reaction. Call 112 now.', 'यह गंभीर एलर्जी हो सकती है। अभी 112 पर कॉल करें।'] },
      },
    ],
  },
  {
    id: 'rash',
    emoji: '🟥',
    label: ['Rash', 'दाने'],
    keywords: ['rash', 'hives', 'itch', 'itchy', 'allergy', 'दाने', 'दाना', 'खुजली'],
    base: { severity: 'home', guideIds: ['allergic-reaction'], reason: ['Keep the skin cool and clean and do not scratch. Avoid the thing that may have caused it.', 'त्वचा को ठंडा और साफ़ रखें, खुजलाएँ नहीं। जिस चीज़ से हुआ हो उससे दूर रहें।'] },
    questions: [
      {
        id: 'rash-throat',
        ask: ['Are the face, lips or tongue swelling, or is breathing or swallowing hard?', 'क्या चेहरा, होंठ या जीभ सूज रहे हैं, या साँस या निगलने में दिक़्क़त है?'],
        yes: { severity: 'emergency', guideIds: ['allergic-reaction'], reason: ['Swelling of the face or throat can block breathing. Call 112 now.', 'चेहरे या गले की सूजन साँस रोक सकती है। अभी 112 पर कॉल करें।'] },
      },
      {
        id: 'rash-spread',
        ask: ['Is it spreading fast, with blisters, fever, or red and painful skin?', 'क्या यह तेज़ी से फैल रहा है, छाले, बुखार, या लाल और दर्द वाली त्वचा है?'],
        yes: { severity: 'urgent', guideIds: ['allergic-reaction'], reason: ['A spreading or infected rash needs a doctor today.', 'फैलते या संक्रमित दाने के लिए आज डॉक्टर चाहिए।'] },
      },
    ],
  },
  {
    id: 'fracture',
    emoji: '🦴',
    label: ['Fracture or bent limb', 'हड्डी टूटना या मुड़ा अंग'],
    keywords: ['fracture', 'broken', 'bone', 'bent', 'limb', 'टूट', 'हड्डी', 'मुड़ा'],
    base: { severity: 'urgent', guideIds: ['fracture', 'newspaper-splint'], reason: ['Do not straighten the limb. Support it in the position it is in and splint it.', 'अंग को सीधा न करें। जिस हालत में है उसी में सहारा दें और सहारा-पट्टी लगाएँ।'] },
    questions: [
      {
        id: 'fx-open',
        ask: ['Is there an open wound, or is bone showing?', 'क्या घाव खुला है, या हड्डी दिख रही है?'],
        yes: { severity: 'emergency', guideIds: ['fracture', 'severe-bleeding'], reason: ['An open fracture bleeds and can get infected. Cover the wound loosely and call 112. Do not push the bone back in.', 'खुली हड्डी से खून बहता है और संक्रमण होता है। घाव ढीला ढकें, 112 पर कॉल करें। हड्डी अंदर न धकेलें।'] },
      },
      {
        id: 'fx-cold',
        ask: ['Are the fingers or toes cold, pale, blue or numb?', 'क्या उँगलियाँ या पैर की उँगलियाँ ठंडी, पीली, नीली या सुन्न हैं?'],
        yes: { severity: 'emergency', guideIds: ['fracture'], reason: ['Blood flow may be cut off. Call 112 now.', 'रक्त-प्रवाह रुक सकता है। अभी 112 पर कॉल करें।'] },
      },
      {
        id: 'fx-fall',
        ask: ['Did the person fall from a height or in a crash?', 'क्या व्यक्ति ऊँचाई से गिरा या दुर्घटना हुई?'],
        yes: { severity: 'urgent', guideIds: ['head-injury'], reason: ['Check for head and neck injury before moving them.', 'हिलाने से पहले सिर और गर्दन की चोट देखें।'] },
      },
    ],
  },
  {
    id: 'eye',
    emoji: '👁️',
    label: ['Eye or face', 'आँख या चेहरा'],
    keywords: ['eye', 'eyes', 'face', 'eyelid', 'आँख', 'चेहरा'],
    base: { severity: 'urgent', guideIds: ['eye-injury'], reason: ['Do not rub the eye or press on it. Eye problems should be checked by a doctor the same day.', 'आँख को न रगड़ें, न दबाएँ। आँख की समस्या उसी दिन डॉक्टर को दिखाएँ।'] },
    questions: [
      {
        id: 'eye-stuck',
        ask: ['Is something stuck in the eye, or is the eyeball cut?', 'क्या आँख में कुछ धँसा है, या आँख की सतह कटी है?'],
        yes: { severity: 'emergency', guideIds: ['eye-injury'], reason: ['Do not remove anything. Cover the eye loosely with a cup or clean cloth and call 112.', 'कुछ न निकालें। आँख को कप या साफ़ कपड़े से ढीला ढकें और 112 पर कॉल करें।'] },
      },
      {
        id: 'eye-chem',
        ask: ['Is it a chemical splash in the eye?', 'क्या आँख में किसी रसायन के छींटे पड़े हैं?'],
        yes: { severity: 'emergency', guideIds: ['eye-injury'], reason: ['Rinse with clean water for 15 minutes right away. Call 112.', 'तुरंत 15 मिनट साफ़ पानी से धोएँ। 112 पर कॉल करें।'] },
      },
      {
        id: 'eye-vision',
        ask: ['Has the person suddenly lost sight, or is the vision going dark?', 'क्या अचानक दिखना बंद हुआ है, या नज़र धुंधली हो रही है?'],
        yes: { severity: 'emergency', guideIds: [], reason: ['Sudden loss of sight needs emergency care now. Call 112 and do not rub the eye.', 'अचानक दिखना बंद होना तुरंत इलाज की ज़रूरत है। अभी 112 पर कॉल करें और आँख न रगड़ें।'] },
      },
      {
        id: 'eye-head',
        ask: ['Did they also hit the head, or are they confused or vomiting?', 'क्या सिर पर भी चोट लगी, या वे भ्रमित हैं या उल्टी कर रहे हैं?'],
        yes: { severity: 'emergency', guideIds: ['head-injury'], reason: ['A blow to the head with confusion or vomiting needs emergency care.', 'सिर पर चोट के साथ भ्रम या उल्टी हो तो तुरंत इलाज चाहिए।'] },
      },
    ],
  },
  {
    id: 'breathing',
    emoji: '😮‍💨',
    label: ['Choking or breathing', 'गला घुटना या साँस की दिक़्क़त'],
    keywords: ['choking', 'choke', 'breathing', 'breath', 'gasping', 'गला', 'साँस', 'दम'],
    base: { severity: 'emergency', guideIds: [], reason: ['Trouble breathing is an emergency. Call 112 now and stay with them.', 'साँस लेने में दिक़्क़त आपात स्थिति है। अभी 112 पर कॉल करें और उनके पास रहें।'] },
    questions: [
      {
        id: 'breath-choking',
        ask: ['Is something stuck in the throat, and can they not cough, speak or breathe?', 'क्या गले में कुछ अटका है, और वे खाँस, बोल या साँस नहीं ले पा रहे?'],
        yes: { severity: 'emergency', guideIds: ['choking-adult'], reason: ['Give first aid for choking as the guide shows, and call 112 now.', 'गाइड में दिए तरीक़े से गले में अटकने का प्राथमिक उपचार करें, और अभी 112 पर कॉल करें।'] },
      },
      {
        id: 'breath-unconscious',
        ask: ['Are they unconscious, or not breathing normally?', 'क्या वे बेहोश हैं, या ठीक से साँस नहीं ले रहे?'],
        yes: { severity: 'emergency', guideIds: ['cpr-adult', 'recovery-position'], reason: ['Start CPR if they are not breathing normally. Call 112 and keep the line open.', 'ठीक से साँस न लें तो CPR शुरू करें। 112 पर कॉल करें और लाइन खुली रखें।'] },
      },
      {
        id: 'breath-baby',
        ask: ['Is the person a baby (under one year old)?', 'क्या व्यक्ति एक साल से छोटा शिशु है?'],
        yes: { severity: 'emergency', guideIds: ['choking-infant'], reason: ['If a baby is choking, use the infant method. Do not use belly thrusts on a baby. Call 112.', 'अगर शिशु के गले में अटका है तो शिशु वाला तरीक़ा अपनाएँ। शिशु के पेट पर झटके न दें। 112 पर कॉल करें।'] },
      },
      {
        id: 'breath-smoke',
        ask: ['Is there smoke, gas or fire near them?', 'क्या उनके पास धुआँ, गैस या आग है?'],
        yes: { severity: 'emergency', guideIds: ['smoke-fire'], reason: ['Move them out of smoke only if it is safe for you to do so.', 'धुएँ से बाहर तभी निकालें जब आपके लिए सुरक्षित हो।'] },
      },
    ],
  },
  {
    id: 'unsure',
    emoji: '❓',
    label: ['Not sure', 'पता नहीं'],
    keywords: [],
    base: { severity: 'urgent', guideIds: [], reason: ['If you are not sure, have a doctor or nurse look at it today. Call 112 if the person is getting worse.', 'अगर पक्का नहीं है, तो आज डॉक्टर या नर्स को दिखाएँ। हालत बिगड़े तो 112 पर कॉल करें।'] },
    questions: [
      {
        id: 'unsure-conscious',
        ask: ['Is the person unconscious, confused, or hard to wake?', 'क्या व्यक्ति बेहोश है, भ्रमित है, या जगाना मुश्किल है?'],
        yes: { severity: 'emergency', guideIds: ['recovery-position', 'cpr-adult'], reason: ['Call 112 now. Check breathing, and put them in the recovery position if they are breathing.', 'अभी 112 पर कॉल करें। साँस देखें, और साँस चल रही हो तो रिकवरी पोज़िशन में लिटाएँ।'] },
      },
      {
        id: 'unsure-severe',
        ask: ['Is there heavy bleeding, trouble breathing, or severe pain?', 'क्या खून बहुत बह रहा है, साँस में दिक़्क़त है, या तेज़ दर्द है?'],
        yes: { severity: 'emergency', guideIds: [], reason: ['Call 112 now and keep watching their breathing.', 'अभी 112 पर कॉल करें और उनकी साँस देखते रहें।'] },
      },
    ],
  },
];

export const getTriageChoice = (id: TriageChoiceId): TriageChoice | undefined => TRIAGE_CHOICES.find((c) => c.id === id);
