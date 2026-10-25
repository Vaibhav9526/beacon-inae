import { router } from 'expo-router';
import { useLang, useT } from '../i18n';
import { call112, sendSafeNow } from '../services/sos';
import { usePhase, usePhaseMemory } from '../state/phase';
import { hazardIdFor } from '../state/phaseLogic';
import type { IconName } from './Icon';
import type { TintName } from './ui';

export type Phase = 'prepare' | 'alert' | 'recover';

export interface QuickAction {
  id: string;
  label: string;
  icon: IconName;
  onPress: () => void;
}

export interface PhaseBanner {
  title: string;
  tint: TintName;
  /** text button shown under the title; the whole card also uses onPress when given */
  actionLabel?: string;
  onPress?: () => void;
}

const go = (path: string) => () => router.push(path as never);

/**
 * What the adult Home shows for the current phase: one banner, a row of quick actions and the "I am safe" text action.
 * Each action points at a real route.
 */
export function usePhaseHome(): { phase: Phase; banner: PhaseBanner; quick: QuickAction[]; safe: { label: string; onPress: () => void } } {
  const t = useT();
  const lang = useLang();
  const hi = lang === 'hi';
  const ph = usePhase();
  const markSafe = usePhaseMemory((s) => s.markSafe);
  const L = (en: string, h: string) => (hi ? h : en);

  const safeNow = () => {
    markSafe();
    void sendSafeNow();
  };
  const hazard = ph.lead ? hazardIdFor(ph.lead.title) : null;
  const guide = hazard ? go(`/disaster/${hazard}`) : go('/adult/news');

  const safe = { label: t('iAmSafe'), onPress: safeNow };
  const call = { id: 'call112', label: t('call112'), icon: 'phone' as const, onPress: () => void call112() };
  const shelter = { id: 'shelter', label: t('shelter'), icon: 'tent' as const, onPress: () => router.push({ pathname: '/map', params: { place: 'shelter' } } as never) };
  const hospital = { id: 'hospital', label: t('hospital'), icon: 'hospital' as const, onPress: () => router.push({ pathname: '/map', params: { place: 'hospital' } } as never) };
  const photo = { id: 'photo', label: L('Photo check', 'फोटो जाँच'), icon: 'camera' as const, onPress: go('/photo') };

  if (ph.phase === 'alert') {
    return {
      phase: 'alert',
      banner: { title: ph.lead?.title ?? L('Emergency mode', 'आपातकालीन मोड'), tint: 'pink', actionLabel: L('What to do', 'क्या करें'), onPress: guide },
      quick: [call, shelter, hospital, photo],
      safe,
    };
  }

  if (ph.phase === 'recover') {
    return {
      phase: 'recover',
      banner: { title: L('Check on your family', 'परिवार का हाल लें'), tint: 'green', actionLabel: L('Open check-in', 'चेक-इन खोलें'), onPress: go('/recover') },
      quick: [
        { id: 'checkin', label: L('Check-in', 'चेक-इन'), icon: 'family', onPress: go('/recover') },
        { id: 'report', label: L('Report', 'रिपोर्ट'), icon: 'doc', onPress: go('/report/new') },
        hospital,
      ],
      safe,
    };
  }

  const n = ph.watching;
  return {
    phase: 'prepare',
    banner: {
      title: n > 0 ? L(`Following ${n} watch alert${n === 1 ? '' : 's'}`, `${n} चेतावनी पर नज़र`) : L('You are ready: no active alerts', 'आप तैयार हैं: कोई सक्रिय चेतावनी नहीं'),
      tint: 'blue',
    },
    quick: [shelter, hospital, photo, call],
    safe,
  };
}
