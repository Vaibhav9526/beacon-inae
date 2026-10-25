import { router } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { useWeather } from '../services/weather';
import { conditionIcon, conditionLabel, forecastNotes, type WeatherNote } from '../services/weatherLogic';
import { Icon } from './Icon';
import { Skeleton } from './Skeleton';
import { WeatherIcon } from './weather/WeatherIcon';
import { Press, Row, Txt, useTheme } from './ui';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Thu 17:40" from a note's day (YYYY-MM-DD or a weekday word) and time (ms epoch). */
function noteWhen(n: WeatherNote): string {
  let day = n.day ?? '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) day = DAY_NAMES[new Date(`${day}T12:00:00`).getDay()];
  const time = n.at != null ? new Date(n.at).toTimeString().slice(0, 5) : '';
  return [day, time].filter(Boolean).join(' ');
}

/** One-line weather row for the adult home. Tapping it opens the full weather screen. */
export function WeatherCard() {
  const { p } = useTheme();
  const { forecast: f, loading } = useWeather();

  const shell = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, padding: 12, borderRadius: 20, backgroundColor: p.card, borderWidth: 1, borderColor: p.border };

  if (!f) {
    if (loading) {
      return (
        <View style={[shell, { borderWidth: 0, backgroundColor: p.cardAlt }]} accessibilityLabel="Loading weather">
          <Skeleton w={40} h={40} r={20} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton w="60%" h={12} />
            <Skeleton w="40%" h={10} />
          </View>
        </View>
      );
    }
    return (
      <Press onPress={() => router.push('/weather' as never)} accessibilityRole="button" accessibilityLabel="Weather" style={shell}>
        <Txt size={13} color={p.muted}>
          Weather not available yet
        </Txt>
      </Press>
    );
  }

  const note = forecastNotes(f).find((n) => n.severity !== 'info');
  const when = note ? noteWhen(note) : '';

  return (
    <Press onPress={() => router.push('/weather' as never)} accessibilityRole="button" accessibilityLabel={`Weather in ${f.place}, ${Math.round(f.now.tempC)} degrees, ${conditionLabel(f.now.code, f.now.isDay)}`} style={shell}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: p.cardAlt, alignItems: 'center', justifyContent: 'center' }}>
        <WeatherIcon name={conditionIcon(f.now.code, f.now.isDay)} size={22} color={p.text} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Row style={{ gap: 6, flexWrap: 'wrap' }}>
          <Txt size={14} weight="600" numberOfLines={1}>
            {`${f.place} ${Math.round(f.now.tempC)}°`}
          </Txt>
          <Txt size={13} color={p.muted} numberOfLines={1}>
            {conditionLabel(f.now.code, f.now.isDay)}
          </Txt>
        </Row>
        {note ? (
          <Txt size={12} color={p.muted} numberOfLines={1}>
            {when ? `${when} ` : ''}
            {note.title}
          </Txt>
        ) : null}
      </View>
      <Icon name="next" size={16} color={p.muted} />
    </Press>
  );
}
