import { router } from 'expo-router';
import { ArrowLeft, Bell, RefreshCw } from 'lucide-react-native';
import React, { useMemo, useRef } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Skeleton } from '../components/Skeleton';
import { Appear, useTheme } from '../components/ui';
import { HourlyCard } from '../components/weather/HourlyCard';
import { SkyBackground, GlassCard } from '../components/weather/SkyBackground';
import { SunArc } from '../components/weather/SunArc';
import { WeatherAlertCard, noteHeader } from '../components/weather/WeatherAlertCard';
import { WeatherIcon } from '../components/weather/WeatherIcon';
import { WeekCard } from '../components/weather/WeekCard';
import { relativeTime, useLang, useLocal } from '../i18n';
import type { T } from '../kb/types';
import { useWeather } from '../services/weather';
import { conditionIcon, conditionLabel, forecastNotes, summaryLine, sunArc, todayLine, weekLine, type WeatherNote } from '../services/weatherLogic';
import { fonts } from '../theme';

const PAIR_TODAY: T = ['Today', 'आज'];
const PAIR_WEEK: T = ['This week', 'इस हफ़्ते'];
const PAIR_NOW: T = ['Now', 'अभी'];
const PAIR_SUNRISE: T = ['Sunrise', 'सूर्योदय'];
const PAIR_SUNSET: T = ['Sunset', 'सूर्यास्त'];
const PAIR_UPDATED: T = ['Updated', 'अपडेट'];
const PAIR_OFFLINE: T = ['offline copy', 'ऑफ़लाइन प्रति'];
const PAIR_CALM: T = ['Nothing to worry about in the next 7 days', 'अगले 7 दिनों में चिंता की कोई बात नहीं'];
const PAIR_CALM_BODY: T = ['Weather looks steady. We will warn you if that changes.', 'मौसम स्थिर लग रहा है। बदलने पर हम आपको बताएँगे।'];
const PAIR_ALL: T = ['All alerts', 'सभी चेतावनियाँ'];
const PAIR_ALERTS: T = ['Alerts', 'चेतावनियाँ'];
const PAIR_REFRESH: T = ['Refresh', 'ताज़ा करें'];
const PAIR_BACK: T = ['Back', 'वापस'];

const SEVERITY_RANK = { info: 0, watch: 1, warning: 2, severe: 3 } as const;

const pad = (n: number) => String(n).padStart(2, '0');
const todayKeyOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Plain-language UV band, from the thresholds in the design brief. */
function uvWord(uv: number): string {
  if (uv < 3) return 'Low';
  if (uv < 6) return 'Mild';
  if (uv < 8) return 'Strong';
  if (uv < 11) return 'Very strong';
  return 'Extreme';
}

function RoundButton({ onPress, label, children, ink }: { onPress?: () => void; label: string; children: React.ReactNode; ink: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.45)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.7)',
        opacity: pressed ? 0.7 : 1,
      })}>
      {children}
    </Pressable>
  );
}

function SkeletonLayout() {
  return (
    <View style={{ paddingTop: 24, gap: 16, alignItems: 'center' }}>
      <Skeleton w={140} h={18} r={9} />
      <Skeleton w={220} h={112} r={24} />
      <Skeleton w={160} h={22} r={11} />
      <Skeleton w="82%" h={14} r={7} />
      <Skeleton w="100%" h={120} r={24} style={{ marginTop: 12 }} />
      <Skeleton w="100%" h={170} r={24} />
      <Skeleton w="100%" h={120} r={24} />
    </View>
  );
}

