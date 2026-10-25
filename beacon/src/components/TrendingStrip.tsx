import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useT } from '../i18n';
import { useAlerts } from '../services/alerts';
import { type NewsCard, cloud, cloudConfigured } from '../services/cloud';
import { getFix, lastKnownFix } from '../services/location';
import { useWeather } from '../services/weather';
import { forecastNotes } from '../services/weatherLogic';
import { Bell } from './Deco';
import { Icon, type IconName } from './Icon';
import { Skeleton } from './Skeleton';
import { Badge, Btn, Press, Row, SectionTitle, Txt, useTheme, Card } from './ui';

/** same cache key as the news screen, so the strip can show the last feed before the network answers */
const CACHE = 'beacon.news.v1';
/** ink colour for text on the tinted cards, as on the news screen */
const INK = '#0A0A0C';
const MAX = 6;
/** the simple list on the adult home shows at most this many rows */
const LIST_MAX = 5;

const RANK: Record<string, number> = { severe: 0, warning: 1, watch: 2, info: 3 };
/** weather cards tint by severity; info is yellow here, unlike alerts */
const WX_TINT: Record<string, 'pink' | 'peach' | 'blue' | 'yellow'> = { severe: 'pink', warning: 'peach', watch: 'blue', info: 'yellow' };

/** a forecast note shown in the strip */
type WxCard = Omit<NewsCard, 'kind'> & { kind: 'weather'; day: string | null };
type Item = NewsCard | WxCard;

const ago = (ts: number) => {
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

const tintOf = (s?: string) => (s === 'severe' ? 'pink' : s === 'warning' ? 'peach' : s === 'watch' ? 'blue' : 'lilac') as 'pink' | 'peach' | 'blue' | 'lilac';

const short = (text: string, words = 14) => {
  const w = text.split(/\s+/).filter(Boolean);
  return w.length > words ? `${w.slice(0, words).join(' ')}…` : w.join(' ');
};

/** Alerts on the phone, the server's news feed and forecast warnings, merged, de-duplicated and ranked by severity. */
function useNearbyCards() {
  const alerts = useAlerts((s) => s.items);
  const { forecast, loading: weatherLoading } = useWeather();
  const [news, setNews] = useState<NewsCard[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await AsyncStorage.getItem(CACHE);
      if (raw) setNews(JSON.parse(raw) as NewsCard[]);
    } catch {
      /* no cache yet */
    }
    if (cloudConfigured()) {
      try {
        const fix = (await getFix({ maxWaitMs: 4000 })) ?? (await lastKnownFix());
        if (fix) {
          const res = await cloud.get<{ cards: NewsCard[] }>(`/v1/news?lat=${fix.lat}&lon=${fix.lon}`);
          const cards = res.cards ?? [];
          setNews(cards);
          AsyncStorage.setItem(CACHE, JSON.stringify(cards)).catch(() => {});
        }
      } catch {
        /* news is optional: keep whatever we already have */
      }
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const fromAlerts: NewsCard[] = alerts.map((a) => ({ id: a.id, kind: 'alert', title: a.title, summary: a.body, severity: a.severity, source: a.source, ts: a.seenAt }));

  const fromWeather = useMemo<WxCard[]>(
    () =>
      forecast
        ? forecastNotes(forecast)
            .filter((n) => (RANK[n.severity] ?? 4) <= RANK.watch)
            .map((n) => ({
              id: 'wx-' + n.id,
              kind: 'weather' as const,
              title: n.title,
              summary: n.body,
              severity: n.severity,
              source: 'Forecast',
              ts: n.at ?? forecast.fetchedAt,
              day: n.day,
            }))
        : [],
    [forecast],
  );

  const seen = new Set<string>();
  const cards: Item[] = [...fromAlerts, ...news, ...fromWeather]
    .filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    })
    .sort((x, y) => (RANK[x.severity ?? ''] ?? 4) - (RANK[y.severity ?? ''] ?? 4) || y.ts - x.ts)
    .slice(0, MAX);

  return { cards, loading, weatherLoading };
}

