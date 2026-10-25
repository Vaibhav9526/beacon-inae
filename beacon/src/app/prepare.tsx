import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { DecoByName, type DecoName } from '../components/Deco';
import { Screen } from '../components/Screen';
import { SkeletonList } from '../components/Skeleton';
import { Appear, Btn, Card, Row, SectionTitle, Txt, type TintName, useTheme } from '../components/ui';
import { useLang, useLocal } from '../i18n';
import { GO_BAG } from '../kb';
import { DISCLAIMER, type CalendarHazard, type HazardId, hazardCalendar, hazardProfile, nearestCity } from '../kb/hazards';
import { DRILLS } from '../kb/kidDrills';
import type { T } from '../kb/types';
import { useHub } from '../services/hub';
import { getFix, lastKnownFix, type Fix } from '../services/location';
import { type ReadinessId, readinessScore } from '../services/readiness';
import { useSettings } from '../state/settings';

const EASE = Easing.out(Easing.cubic);
const RING = 138;
const STROKE = 12;
const RADIUS = (RING - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const PAIR_PREPARE: T = ['Prepare', 'तैयारी'];
const PAIR_READY: T = ['Your readiness', 'आपकी तैयारी'];
const PAIR_NEXT: T = ['Next best steps', 'अगले सबसे ज़रूरी कदम'];
const PAIR_WHERE: T = ['Where you live', 'आप कहाँ रहते हैं'];
const PAIR_MONTH: T = ['This month', 'इस महीने'];
const PAIR_NEAR: T = ['Near', 'पास में'];
const PAIR_NO_LOCATION: T = [
  'Set a location on the map to see your local hazards.',
  'अपने इलाक़े के ख़तरे देखने के लिए नक्शे पर लोकेशन चुनें।',
];
const PAIR_CALM: T = ['Nothing in season this month.', 'इस महीने कोई मौसमी ख़तरा नहीं।'];
const PAIR_SEASON_HINT: T = [
  'Keep an eye on local warnings and practise the matching drill.',
  'स्थानीय चेतावनियों पर नज़र रखें और उससे जुड़ा अभ्यास करें।',
];

const SCORE_COPY: { min: number; text: T }[] = [
  {
    min: 80,
    text: ['You are well prepared. Keep the basics fresh.', 'आप अच्छी तरह तैयार हैं। बुनियादी चीज़ें ताज़ा रखें।'],
  },
  {
    min: 50,
    text: ['A good start. Close the biggest gaps below.', 'अच्छी शुरुआत। नीचे सबसे बड़ी कमियाँ पूरी करें।'],
  },
  {
    min: 0,
    text: ['Start with one small step. It adds up.', 'एक छोटे कदम से शुरू करें। यह जुड़ता जाता है।'],
  },
];

const ACTION: Record<
  ReadinessId,
  { href: string; tint: TintName; deco: DecoName; label: T; why: T; cta: T }
> = {
  medical: {
    href: '/medical',
    tint: 'pink',
    deco: 'cross',
    label: ['Medical ID', 'मेडिकल आईडी'],
    why: ['Your blood group and medicines, ready for rescuers.', 'आपका रक्त समूह और दवाइयाँ, बचावकर्मियों के लिए तैयार।'],
    cta: ['Fill medical ID', 'मेडिकल आईडी भरें'],
  },
  contacts: {
    href: '/medical',
    tint: 'yellow',
    deco: 'bell',
    label: ['Emergency contacts', 'आपातकालीन संपर्क'],
    why: ['Two people who should be called first.', 'दो लोग जिन्हें सबसे पहले बुलाया जाए।'],
    cta: ['Add contacts', 'संपर्क जोड़ें'],
  },
  gobag: {
    href: '/gobag',
    tint: 'green',
    deco: 'shield',
    label: ['Go-bag', 'गो-बैग'],
    why: ['Water, medicines, a torch and papers in one bag.', 'पानी, दवाइयाँ, टॉर्च और काग़ज़ात एक थैले में।'],
    cta: ['Open go-bag', 'गो-बैग खोलें'],
  },
  drills: {
    href: '/drills',
    tint: 'yellow',
    deco: 'bolt',
    label: ['Drills', 'अभ्यास'],
    why: ['Practise Drop, Cover, Hold On and time it.', 'झुको, ढको, पकड़ो का अभ्यास करें और समय नापें।'],
    cta: ['Start a drill', 'अभ्यास शुरू करें'],
  },
  family: {
    href: '/family',
    tint: 'blue',
    deco: 'flower',
    label: ['Family link', 'परिवार लिंक'],
    why: ['Pair a family member so you can find each other.', 'परिवार के सदस्य को जोड़ें ताकि एक-दूसरे को ढूँढ सकें।'],
    cta: ['Open family', 'परिवार खोलें'],
  },
  shelter: {
    href: '/adult/map',
    tint: 'lilac',
    deco: 'ribbon',
    label: ['Nearest shelter', 'नज़दीकी आश्रय'],
    why: ['Save a safe place and a route to reach it.', 'सुरक्षित जगह और वहाँ पहुँचने का रास्ता सहेजें।'],
    cta: ['Find on map', 'नक्शे पर खोजें'],
  },
  water: {
    href: '/gobag',
    tint: 'blue',
    deco: 'drop',
    label: ['Home water', 'घर का पानी'],
    why: ['Keep three days of drinking water at home.', 'घर पर तीन दिन का पीने का पानी रखें।'],
    cta: ['Check go-bag', 'गो-बैग देखें'],
  },
  hub: {
    href: '/hub',
    tint: 'peach',
    deco: 'bell',
    label: ['Desktop hub', 'डेस्कटॉप हब'],
    why: ['Pair the hub to keep watch while you sleep.', 'सोते समय निगरानी के लिए हब जोड़ें।'],
    cta: ['Pair hub', 'हब जोड़ें'],
  },
};

const DEFAULT_NEXT: ReadinessId[] = ['shelter', 'gobag', 'drills'];

const HAZARD_LABEL: Record<CalendarHazard, T> = {
  seismic: ['Earthquake', 'भूकंप'],
  flood: ['Flood', 'बाढ़'],
  cyclone: ['Cyclone', 'चक्रवात'],
  heatwave: ['Heatwave', 'लू'],
  landslide: ['Landslide', 'भूस्खलन'],
  drought: ['Drought', 'सूखा'],
  lightning: ['Lightning', 'बिजली'],
  coldwave: ['Cold wave', 'शीतलहर'],
};

const HAZARD_WHY: Record<HazardId, T> = {
  seismic: [
    'Strong shaking can damage buildings. Fix tall furniture and practise Drop, Cover, Hold On.',
    'तेज़ झटके इमारतों को नुक़सान पहुँचा सकते हैं। ऊँचा फ़र्नीचर कसें और झुको, ढको, पकड़ो का अभ्यास करें।',
  ],
  flood: [
    'Low-lying streets and rivers can flood. Know a high route and keep papers dry.',
    'नीची सड़कें और नदियाँ बाढ़ में डूब सकती हैं। ऊँचा रास्ता जानें और काग़ज़ात सूखे रखें।',
  ],
  cyclone: [
    'Coastal winds and storm surge can arrive fast. Know your nearest cyclone shelter.',
    'तटीय हवाएँ और समुद्री लहरें तेज़ी से आ सकती हैं। नज़दीकी चक्रवात आश्रय जानें।',
  ],
  heatwave: [
    'Long hot spells can cause heat stroke. Keep water ready and avoid the afternoon sun.',
    'लंबी गर्मी लू लगा सकती है। पानी तैयार रखें और दोपहर की धूप से बचें।',
  ],
  landslide: [
    'Heavy rain can weaken slopes. Move away if you see cracks or tilting trees.',
    'भारी बारिश ढलानों को कमज़ोर कर सकती है। दरारें या झुकते पेड़ दिखें तो दूर हटें।',
  ],
  drought: [
    'Long dry spells can cut the water supply. Store safe water and use it sparingly.',
    'लंबा सूखा पानी की आपूर्ति काट सकता है। सुरक्षित पानी सहेजें और कम इस्तेमाल करें।',
  ],
  lightning: [
    'Thunderstorms bring deadly strikes. Go indoors when you hear thunder.',
    'तूफ़ान में बिजली गिर सकती है। गड़गड़ाहट सुनते ही अंदर जाएँ।',
  ],
};

const MONTHS: T[] = [
  ['January', 'जनवरी'],
  ['February', 'फ़रवरी'],
  ['March', 'मार्च'],
  ['April', 'अप्रैल'],
  ['May', 'मई'],
  ['June', 'जून'],
  ['July', 'जुलाई'],
  ['August', 'अगस्त'],
  ['September', 'सितंबर'],
  ['October', 'अक्टूबर'],
  ['November', 'नवंबर'],
  ['December', 'दिसंबर'],
];

function ReadinessRing({ value }: { value: number }) {
  const { p } = useTheme();
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const ink = p.tint.lilac.ink;

  useEffect(() => {
    progress.value = reduced
      ? value
      : withTiming(value, { duration: 200, easing: EASE });
  }, [progress, reduced, value]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRCUMFERENCE * (1 - progress.value / 100),
  }));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Readiness"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value) }}
      style={{ width: RING, height: RING, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={RING} height={RING} style={{ position: 'absolute' }}>
        <Circle cx={RING / 2} cy={RING / 2} r={RADIUS} stroke={ink + '22'} strokeWidth={STROKE} fill="none" />
        <AnimatedCircle
          cx={RING / 2}
          cy={RING / 2}
          r={RADIUS}
          stroke={ink}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          fill="none"
          animatedProps={animatedProps}
          transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
        />
      </Svg>
      <Txt size={44} weight="700" color={ink}>
        {Math.round(value)}
      </Txt>
      <Txt size={10.5} weight="600" color={ink} style={{ opacity: 0.55, marginTop: -4 }}>
        / 100
      </Txt>
    </View>
  );
}