export default function WeatherScreen() {
  const { p } = useTheme();
  const L = useLocal();
  const lang = useLang();
  const insets = useSafeAreaInsets();
  const { forecast: f, stale, loading, refresh } = useWeather();
  const alertsY = useRef(0);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);

  const ink = p.text;
  const muted = p.muted;

  const notes: WeatherNote[] = useMemo(() => (f ? forecastNotes(f) : []), [f]);
  const sorted = useMemo(() => [...notes].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]), [notes]);
  const top = sorted[0] ?? null;
  const hasAlert = sorted.some((n) => SEVERITY_RANK[n.severity] >= SEVERITY_RANK.watch);

  if (!f) {
    return (
      <View style={{ flex: 1 }}>
        <SkyBackground isDay />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: insets.top + 8 }}>
            <RoundButton label={L(PAIR_BACK)} onPress={() => router.back()} ink={ink}>
              <ArrowLeft size={20} color={ink} />
            </RoundButton>
            <RoundButton label={L(PAIR_REFRESH)} onPress={() => void refresh()} ink={ink}>
              <RefreshCw size={18} color={ink} />
            </RoundButton>
          </View>
          <SkeletonLayout />
        </ScrollView>
      </View>
    );
  }

  const now = f.now;
  const todayKey = todayKeyOf(Date.now());
  const today = f.days.find((d) => d.date === todayKey) ?? f.days[0];
  const arc = today ? sunArc(Date.now(), today.sunrise, today.sunset) : { progress: 0, isDaylight: now.isDay, minutesToSunset: null };
  const uv = Math.round(now.uv);
  const minsAgo = relativeTime(f.fetchedAt, lang);

  return (
    <View style={{ flex: 1 }}>
      <SkyBackground isDay={now.isDay} />
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40, gap: 14 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} tintColor={ink} />}>
        {/* top row */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: insets.top + 8 }}>
          <RoundButton label={L(PAIR_BACK)} onPress={() => router.back()} ink={ink}>
            <ArrowLeft size={20} color={ink} />
          </RoundButton>
          <RoundButton
            label={L(PAIR_ALERTS)}
            onPress={() => scroll.current?.scrollTo({ y: alertsY.current - 12, animated: true })}
            ink={ink}>
            <View>
              <Bell size={20} color={ink} />
              {hasAlert ? <View style={{ position: 'absolute', top: -2, right: -1, width: 9, height: 9, borderRadius: 5, backgroundColor: p.danger, borderWidth: 1.5, borderColor: '#FFFFFF' }} /> : null}
            </View>
          </RoundButton>
        </View>

        {/* city and temperature */}
        <Appear index={0} style={{ alignItems: 'center' }}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 17, color: ink, marginTop: 4 }}>{f.place}</Text>
          <Text style={{ fontFamily: fonts.medium, fontSize: 112, lineHeight: 112, letterSpacing: -4, color: ink, marginTop: 4 }}>{`${Math.round(now.tempC)}°`}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
            <WeatherIcon name={conditionIcon(now.code, now.isDay)} color={ink} size={24} />
            <Text style={{ fontFamily: fonts.bold, fontSize: 22, color: ink }}>{conditionLabel(now.code, now.isDay)}</Text>
          </View>
          <Text style={{ fontFamily: fonts.regular, fontSize: 14, color: muted, marginTop: 6, textAlign: 'center' }}>{summaryLine(f)}</Text>
        </Appear>

        {/* sun arc */}
        <Appear index={1}>
          <SunArc
            progress={arc.progress}
            isDaylight={arc.isDaylight}
            isDay={now.isDay}
            sunriseText={today ? hhmm(today.sunrise) : '--:--'}
            sunsetText={today ? hhmm(today.sunset) : '--:--'}
            sunriseLabel={L(PAIR_SUNRISE)}
            sunsetLabel={L(PAIR_SUNSET)}
            centerText={`${uvWord(now.uv)} sun, UV ${uv}`}
            ink={ink}
            muted={muted}
          />
        </Appear>

        {/* today */}
        <Appear index={2}>
          <HourlyCard hours={f.hours} title={L(PAIR_TODAY)} nowLabel={L(PAIR_NOW)} summary={todayLine(f.hours)} ink={ink} muted={muted} />
        </Appear>

        {/* this week */}
        <Appear index={3}>
          <WeekCard
            days={f.days}
            notes={notes}
            todayKey={todayKey}
            title={L(PAIR_WEEK)}
            summary={weekLine(notes)}
            todayLabel={L(PAIR_TODAY)}
            ink={ink}
            muted={muted}
          />
        </Appear>

        {/* most severe alert, or the calm card */}
        <Appear index={4}>
          <View onLayout={(e) => (alertsY.current = e.nativeEvent.layout.y)}>
            <WeatherAlertCard note={top} calmTitle={L(PAIR_CALM)} calmBody={L(PAIR_CALM_BODY)} ink={ink} muted={muted} />
          </View>
        </Appear>

        {/* all alerts, when there is more than one */}
        {sorted.length > 1 ? (
          <Appear index={5}>
            <GlassCard>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 16, color: ink, marginBottom: 10 }}>{L(PAIR_ALL)}</Text>
              {sorted.map((n, i) => (
                <View key={n.id} style={{ paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(127,127,127,0.25)' }}>
                  <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: muted }}>{noteHeader(n)}</Text>
                  <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: ink, marginTop: 2 }}>{n.title}</Text>
                </View>
              ))}
            </GlassCard>
          </Appear>
        ) : null}

        {/* footer: freshness and refresh */}
        <Appear index={6} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 6 }}>
          <Text style={{ fontFamily: fonts.regular, fontSize: 12, color: muted }}>
            {`${L(PAIR_UPDATED)} ${minsAgo}`}
            {stale ? ` · ${L(PAIR_OFFLINE)}` : ''}
            {f.source ? ` · ${f.source === 'google' ? 'Google' : 'Open-Meteo'}` : ''}
          </Text>
          <RoundButton label={L(PAIR_REFRESH)} onPress={() => void refresh()} ink={ink}>
            <RefreshCw size={16} color={ink} />
          </RoundButton>
        </Appear>
      </ScrollView>
    </View>
  );
}
