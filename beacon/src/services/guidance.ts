// "What should I do now, for MY household": deterministic, offline, conservative guidance.
// Pure on purpose (no react-native imports) so it runs under the test runner.
// It never gives doses or diagnoses. Every personalised step says which household fact triggered it.

import { DISASTERS } from '../kb/disasters';
import { dodontFor } from '../kb/dodont';

export type AgeBand = 'child' | 'adult' | 'elder';
export type ConditionId =
  | 'heart'
  | 'diabetes'
  | 'insulin'
  | 'asthma'
  | 'hypertension'
  | 'pregnant'
  | 'epilepsy'
  | 'mobility'
  | 'oxygen'
  | 'dialysis'
  | 'sensory';

export interface HouseholdMedicine {
  id: string;
  name: string;
  /** must not miss */
  critical: boolean;
  /** days of stock left, null when unknown */
  daysLeft: number | null;
}

export interface Person {
  id: string;
  name: string;
  age: AgeBand;
  conditions: ConditionId[];
  otherCondition: string;
  medicines: HouseholdMedicine[];
  languages: string[];
}

export type FloorLevel = 'basement' | 'ground' | 'first' | 'second_up';
export type BuildingType = 'kutcha' | 'pucca' | 'apartment';

export interface HomeInfo {
  floor: FloorLevel | null;
  building: BuildingType | null;
  nearWater: boolean | null;
  hasVehicle: boolean | null;
  pets: number;
  shelterName: string | null;
  meetingPoint: string;
}

export interface Household {
  people: Person[];
  home: HomeInfo;
}

export const EMPTY_HOME: HomeInfo = {
  floor: null,
  building: null,
  nearWater: null,
  hasVehicle: null,
  pets: 0,
  shelterName: null,
  meetingPoint: '',
};

export type GuidanceHazard = 'earthquake' | 'flood' | 'cyclone' | 'landslide' | 'heatwave' | 'lightning' | 'tsunami' | 'fire';
export type GuidancePhase = 'prepare' | 'alert' | 'recover';
export type Urgency = 'now' | 'soon' | 'prepare';
export type Bi = { en: string; hi: string };

export interface GuidanceStep {
  id: string;
  who?: string;
  text: Bi;
  urgency: Urgency;
  why?: Bi;
}

export interface GuidanceInput {
  phase: GuidancePhase;
  hazard: GuidanceHazard | null;
  severity: 'watch' | 'warning' | 'severe' | null;
  household: Household;
  hourOfDay?: number;
  hoursToImpact?: number | null;
}

export interface Guidance {
  headline: string;
  headlineHi: string;
  steps: GuidanceStep[];
  packList: string[];
  packListHi: string[];
  avoid: string[];
  avoidHi: string[];
}

/** True when the household has no useful data yet. */
export function isHouseholdEmpty(h: Household): boolean {
  const o = h.home;
  return (
    h.people.length === 0 &&
    !o.floor &&
    !o.building &&
    o.nearWater == null &&
    o.hasVehicle == null &&
    o.pets === 0 &&
    !o.shelterName &&
    !o.meetingPoint.trim()
  );
}

const EVAC: GuidanceHazard[] = ['flood', 'cyclone', 'tsunami', 'landslide'];
const WORD: Record<GuidanceHazard, Bi> = {
  earthquake: { en: 'earthquake', hi: 'भूकंप' },
  flood: { en: 'flood', hi: 'बाढ़' },
  cyclone: { en: 'cyclone', hi: 'चक्रवात' },
  landslide: { en: 'landslide', hi: 'भूस्खलन' },
  heatwave: { en: 'heatwave', hi: 'लू' },
  lightning: { en: 'lightning', hi: 'बिजली' },
  tsunami: { en: 'tsunami', hi: 'सुनामी' },
  fire: { en: 'fire', hi: 'आग' },
};

const FLOOR_WORD: Record<FloorLevel, Bi> = {
  basement: { en: 'a basement', hi: 'तहख़ाने' },
  ground: { en: 'the ground floor', hi: 'भूतल' },
  first: { en: 'the first floor', hi: 'पहली मंज़िल' },
  second_up: { en: 'the second floor or higher', hi: 'दूसरी मंज़िल या ऊपर' },
};

const URG_ORDER: Record<Urgency, number> = { now: 0, soon: 1, prepare: 2 };

