import React from 'react';
import { Text, View } from 'react-native';
import type { DayPoint, WeatherNote } from '../../services/weatherLogic';
import { fonts } from '../../theme';
import { useTheme } from '../ui';
import { GlassCard } from './SkyBackground';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RANK = { info: 0, watch: 1, warning: 2, severe: 3 } as const;

/** 'YYYY-MM-DD' -> local Date. Parsed by hand so timezones do not shift the day. */
export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function weekdayOf(key: string): string {
  return WEEKDAYS[parseDayKey(key).getDay()];
}

const BAR_MIN = 18;
const BAR_MAX = 92;

/** "This week" card: weekLine on the right, one column per day with a temperature bar. */
export function WeekCard({
  days,
  notes,
  todayKey,
  title,
  summary,
  todayLabel,
  ink,
  muted,
}: {
  days: DayPoint[];
  notes: WeatherNote[];
  todayKey: string;
  title: string;
  summary: string;
  todayLabel: string;
  ink: string;
  muted: string;
}) {
  const { p } = useTheme();
  const flagged = new Set(notes.filter((n) => n.day && RANK[n.severity] >= RANK.watch).map((n) => n.day as string));
  // never show days that have already passed (a cached forecast can start on yesterday)
  const upcoming = days.filter((d) => d.date >= todayKey);
  const week = (upcoming.length ? upcoming : days).slice(0, 7);
  const lo = Math.min(...week.map((d) => d.minC));
  const hi = Math.max(...week.map((d) => d.maxC));
  const span = hi - lo || 1;
  const hot = p.dark ? '#FF8A6B' : '#E5582F';
  const flagText = p.dark ? '#FF6B70' : '#D73A3F';
  const todayBar = p.dark ? '#F4EEFF' : '#1B1530';

  return (
    <GlassCard>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 10 }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 16, color: ink }}>{title}</Text>
        <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: muted, flexShrink: 1, textAlign: 'right' }}>{summary}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: BAR_MAX + 54 }}>
        {week.map((d) => {
          const isToday = d.date === todayKey;
          const isFlag = flagged.has(d.date);
          const h = BAR_MIN + ((d.maxC - lo) / span) * (BAR_MAX - BAR_MIN);
          const barColor = isFlag ? hot : isToday ? todayBar : ink;
          const barOpacity = isFlag || isToday ? 1 : 0.22;
          return (
            <View key={d.date} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end' }}>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: ink, marginBottom: 6 }}>{`${Math.round(d.maxC)}°`}</Text>
              <View style={{ width: 16, height: h, borderRadius: 8, backgroundColor: barColor, opacity: barOpacity }} />
              <Text style={{ fontFamily: isFlag || isToday ? fonts.semibold : fonts.regular, fontSize: 12, color: isFlag ? flagText : muted, marginTop: 8 }}>
                {isToday ? todayLabel : weekdayOf(d.date)}
              </Text>
            </View>
          );
        })}
      </View>
    </GlassCard>
  );
}