export default function Prepare() {
  const { p } = useTheme();
  const L = useLocal();
  const lang = useLang();
  const hi = lang === 'hi';

  const medical = useSettings((s) => s.medical);
  const contacts = useSettings((s) => s.contacts);
  const children = useSettings((s) => s.children);
  const checklist = useSettings((s) => s.checklist);
  const stars = useSettings((s) => s.stars);
  const paired = useHub((s) => s.paired);
  const [fix, setFix] = useState<Fix | null>(null);
  const [locating, setLocating] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const saved = await lastKnownFix();
        const current = saved ?? (await getFix({ maxWaitMs: 4000 }));
        if (alive) setFix(current);
      } finally {
        if (alive) setLocating(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const profile = useMemo(() => (fix ? hazardProfile({ lat: fix.lat, lon: fix.lon }) : []), [fix]);
  const near = useMemo(() => (fix ? nearestCity(fix.lat, fix.lon) : null), [fix]);
  const month = new Date().getMonth();
  const season = hazardCalendar(month);

  const readiness = useMemo(
    () =>
      readinessScore({
        medicalIdFilled: !!(medical.fullName.trim() && medical.bloodGroup.trim()),
        emergencyContactsCount: contacts.length,
        goBagChecked: GO_BAG.filter((i) => checklist[i.id]).length,
        goBagTotal: GO_BAG.length,
        drillsDone: DRILLS.filter((d) => (stars[d.id] ?? 0) > 0).length,
        drillsTotal: DRILLS.length,
        familyMembersLinked: children.length,
        shelterKnown: false,
        hubPaired: !!paired,
        hazardLevelMax: profile[0]?.level ?? 0,
      }),
    [checklist, children.length, contacts.length, medical, paired, profile, stars],
  );

  const cards: ReadinessId[] = [];
  for (const step of readiness.next) if (!cards.includes(step.id)) cards.push(step.id);
  for (const id of DEFAULT_NEXT) if (cards.length < 3 && !cards.includes(id)) cards.push(id);
  const scoreCopy = SCORE_COPY.find((c) => readiness.score >= c.min) ?? SCORE_COPY[SCORE_COPY.length - 1];

  return (
    <Screen title={L(PAIR_PREPARE)}>
      <Appear>
        <Card tint="lilac" style={{ overflow: 'hidden', minHeight: 196, padding: 18 }}>
          <View
            pointerEvents="none"
            style={{ position: 'absolute', right: -12, top: -16, transform: [{ rotate: '12deg' }] }}>
            <DecoByName.shield size={96} />
          </View>
          <Row style={{ gap: 16, alignItems: 'center' }}>
            <ReadinessRing value={readiness.score} />
            <View style={{ flex: 1, gap: 6, paddingRight: 44 }}>
              <Txt size={20} weight="700">{L(PAIR_READY)}</Txt>
              <Txt size={12.5} style={{ opacity: 0.72 }}>
                {L(scoreCopy.text)}
              </Txt>
            </View>
          </Row>
        </Card>
      </Appear>

      <SectionTitle>{L(PAIR_NEXT)}</SectionTitle>
      {cards.map((id, i) => {
        const action = ACTION[id];
        const Deco = DecoByName[action.deco];
        return (
          <Appear key={id} index={i + 1}>
            <Card tint={action.tint} style={{ overflow: 'hidden', minHeight: 126, padding: 16, paddingRight: 96 }}>
              <View
                pointerEvents="none"
                style={{ position: 'absolute', right: -10, bottom: -12, transform: [{ rotate: i % 2 ? '9deg' : '-8deg' }] }}>
                <Deco size={78} />
              </View>
              <Txt size={18} weight="700" style={{ paddingRight: 24 }}>
                {L(action.label)}
              </Txt>
              <Txt size={12} style={{ opacity: 0.75, marginTop: 2, paddingRight: 16 }} numberOfLines={2}>
                {L(action.why)}
              </Txt>
              <View style={{ alignSelf: 'flex-start', marginTop: 8 }}>
                <Btn size="sm" label={L(action.cta)} onPress={() => router.push(action.href as never)} />
              </View>
            </Card>
          </Appear>
        );
      })}

      <Appear index={4}>
        <View style={{ gap: 8 }}>
          <SectionTitle>{L(PAIR_WHERE)}</SectionTitle>
          {locating ? (
            <SkeletonList n={1} />
          ) : (
            <Card tint="blue" style={{ gap: 12 }}>
              {fix && near ? (
                <Txt size={11.5} weight="600" color={p.tint.blue.ink} style={{ opacity: 0.62 }}>
                  {L(PAIR_NEAR)} {near.city}
                </Txt>
              ) : null}

              {profile.slice(0, 3).map((h) => (
                <View key={h.id} style={{ gap: 5 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Txt size={15} weight="700" color={p.tint.blue.ink}>
                      {L(HAZARD_LABEL[h.id])}
                    </Txt>
                    <View style={{ flexDirection: 'row', gap: 4 }}>
                      {[1, 2, 3].map((pip) => (
                        <View
                          key={pip}
                          style={{
                            width: 15,
                            height: 5,
                            borderRadius: 3,
                            backgroundColor: pip <= h.level ? p.tint.blue.ink : p.tint.blue.ink + '22',
                          }}
                        />
                      ))}
                    </View>
                  </Row>
                  <Txt size={11.5} color={p.tint.blue.ink} style={{ opacity: 0.72 }}>
                    {hi ? L(HAZARD_WHY[h.id]) : h.why}
                  </Txt>
                </View>
              ))}

              {profile.length === 0 ? (
                <Txt size={13} weight="600" color={p.tint.blue.ink} style={{ opacity: 0.75 }}>
                  {L(PAIR_NO_LOCATION)}
                </Txt>
              ) : null}

              <Txt size={10.5} color={p.tint.blue.ink} style={{ opacity: 0.5 }}>
                {DISCLAIMER}
              </Txt>
            </Card>
          )}
        </View>
      </Appear>

      <Appear index={5}>
        <View style={{ gap: 8 }}>
          <SectionTitle right={<Txt size={12} weight="600" color={p.muted}>{L(MONTHS[month])}</Txt>}>
            {L(PAIR_MONTH)}
          </SectionTitle>
          <Card tint="peach" style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
              {season.map((id) => (
                <View
                  key={id}
                  style={{ backgroundColor: 'rgba(255,255,255,0.55)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                  <Txt size={12} weight="600" color={p.tint.peach.ink}>
                    {L(HAZARD_LABEL[id])}
                  </Txt>
                </View>
              ))}
            </View>
            <Txt size={11.5} color={p.tint.peach.ink} style={{ opacity: 0.7 }}>
              {season.length ? L(PAIR_SEASON_HINT) : L(PAIR_CALM)}
            </Txt>
          </Card>
        </View>
      </Appear>
    </Screen>
  );
}
