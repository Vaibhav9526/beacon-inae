import { router } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';
import { useLocal } from '../i18n';
import { estimateHoursLeft } from '../services/lifeboat';
import { useLifeboat } from '../state/lifeboat';
import { useTheme, Txt } from './ui';

/** Small pill shown across the top while lifeboat mode is on. Tap it to open the lifeboat screen. */
export function LifeboatBanner() {
  const { p } = useTheme();
  const local = useLocal();
  const active = useLifeboat((s) => s.active);
  const battery = useLifeboat((s) => s.battery);
  const notice = useLifeboat((s) => s.notice);
  const set = useLifeboat((s) => s.set);

  if (!active && !notice) return null;

  if (!active) {
    // automatic change happened while the pill was hidden: show the notice, let the person dismiss it
    return (
      <Pressable onPress={() => set({ notice: null })} accessibilityRole="button" accessibilityLabel={notice ?? ''} style={{ marginHorizontal: 16, marginTop: 8, borderRadius: 14, padding: 10, backgroundColor: p.card }}>
        <Txt size={12.5} weight="500">
          {notice}
        </Txt>
      </Pressable>
    );
  }

  const hours = battery === null ? null : estimateHoursLeft(battery, true);
  const label =
    hours === null
      ? local(['Lifeboat on', 'लाइफ़बोट चालू'] as const)
      : local([`Lifeboat on: about ${hours} h left`, `लाइफ़बोट चालू: लगभग ${hours} घंटे बाकी`] as const);

  return (
    <View style={{ alignItems: 'center', marginTop: 8 }}>
      <Pressable
        onPress={() => router.push('/lifeboat' as never)}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: p.accent }}
      >
        <Txt size={12.5} weight="600" color={p.onAccent}>
          {label}
        </Txt>
      </Pressable>
    </View>
  );
}