/** Horizontal strip of what is happening near the user: alerts already on the phone, the server's news feed, and forecast warnings. */
export function TrendingStrip() {
  const { p } = useTheme();
  const t = useT();
  const { cards, loading, weatherLoading } = useNearbyCards();

  return (
    <View style={{ gap: 10 }}>
      <SectionTitle>Trending near you</SectionTitle>
      {cards.length === 0 && (loading || weatherLoading) ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
          {[0, 1].map((i) => (
            <View key={i} style={{ width: 250, height: 150, borderRadius: 24, padding: 16, gap: 10, backgroundColor: p.cardAlt }}>
              <Skeleton w={70} h={18} r={9} />
              <Skeleton w="90%" h={14} />
              <Skeleton w="70%" h={14} />
              <Skeleton w="50%" h={10} />
            </View>
          ))}
        </ScrollView>
      ) : cards.length === 0 ? (
        <Card style={{ overflow: 'hidden', minHeight: 110, justifyContent: 'center', paddingRight: 90 }}>
          <Txt size={15} weight="600">
            No news yet. Check back soon
          </Txt>
          <View pointerEvents="none" style={{ position: 'absolute', right: -10, top: -10, transform: [{ rotate: '12deg' }] }}>
            <Bell size={78} />
          </View>
        </Card>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
          {cards.map((c) => {
            const isWx = c.kind === 'weather';
            const tint = isWx ? WX_TINT[c.severity ?? 'info'] ?? 'yellow' : tintOf(c.severity);
            const label = isWx && (c.severity === 'info' || c.severity === 'watch') ? 'WEATHER' : c.severity ? t(c.severity as 'severe').toUpperCase() : t('tabNews').toUpperCase();
            const age = isWx && c.day ? c.day.slice(0, 3) : ago(c.ts);
            return (
              <Press
                key={c.id}
                onPress={() => router.push((isWx ? '/weather' : '/adult/news') as never)}
                accessibilityRole="button"
                accessibilityLabel={c.title}
                style={{ width: 250 }}
              >
                <View style={{ width: 250, minHeight: 150, borderRadius: 24, padding: 16, gap: 8, backgroundColor: p.tint[tint].bg }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Badge soft label={label} color={INK} />
                    <Txt size={11} color={INK}>
                      {age}
                    </Txt>
                  </Row>
                  <Txt size={15} weight="700" color={INK} numberOfLines={2}>
                    {c.title}
                  </Txt>
                  <Txt size={12.5} color={INK} numberOfLines={1}>
                    {short(c.summary)}
                  </Txt>
                  <Txt size={11} color={INK} numberOfLines={1} style={{ opacity: 0.75, marginTop: 'auto' }}>
                    {c.source}
                  </Txt>
                </View>
              </Press>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

/** Plain list rows for the adult home: up to five items, tinted icon, title, one-line summary and age. */
export function TrendingList() {
  const { p } = useTheme();
  const t = useT();
  const { cards, loading, weatherLoading } = useNearbyCards();
  const rows = cards.slice(0, LIST_MAX);

  return (
    <View style={{ gap: 4 }}>
      <Txt size={15} weight="600">
        Alerts and news
      </Txt>
      {rows.length === 0 ? (
        <Txt size={13} color={p.muted} style={{ paddingVertical: 10 }}>
          {loading || weatherLoading ? 'Loading…' : t('noAlerts')}
        </Txt>
      ) : (
        rows.map((c, i) => {
          const isWx = c.kind === 'weather';
          const tint = isWx ? WX_TINT[c.severity ?? 'info'] ?? 'yellow' : tintOf(c.severity);
          const icon: IconName = isWx ? 'cloud' : c.kind === 'alert' ? 'alert' : 'news';
          const age = isWx && c.day ? c.day.slice(0, 3) : ago(c.ts);
          return (
            <View key={c.id}>
              {i > 0 ? <View style={{ height: 1, backgroundColor: p.border }} /> : null}
              <Press
                onPress={() => router.push((isWx ? '/weather' : '/adult/news') as never)}
                accessibilityRole="button"
                accessibilityLabel={c.title}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}
              >
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: p.tint[tint].bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={icon} size={18} color={p.tint[tint].ink} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt size={14} weight="600" numberOfLines={1}>
                    {c.title}
                  </Txt>
                  <Txt size={12} color={p.muted} numberOfLines={1}>
                    {short(c.summary, 12)}
                  </Txt>
                </View>
                <Txt size={11.5} color={p.muted}>
                  {age}
                </Txt>
              </Press>
            </View>
          );
        })
      )}
    </View>
  );
}
