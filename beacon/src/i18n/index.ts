import { useCallback } from 'react';
import type { Lang, T } from '../kb/types';
import { useSettings } from '../state/settings';
import { STRINGS, type StringKey } from './strings';

export type { StringKey };

export function translate(key: StringKey, lang: Lang): string {
  return STRINGS[key][lang === 'hi' ? 1 : 0];
}

/** `const t = useT(); t('sos')` re-renders when the language changes. */
export function useT() {
  const lang = useSettings((s) => s.lang);
  return useCallback((key: StringKey) => translate(key, lang), [lang]);
}

/** Pick from a KB [en, hi] pair in the current language. */
export function useLocal() {
  const lang = useSettings((s) => s.lang);
  return useCallback((t: T) => (lang === 'hi' ? t[1] : t[0]), [lang]);
}

export const useLang = () => useSettings((s) => s.lang);

export function relativeTime(ts: number, lang: Lang, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - ts) / 60000));
  if (m < 1) return translate('justNow', lang);
  if (m < 60) return `${m} ${translate('minAgo', lang)}`;
  return `${Math.round(m / 60)} ${translate('hrAgo', lang)}`;
}
