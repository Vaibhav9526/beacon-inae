import { router } from 'expo-router';
import { useSettings } from '../state/settings';
import { call112, sendSafeNow, sendSosNow } from '../services/sos';
import type { Action } from './tools';

/** Carry out what the router decided. Destructive or outward-facing actions (SOS) are only run from an explicit tap. */
export async function runAction(a: Action): Promise<string | null> {
  const s = useSettings.getState();
  const mode = s.mode ?? 'adult';
  switch (a.type) {
    case 'guide':
      router.push(`/guide/${a.id}` as never);
      return null;
    case 'disaster':
      router.push(`/disaster/${a.id}` as never);
      return null;
    case 'map':
      router.push({ pathname: '/map', params: { place: a.place } } as never);
      return null;
    case 'sos':
      await sendSosNow(a.reason ?? '');
      return 'sos';
    case 'safe':
      await sendSafeNow();
      return 'safe';
    case 'call112':
      await call112();
      return null;
    case 'alerts':
      router.navigate((mode === 'parent' ? '/parent/alerts' : '/news') as never);
      return null;
    case 'chat':
      router.navigate('/adult/community' as never);
      return null;
    case 'settings':
      if (a.setting === 'hindi') s.set({ lang: 'hi' });
      else if (a.setting === 'english') s.set({ lang: 'en' });
      else if (a.setting === 'large_text') s.set({ largeText: true });
      else if (a.setting === 'high_contrast') s.set({ highContrast: true });
      else if (a.setting === 'read_aloud') s.set({ readAloud: true });
      return a.setting;
    default:
      return null;
  }
}

/** Voice commands may change settings or navigate, but never send an SOS by themselves: that needs the on-screen button. */
export function allowedByVoice(a: Action): boolean {
  return a.type !== 'sos';
}
