import React from 'react';
import { Text, View } from 'react-native';
import type { HourPoint } from '../../services/weatherLogic';
import { fonts } from '../../theme';
import { GlassCard } from './SkyBackground';
import { WeatherIcon } from './WeatherIcon';
import { conditionIcon } from '../../services/weatherLogic';

const pad = (n: number) => String(n).padStart(2, '0');

/** Picks six points: now, then every 3 hours, each the nearest hour to its target time. */
export function pickSixHours(hours: HourPoint[]): HourPoint[] {
  if (hours.length === 0) return [];
  const start = hours[0].t;
  return Array.from({ length: 6 }, (_, k) => {
    const target = start + k * 3 * 3600_000;
    let best = hours[0];
    for (const h of hours) if (Math.abs(h.t - target) < Math.abs(best.t - target)) best = h;
    return best;
  });
}

/** "Today" card: todayLine on the right, six hourly columns below. */
export function HourlyCard({ hours, title, nowLabel, summary, ink, muted }: { hours: HourPoint[]; title: string; nowLabel: string; summary: string; ink: string; muted: string }) {
  const picks = pickSixHours(hours);
  return (
    <GlassCard>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 10 }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 16, color: ink }}>{title}</Text>
        <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: muted, flexShrink: 1, textAlign: 'right' }}>{summary}</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {picks.map((h, i) => {
          const d = new Date(h.t);
          const label = i === 0 ? nowLabel : pad(d.getHours());
          return (
            <View key={h.t + ':' + i} style={{ alignItems: 'center', gap: 8, flex: 1 }}>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: ink }}>{`${Math.round(h.tempC)}°`}</Text>
              <WeatherIcon name={conditionIcon(h.code, h.isDay)} color={ink} size={24} />
              <Text style={{ fontFamily: fonts.regular, fontSize: 12, color: muted }}>{label}</Text>
            </View>
          );
        })}
      </View>
    </GlassCard>
  );
}
