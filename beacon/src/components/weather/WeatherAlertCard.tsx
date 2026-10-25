import React from 'react';
import { Text, View } from 'react-native';
import type { WeatherNote } from '../../services/weatherLogic';
import { fonts } from '../../theme';
import { useTheme } from '../ui';
import { GlassCard } from './SkyBackground';
import { type WeatherIconName, WeatherIcon } from './WeatherIcon';
import { weekdayOf } from './WeekCard';

const NOTE_ICON: Record<WeatherNote['icon'], WeatherIconName> = {
  rain: 'rain',
  storm: 'storm',
  heat: 'sun',
  cold: 'snow',
  wind: 'cloud',
  uv: 'sun',
  sun: 'sun',
};

const pad = (n: number) => String(n).padStart(2, '0');

/** "Thursday, 17:40" when both are known, just the day or time when only one is. */
export function noteHeader(note: WeatherNote): string {
  const day = note.day ? weekdayOf(note.day) : null;
  const time = note.at != null ? (() => {
    const d = new Date(note.at);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })() : null;
  if (day && time) return `${day}, ${time}`;
  return day ?? time ?? 'Next 7 days';
}

/** The most severe note as a red-tinted glass card, or a calm green card when there is nothing to worry about. */
export function WeatherAlertCard({ note, calmTitle, calmBody, ink, muted }: { note: WeatherNote | null; calmTitle: string; calmBody: string; ink: string; muted: string }) {
  const { p } = useTheme();
  if (!note) {
    return (
      <GlassCard tint="ok">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.ok }} />
          <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: p.ok }}>{calmTitle}</Text>
        </View>
        <Text style={{ fontFamily: fonts.regular, fontSize: 14, color: muted }}>{calmBody}</Text>
      </GlassCard>
    );
  }
  const dotColor = note.severity === 'severe' || note.severity === 'warning' ? p.danger : p.warn;
  return (
    <GlassCard tint="alert">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} />
            <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: dotColor }}>{noteHeader(note)}</Text>
          </View>
          <Text style={{ fontFamily: fonts.bold, fontSize: 18, color: ink, marginBottom: 6 }}>{note.title}</Text>
          <Text style={{ fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: muted }}>{note.body}</Text>
        </View>
        <WeatherIcon name={NOTE_ICON[note.icon]} color={ink} size={32} />
      </View>
    </GlassCard>
  );
}
