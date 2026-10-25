import { router } from 'expo-router';
import React from 'react';
import { useLang, useT } from '../i18n';
import { useMesh } from '../services/mesh';
import { call112, sendSafeNow } from '../services/sos';
import { type Phase, usePhase, usePhaseMemory } from '../state/phase';
import { hazardIdFor } from '../state/phaseLogic';
import { Bell, Bolt, Cross, Flower, Ribbon, Shield, Sun, Wave } from './Deco';
import { AvatarStack, type HeroCard, type PlanGrid } from './HeroCard';
import { cast } from './PixelAvatar';

type PlanItems = React.ComponentProps<typeof PlanGrid>['items'];
type HeroProps = React.ComponentProps<typeof HeroCard>;

const go = (path: string) => () => router.push(path as never);

/**
 * What the adult Home shows for the current phase: the hero card, the plan tiles and whether SOS goes above the hero.
 * Each tile points at a real route; the hazard-specific tile opens the guide that matches the alert that caused the phase.
 */
export function usePhaseHome(): { phase: Phase; hero: HeroProps; plan: PlanItems; sosFirst: boolean; showWeek: boolean } {
  const t = useT();
  const lang = useLang();
  const hi = lang === 'hi';
  const ph = usePhase();
  const neighbours = useMesh((s) => s.neighbours);
  const markSafe = usePhaseMemory((s) => s.markSafe);
  const L = (en: string, h: string) => (hi ? h : en);

  const safe = () => {
    markSafe();
    void sendSafeNow();
  };
  const hazard = ph.lead ? hazardIdFor(ph.lead.title) : null;
  const guide = hazard ? go(`/disaster/${hazard}`) : go('/adult/news');

  const shelter = { id: 'shelter', label: L('Nearby', 'पास में'), title: `${t('nearest')} ${t('shelter')}`, meta: L('Open the map, nearest first', 'नक्शा खोलें'), tint: 'peach' as const, deco: <Shield size={68} />, onPress: () => router.push({ pathname: '/map', params: { place: 'shelter' } } as never) };
  const hospital = { id: 'hospital', label: L('Nearby', 'पास में'), title: `${t('nearest')} ${t('hospital')}`, meta: L('Open the map, nearest first', 'नक्शा खोलें'), tint: 'green' as const, deco: <Cross size={68} />, onPress: () => router.push({ pathname: '/map', params: { place: 'hospital' } } as never) };
  const iAmSafe = { id: 'safe', label: L('Quick', 'तुरंत'), title: t('iAmSafe'), meta: L('Tells your family you are fine', 'परिवार को बताएँ कि आप ठीक हैं'), tint: 'blue' as const, deco: <Flower size={68} />, onPress: safe };
  const call = { id: 'call112', label: L('Quick', 'तुरंत'), title: t('call112'), meta: L('Emergency services', 'आपातकालीन सेवा'), tint: 'pink' as const, deco: <Bell size={68} />, onPress: () => void call112() };
  const report = { id: 'report', label: L('Quick', 'तुरंत'), title: t('postReport'), meta: L('Photo or note for the hub', 'हब के लिए फोटो या नोट'), tint: 'lilac' as const, deco: <Wave size={68} />, onPress: go('/report/new') };
  const hub = { id: 'hub', label: L('Quick', 'तुरंत'), title: L('Desktop hub', 'डेस्कटॉप हब'), meta: L('Connect to your desktop', 'अपने कंप्यूटर से जोड़ें'), tint: 'yellow' as const, deco: <Bolt size={68} />, onPress: go('/hub') };

  const people = [cast('asha'), cast('veer'), cast('medic')];

  if (ph.phase === 'alert') {
    const title = ph.lead?.title ?? L('Emergency mode', 'आपातकालीन मोड');
    return {
      phase: 'alert',
      sosFirst: true,
      showWeek: false,
      hero: {
        title: L('Stay safe now', 'अभी सुरक्षित रहें'),
        subtitle: `${title}. ${L('Tap for what to do and not do.', 'क्या करें और क्या नहीं, देखें।')}`,
        tint: 'pink',
        deco: <Bell size={120} />,
        onPress: guide,
        children: <AvatarStack specs={people} more={neighbours} tint="pink" />,
      },
      plan: [
        iAmSafe,
        call,
        { id: 'dodont', label: L('Now', 'अभी'), title: hazard ? L('Do and don\'t', 'क्या करें, क्या नहीं') : L('Latest alerts', 'ताज़ा चेतावनियाँ'), meta: ph.lead?.title ?? L('Read the guide', 'गाइड पढ़ें'), tint: 'yellow' as const, deco: <Sun size={68} />, onPress: guide },
        shelter,
        { id: 'tools', label: L('Signal', 'संकेत'), title: L('Torch and siren', 'टॉर्च और सायरन'), meta: L('Be seen and heard', 'दिखें और सुनाई दें'), tint: 'lilac' as const, deco: <Ribbon size={68} />, onPress: go('/tools') },
        hospital,
      ],
    };
  }

  if (ph.phase === 'recover') {
    return {
      phase: 'recover',
      sosFirst: false,
      showWeek: false,
      hero: {
        title: L('You are not alone', 'आप अकेले नहीं हैं'),
        subtitle: L('Check on family, report damage and look after yourself.', 'परिवार का हाल लें, नुकसान बताएँ और अपना ध्यान रखें।'),
        tint: 'green',
        deco: <Flower size={120} />,
        onPress: go('/recover'),
        children: <AvatarStack specs={people} more={neighbours} tint="green" />,
      },
      plan: [
        { id: 'checkin', label: L('Family', 'परिवार'), title: L('Check-in board', 'चेक-इन बोर्ड'), meta: L('Who is safe, who is missing', 'कौन सुरक्षित, कौन लापता'), tint: 'blue' as const, deco: <Flower size={68} />, onPress: go('/recover') },
        report,
        { id: 'damage', label: L('Rebuild', 'सुधार'), title: L('Recovery checklist', 'सुधार की सूची'), meta: L('Water, documents, health', 'पानी, कागज़ात, सेहत'), tint: 'yellow' as const, deco: <Sun size={68} />, onPress: go('/recover') },
        iAmSafe,
        hospital,
        { id: 'help', label: L('Community', 'समुदाय'), title: L('Needs and offers', 'ज़रूरत और मदद'), meta: L('Help a neighbour', 'पड़ोसी की मदद करें'), tint: 'peach' as const, deco: <Shield size={68} />, onPress: go('/adult/community') },
      ],
    };
  }

  return {
    phase: 'prepare',
    sosFirst: false,
    showWeek: true,
    hero: {
      title: L('Stay Ready', 'तैयार रहें'),
      subtitle: ph.watching > 0 ? ph.reasons[0] : L('See your readiness score and what to do next', 'अपनी तैयारी देखें और अगला कदम जानें'),
      tint: 'lilac',
      deco: <Shield size={120} />,
      onPress: go('/prepare'),
      children: <AvatarStack specs={people} more={neighbours} tint="lilac" />,
    },
    plan: [
      { id: 'ready', label: L('Score', 'स्कोर'), title: L('Readiness', 'तैयारी'), meta: L('What to do next', 'अगला कदम'), tint: 'lilac' as const, deco: <Shield size={68} />, onPress: go('/prepare') },
      { id: 'gobag', label: L('Pack', 'पैक'), title: L('Go-bag', 'गो-बैग'), meta: L('Check what you carry', 'जाँचें क्या रखा है'), tint: 'green' as const, deco: <Cross size={68} />, onPress: go('/gobag') },
      { id: 'drills', label: L('Practise', 'अभ्यास'), title: L('Drills', 'ड्रिल'), meta: L('Be faster when it counts', 'ज़रूरत पर तेज़ रहें'), tint: 'yellow' as const, deco: <Bell size={68} />, onPress: go('/drills') },
      shelter,
      { id: 'medical', label: L('Card', 'कार्ड'), title: L('Medical ID', 'मेडिकल आईडी'), meta: L('For responders', 'बचावकर्ताओं के लिए'), tint: 'pink' as const, deco: <Cross size={68} />, onPress: go('/medical') },
      hub,
    ],
  };
}