const has = (p: Person, c: ConditionId) => p.conditions.includes(c);
const nm = (p: Person) => p.name.trim() || undefined;
const nameOr = (p: Person, en: string, hi: string): Bi => ({ en: nm(p) ?? en, hi: nm(p) ?? hi });

export function personalGuidance(input: GuidanceInput): Guidance {
  const { phase, hazard, severity, household } = input;
  const people = household.people;
  const home = household.home;
  const steps: GuidanceStep[] = [];
  const pack: Array<[string, string]> = [];
  const avoid: Array<[string, string]> = [];
  const push = (s: GuidanceStep) => {
    if (steps.some((x) => x.id === s.id)) return;
    steps.push({ ...s, text: { ...s.text, en: cap(s.text.en) }, why: s.why ? { ...s.why, en: cap(s.why.en) } : undefined });
  };
  const addPack = (en: string, hi: string) => {
    if (!pack.some((x) => x[0] === en)) pack.push([en, hi]);
  };
  const addAvoid = (en: string, hi: string) => {
    if (!avoid.some((x) => x[0] === en)) avoid.push([en, hi]);
  };

  const evac = hazard != null && EVAC.includes(hazard);
  /** urgency for an action that should happen before impact */
  const act: Urgency = phase === 'alert' ? (severity === 'watch' ? 'soon' : 'now') : 'prepare';
  const live = phase !== 'recover';
  const hz = hazard ? WORD[hazard] : null;

  // ---- base lines from the app's own do / don't, disaster before / after lists ----
  if (hazard) {
    const en = dodontFor(hazard, 'en');
    const hi = dodontFor(hazard, 'hi');
    if (phase === 'alert' && en && hi) {
      en.do.forEach((t, i) => push({ id: `base-${hazard}-${i}`, text: { en: t, hi: hi.do[i] ?? t }, urgency: i < 2 ? 'now' : 'soon' }));
    }
    if (en && hi) en.dont.forEach((t, i) => addAvoid(t, hi.dont[i] ?? t));
    const d = DISASTERS.find((x) => x.id === hazard);
    if (d && phase === 'prepare') {
      d.before.slice(0, 3).forEach((t, i) => push({ id: `base-before-${hazard}-${i}`, text: { en: t[0], hi: t[1] }, urgency: 'prepare' }));
    }
    if (!d && en && hi && phase !== 'alert') {
      en.do.slice(0, 2).forEach((t, i) =>
        push({ id: `base-kb-${hazard}-${i}`, text: { en: t, hi: hi.do[i] ?? t }, urgency: phase === 'prepare' ? 'prepare' : 'soon' }),
      );
    }
    if (d && phase === 'recover') {
      d.after.slice(0, 3).forEach((t, i) => push({ id: `base-after-${hazard}-${i}`, text: { en: t[0], hi: t[1] }, urgency: 'soon' }));
    }
  } else if (phase === 'alert') {
    push({ id: 'base-generic-alert', text: { en: 'Stay calm, keep your phone charged and follow official instructions.', hi: 'शांत रहें, फ़ोन चार्ज रखें और सरकारी निर्देश मानें।' }, urgency: 'now' });
  } else if (phase === 'prepare') {
    push({ id: 'base-generic-prepare', text: { en: 'Pack a go-bag and agree on a family meeting point.', hi: 'गो-बैग तैयार करें और परिवार के मिलने की जगह तय करें।' }, urgency: 'prepare' });
  } else {
    push({ id: 'base-generic-recover', text: { en: 'Check everyone for injuries and avoid damaged buildings.', hi: 'सबकी चोट देखें और क्षतिग्रस्त इमारतों से दूर रहें।' }, urgency: 'soon' });
  }

  // ---- home ----
  if (live && hazard && (hazard === 'flood' || hazard === 'cyclone' || hazard === 'tsunami') && (home.floor === 'basement' || home.floor === 'ground')) {
    const basement = home.floor === 'basement';
    push({
      id: 'home-low-floor',
      text: {
        en: phase === 'alert'
          ? 'Move up to a higher floor or out to higher ground now. Do not wait for water to enter.'
          : 'Plan where you will go up or out: a higher floor, roof access or higher ground, and how to get there.',
        hi: phase === 'alert'
          ? 'अभी ऊपर की मंज़िल या ऊँची जगह पर जाएँ। पानी घर में आने का इंतज़ार न करें।'
          : 'तय करें कि ऊपर या बाहर कहाँ जाएँगे: ऊँची मंज़िल, छत या ऊँची जगह, और वहाँ कैसे पहुँचेंगे।',
      },
      urgency: act,
      why: {
        en: `You live on ${FLOOR_WORD[home.floor].en}, which is the first to be hit by ${hz!.en} water.`,
        hi: `आप ${FLOOR_WORD[home.floor].hi} में रहते हैं, जहाँ ${hz!.hi} का पानी सबसे पहले पहुँचता है।`,
      },
    });
    if (basement) addAvoid('Do not stay in the basement during rising water', 'पानी बढ़ने पर तहख़ाने में न रहें');
  }

  if (live && home.nearWater === true && (hazard === 'flood' || hazard === 'landslide' || hazard === 'cyclone')) {
    if (phase === 'alert' && severity !== 'severe') {
      push({
        id: 'home-near-water',
        text: {
          en: 'Do not wait for a severe warning. Start moving to higher ground with your go-bag now.',
          hi: 'गंभीर चेतावनी का इंतज़ार न करें। गो-बैग लेकर अभी ऊँची जगह की ओर निकलें।',
        },
        urgency: 'now',
        why: { en: 'You live near a river, coast or low-lying area, where heavy rain turns dangerous quickly.', hi: 'आप नदी, तट या नीचे इलाक़े के पास रहते हैं, जहाँ भारी बारिश जल्दी ख़तरनाक हो जाती है।' },
      });
    } else if (phase === 'prepare') {
      push({
        id: 'home-near-water-prep',
        text: { en: 'Know your high-ground route and leave at the first heavy-rain warning.', hi: 'ऊँची जगह का रास्ता जानें और भारी बारिश की पहली चेतावनी पर निकल जाएँ।' },
        urgency: 'prepare',
        why: { en: 'You live near a river, coast or low-lying area.', hi: 'आप नदी, तट या नीचे इलाक़े के पास रहते हैं।' },
      });
    }
  }

  if (live && home.building === 'kutcha' && (hazard === 'cyclone' || hazard === 'flood' || hazard === 'earthquake')) {
    const quake = hazard === 'earthquake';
    push({
      id: 'home-kutcha',
      text: {
        en: quake
          ? 'When the shaking stops, move to open ground away from walls and wait for aftershocks.'
          : phase === 'alert'
            ? 'Leave for a stronger building or the nearest shelter before the worst arrives.'
            : 'Choose a stronger building or shelter you can reach, and decide when you will leave.',
        hi: quake
          ? 'झटके रुकते ही दीवारों से दूर खुली जगह पर जाएँ और आफ़्टरशॉक का इंतज़ार करें।'
          : phase === 'alert'
            ? 'सबसे बुरे समय से पहले मज़बूत इमारत या नज़दीकी आश्रय में चले जाएँ।'
            : 'पहुँच में मज़बूत इमारत या आश्रय चुनें और तय करें कि कब निकलेंगे।',
      },
      urgency: act,
      why: { en: 'Your house is kutcha, so its walls and roof may not hold in a strong ' + hz!.en + '.', hi: 'आपका घर कच्चा है, इसलिए तेज़ ' + hz!.hi + ' में दीवारें और छत टिक न पाएँ।' },
    });
  }

  if (live && evac && home.shelterName) {
    push({
      id: 'home-shelter',
      text: { en: `Head for your saved shelter: ${home.shelterName}.`, hi: `अपने सहेजे आश्रय की ओर जाएँ: ${home.shelterName}।` },
      urgency: act,
      why: { en: 'You saved this shelter in your household.', hi: 'आपने इसे अपने घर की जानकारी में सहेजा है।' },
    });
  } else if (phase === 'prepare' && evac && !home.shelterName) {
    push({
      id: 'home-no-shelter',
      text: { en: 'Find your nearest shelter on the map and save it.', hi: 'नक्शे पर नज़दीकी आश्रय खोजकर सहेजें।' },
      urgency: 'prepare',
      why: { en: 'You have not saved a shelter yet.', hi: 'आपने अभी तक कोई आश्रय नहीं सहेजा है।' },
    });
  }

  if (live && home.meetingPoint.trim() && hazard) {
    push({
      id: 'home-meeting',
      text: { en: `If you get separated, meet at ${home.meetingPoint.trim()}.`, hi: `बिछड़ जाएँ तो ${home.meetingPoint.trim()} पर मिलें।` },
      urgency: phase === 'alert' ? 'soon' : 'prepare',
      why: { en: 'This is your family meeting point.', hi: 'यह आपके परिवार के मिलने की जगह है।' },
    });
  }

  if (phase === 'alert' && evac && home.hasVehicle === true && hazard !== 'landslide') {
    push({
      id: 'home-vehicle',
      text: { en: 'Leave early by vehicle, with fuel, and take those who cannot walk far. Never drive through water.', hi: 'वाहन से जल्दी निकलें, ईंधन के साथ, और जो दूर पैदल न चल सकें उन्हें साथ लें। पानी में गाड़ी न चलाएँ।' },
      urgency: act,
      why: { en: 'You have a vehicle.', hi: 'आपके पास वाहन है।' },
    });
  }

  if (home.pets > 0 && hazard) {
    if (live && evac) {
      push({
        id: 'pets-evac',
        text: { en: 'Take your pets with you on a leash or in a carrier, with food and water.', hi: 'पालतू जानवरों को पट्टे या टोकरी में, खाने-पानी के साथ अपने साथ ले जाएँ।' },
        urgency: act,
        why: { en: `You have ${home.pets} pet${home.pets > 1 ? 's' : ''}.`, hi: `आपके पास ${home.pets} पालतू जानवर हैं।` },
      });
    } else if (live && hazard === 'heatwave') {
      push({
        id: 'pets-heat',
        text: { en: 'Keep pets in shade with fresh water. Never leave them in a parked vehicle.', hi: 'पालतू जानवरों को छाँव में ताज़ा पानी के साथ रखें। खड़ी गाड़ी में कभी न छोड़ें।' },
        urgency: act,
        why: { en: `You have ${home.pets} pet${home.pets > 1 ? 's' : ''}.`, hi: `आपके पास ${home.pets} पालतू जानवर हैं।` },
      });
    }
    addPack('Pet food, water bowl and leash', 'पालतू का खाना, कटोरा और पट्टा');
  }

  // ---- people ----
  const adults = people.filter((p) => p.age === 'adult');
  const kids = people.filter((p) => p.age === 'child');

  for (const p of people) {
    const who = nm(p);
    const label = who ?? 'a family member';
    const labelHi = who ?? 'परिवार का एक सदस्य';
    const base = { who };

    if (has(p, 'mobility') && live && hazard && (evac || hazard === 'fire' || hazard === 'earthquake')) {
      const helper = adults.find((a) => a.id !== p.id && nm(a));
      const helperAny = adults.find((a) => a.id !== p.id);
      const hn = helper ? nm(helper)! : helperAny ? 'another adult' : 'a neighbour';
      const hnHi = helper ? nm(helper)! : helperAny ? 'दूसरा वयस्क' : 'पड़ोसी';
      if (evac) {
        push({
          id: `mobility-${p.id}`,
          ...base,
          text: {
            en: `Start moving ${label} early, well before others. ${hn} should help and stay with them.`,
            hi: `${labelHi} को दूसरों से काफ़ी पहले चलाना शुरू करें। ${hnHi} मदद करे और साथ रहे।`,
          },
          urgency: act,
          why: { en: `${label} has limited mobility, so leaving takes longer.`, hi: `${labelHi} को चलने में दिक़्क़त है, इसलिए निकलने में ज़्यादा समय लगता है।` },
        });
      } else {
        push({
          id: `mobility-${p.id}`,
          ...base,
          text: {
            en: `${hn} should stay with ${label} and know the quickest safe way out.`,
            hi: `${hnHi} ${labelHi} के साथ रहे और बाहर निकलने का सबसे छोटा सुरक्षित रास्ता जाने।`,
          },
          urgency: act,
          why: { en: `${label} has limited mobility.`, hi: `${labelHi} को चलने में दिक़्क़त है।` },
        });
      }
    }

    const powerDependent = has(p, 'oxygen') || has(p, 'dialysis');
    const insulin = has(p, 'insulin');
    if ((powerDependent || insulin) && phase !== 'recover') {
      const what = has(p, 'oxygen') ? 'oxygen' : has(p, 'dialysis') ? 'dialysis' : 'insulin';
      const whatHi = has(p, 'oxygen') ? 'ऑक्सीजन' : has(p, 'dialysis') ? 'डायलिसिस' : 'इंसुलिन';
      if (insulin) {
        push({
          id: `insulin-${p.id}`,
          ...base,
          text: { en: `Pack ${label}'s medicines with a cold pack and check how they will stay cool if power is lost.`, hi: `${labelHi} की दवाइयाँ कोल्ड पैक के साथ रखें और देखें कि बिजली जाने पर ठंडी कैसे रहेंगी।` },
          urgency: act,
          why: { en: `${label} uses insulin, which must be kept cool.`, hi: `${labelHi} इंसुलिन लेते हैं, जिसे ठंडा रखना ज़रूरी है।` },
        });
        addPack('Cold pack or insulated pouch for insulin', 'इंसुलिन के लिए कोल्ड पैक या इंसुलेटेड पाउच');
        addPack('Glucose meter and strips', 'ग्लूकोज़ मीटर और स्ट्रिप');
      }
      if (powerDependent) {
        push({
          id: `power-${p.id}`,
          ...base,
          text: {
            en: `Check ${label}'s battery backup now. If power is lost for more than a few hours, go to a hospital shelter or call 112.`,
            hi: `${labelHi} का बैटरी बैकअप अभी जाँचें। कुछ घंटे से ज़्यादा बिजली जाए तो अस्पताल के आश्रय जाएँ या 112 पर कॉल करें।`,
          },
          urgency: act,
          why: { en: `${label} depends on ${what}, which needs power or supplies.`, hi: `${labelHi} ${whatHi} पर निर्भर हैं, जिसके लिए बिजली या सामान चाहिए।` },
        });
        addPack('Spare battery or power bank for medical equipment', 'चिकित्सा उपकरण के लिए अतिरिक्त बैटरी या पावर बैंक');
        if (has(p, 'oxygen')) addPack('Spare oxygen cylinder or portable concentrator', 'अतिरिक्त ऑक्सीजन सिलेंडर या पोर्टेबल कंसंट्रेटर');
        if (has(p, 'dialysis')) addPack('Dialysis centre phone number and treatment papers', 'डायलिसिस केंद्र का नंबर और इलाज के काग़ज़');
      }
    }

    if (has(p, 'pregnant') && phase !== 'recover' && hazard) {
      push({
        id: `pregnant-${p.id}`,
        ...base,
        text: { en: `Keep ${label} calm and resting, know the nearest hospital, and avoid crowds.`, hi: `${labelHi} को शांत और आराम में रखें, नज़दीकी अस्पताल जानें और भीड़ से बचें।` },
        urgency: act,
        why: { en: `${label} is pregnant.`, hi: `${labelHi} गर्भवती हैं।` },
      });
      addPack('Maternity health card and papers', 'मातृत्व स्वास्थ्य कार्ड और काग़ज़ात');
    }

    if (has(p, 'asthma') && hazard && (hazard === 'heatwave' || hazard === 'fire' || hazard === 'earthquake' || hazard === 'landslide' || phase === 'recover')) {
      push({
        id: `asthma-${p.id}`,
        ...base,
        text: { en: `Keep ${label}'s inhaler packed and within reach, and use a mask or a damp cloth over nose and mouth in smoke or dust.`, hi: `${labelHi} का इनहेलर पैक और पहुँच में रखें, और धुएँ या धूल में नाक-मुँह पर मास्क या गीला कपड़ा रखें।` },
        urgency: phase === 'recover' ? 'soon' : act,
        why: { en: `${label} has asthma or COPD, and smoke, dust and heat can trigger breathing trouble.`, hi: `${labelHi} को अस्थमा/सीओपीडी है, और धुआँ, धूल व गर्मी साँस की तकलीफ़ बढ़ा सकती हैं।` },
      });
    }
    if (has(p, 'asthma')) {
      addPack('Inhaler, kept within reach', 'इनहेलर, पहुँच में');
      addPack('Masks or clean cloth', 'मास्क या साफ़ कपड़ा');
    }

    if ((has(p, 'heart') || has(p, 'hypertension')) && hazard === 'heatwave' && live) {
      push({
        id: `heart-heat-${p.id}`,
        ...base,
        text: { en: `${label} should avoid exertion, rest in shade or a cool room, and drink fluids unless their doctor has limited them.`, hi: `${labelHi} मेहनत से बचें, छाँव या ठंडे कमरे में आराम करें, और डॉक्टर ने रोका न हो तो पानी पीते रहें।` },
        urgency: act,
        why: { en: `${label} has a heart condition or high blood pressure, and heat adds strain.`, hi: `${labelHi} को हृदय रोग या उच्च रक्तचाप है, और गर्मी से दबाव बढ़ता है।` },
      });
    }
    if ((has(p, 'heart') || has(p, 'hypertension') || has(p, 'diabetes')) && live && hazard && hazard !== 'heatwave') {
      push({
        id: `chronic-${p.id}`,
        ...base,
        text: { en: `Keep ${label}'s regular medicines with you and do not skip them in the rush.`, hi: `${labelHi} की नियमित दवाइयाँ साथ रखें और भागदौड़ में छूटने न दें।` },
        urgency: act,
        why: { en: `${label} has a long-term condition that needs regular medicines.`, hi: `${labelHi} को लंबी बीमारी है जिसमें नियमित दवाइयाँ चाहिए।` },
      });
    }

    if (has(p, 'epilepsy') && live && hazard) {
      push({
        id: `epilepsy-${p.id}`,
        ...base,
        text: { en: `Keep ${label}'s medicines with them and make sure whoever is nearby knows what to do if a seizure happens.`, hi: `${labelHi} की दवाइयाँ उनके पास रखें और पास के लोगों को बताएँ कि दौरा पड़े तो क्या करना है।` },
        urgency: act,
        why: { en: `${label} has epilepsy.`, hi: `${labelHi} को मिर्गी है।` },
      });
    }

    if (has(p, 'sensory') && live && hazard) {
      push({
        id: `sensory-${p.id}`,
        ...base,
        text: { en: `Keep ${label} with a helper who can warn them in person, since sirens and announcements may be missed.`, hi: `${labelHi} को ऐसे साथी के साथ रखें जो सामने बताकर चेताए, क्योंकि सायरन और घोषणाएँ छूट सकती हैं।` },
        urgency: act,
        why: { en: `${label} has a vision or hearing difficulty.`, hi: `${labelHi} को देखने या सुनने में दिक़्क़त है।` },
      });
      addPack('Spectacles, hearing aid and spare batteries', 'चश्मा, सुनने की मशीन और अतिरिक्त बैटरी');
    }

    // medicines
    for (const m of p.medicines) {
      if (!m.name.trim()) continue;
      addPack(`${m.name.trim()}${m.critical ? ' (must not miss)' : ''}`, `${m.name.trim()}${m.critical ? ' (छूटनी नहीं चाहिए)' : ''}`);
    }
    const low = p.medicines.filter((m) => m.name.trim() && m.daysLeft != null && m.daysLeft < 3);
    if (low.length && phase !== 'alert') {
      const names = low.map((m) => m.name.trim()).join(', ');
      push({
        id: `restock-${p.id}`,
        ...base,
        text: { en: `Restock now: ${names}. Ask a pharmacy or doctor before you run out.`, hi: `अभी भरपाई करें: ${names}। ख़त्म होने से पहले दवाई की दुकान या डॉक्टर से पूछें।` },
        urgency: 'now',
        why: { en: `${nameOr(p, 'A family member', '').en}'s stock of ${names} is under 3 days.`, hi: `${nm(p) ?? 'परिवार के सदस्य'} के पास ${names} का स्टॉक 3 दिन से कम है।` },
      });
    } else if (low.length && phase === 'alert') {
      push({
        id: `restock-${p.id}`,
        ...base,
        text: { en: `Tell a relief worker or health post early that you are low on: ${low.map((m) => m.name.trim()).join(', ')}.`, hi: `राहतकर्मी या स्वास्थ्य केंद्र को पहले बता दें कि इनका स्टॉक कम है: ${low.map((m) => m.name.trim()).join(', ')}।` },
        urgency: 'soon',
        why: { en: 'Stock is under 3 days.', hi: 'स्टॉक 3 दिन से कम है।' },
      });
    }
    const crit = p.medicines.filter((m) => m.critical && m.name.trim());
    if (crit.length && live && hazard && phase === 'alert') {
      push({
        id: `crit-${p.id}`,
        ...base,
        text: { en: `Put ${crit.map((m) => m.name.trim()).join(', ')} in the go-bag now and carry them yourself.`, hi: `${crit.map((m) => m.name.trim()).join(', ')} अभी गो-बैग में रखें और ख़ुद साथ रखें।` },
        urgency: 'now',
        why: { en: 'You marked these as must not miss.', hi: 'आपने इन्हें "छूटनी नहीं चाहिए" चिह्नित किया है।' },
      });
    }

    if (p.age === 'elder') {
      addPack('Spectacles, walking stick or support if used', 'चश्मा, छड़ी या सहारा अगर इस्तेमाल करते हों');
    }
  }

  if (kids.length && hazard && phase !== 'recover') {
    const names = kids.map((k) => nm(k)).filter(Boolean).join(', ');
    push({
      id: 'kids-together',
      text: {
        en: 'Keep children close, give each a name tag with a phone number, and tell them one simple thing: stay with an adult.',
        hi: 'बच्चों को पास रखें, हर बच्चे को फ़ोन नंबर वाला नाम-पर्चा दें, और एक सीधी बात बताएँ: बड़े के साथ रहना।',
      },
      urgency: phase === 'alert' ? 'now' : 'prepare',
      who: names || undefined,
      why: { en: `Your household includes ${kids.length === 1 ? 'a child' : kids.length + ' children'}.`, hi: `आपके घर में ${kids.length === 1 ? 'एक बच्चा' : kids.length + ' बच्चे'} हैं।` },
    });
  }
  if (kids.length) {
    addPack('Name tag with phone number for each child', 'हर बच्चे के लिए फ़ोन नंबर वाला नाम-पर्चा');
    addPack('Snacks, a small toy, diapers or baby food if needed', 'नाश्ता, छोटा खिलौना, ज़रूरत हो तो डायपर या बच्चों का खाना');
    addPack('ORS sachets', 'ORS के पैकेट');
  }
  if (hazard === 'heatwave') addPack('ORS sachets and water', 'ORS के पैकेट और पानी');
  if (people.length) addPack('Copies of IDs and medical ID, in a waterproof pouch', 'पहचान पत्र और मेडिकल आईडी की कॉपी, वॉटरप्रूफ़ पाउच में');
  addPack('Water, torch and power bank', 'पानी, टॉर्च और पावर बैंक');

  // ---- order: now, soon, prepare (stable); in alert, 112 always last ----
  const ordered = steps
    .map((s, i) => ({ s, i }))
    .sort((a, b) => URG_ORDER[a.s.urgency] - URG_ORDER[b.s.urgency] || a.i - b.i)
    .map((x) => x.s);

  if (phase === 'alert') {
    ordered.push({
      id: 'call-112',
      text: { en: 'Call 112 for emergencies.', hi: 'आपात स्थिति में 112 पर कॉल करें।' },
      urgency: 'now',
    });
  }

  const sev = severity ? { watch: ['Watch', 'निगरानी'], warning: ['Warning', 'चेतावनी'], severe: ['Severe warning', 'गंभीर चेतावनी'] }[severity] : null;
  const headline = hz
    ? phase === 'alert'
      ? `${sev ? sev[0] + ': ' : ''}${cap(hz.en)}. Here is what to do for your household`
      : phase === 'prepare'
        ? `Get your household ready for ${hz.en}`
        : `After the ${hz.en}: look after your household`
    : phase === 'alert'
      ? 'What to do now for your household'
      : phase === 'prepare'
        ? 'Get your household ready'
        : 'Recovering: look after your household';
  const headlineHi = hz
    ? phase === 'alert'
      ? `${sev ? sev[1] + ': ' : ''}${hz.hi}। आपके घर के लिए क्या करें`
      : phase === 'prepare'
        ? `${hz.hi} के लिए अपने घर को तैयार करें`
        : `${hz.hi} के बाद: अपने घर का ध्यान रखें`
    : phase === 'alert'
      ? 'अभी आपके घर को क्या करना है'
      : phase === 'prepare'
        ? 'अपने घर को तैयार करें'
        : 'सँभलना: अपने घर का ध्यान रखें';

  return {
    headline,
    headlineHi,
    steps: ordered,
    packList: pack.map((x) => x[0]),
    packListHi: pack.map((x) => x[1]),
    avoid: avoid.map((x) => x[0]),
    avoidHi: avoid.map((x) => x[1]),
  };
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
