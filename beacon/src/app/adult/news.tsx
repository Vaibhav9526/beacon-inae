import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { AlertCard } from '../../components/AlertCard';
import { Icon } from '../../components/Icon';
import { Screen } from '../../components/Screen';
import { Appear, Badge, Btn, Card, Chip, Row, Txt, useTheme } from '../../components/ui';
import { useT } from '../../i18n';
import { useAlerts } from '../../services/alerts';
import { type NewsCard, type ReportView, cloud, cloudConfigured } from '../../services/cloud';
import { getFix } from '../../services/location';
import { vote } from '../../services/reports';
import { severityColor } from '../../theme';

const CACHE = 'beacon.news.v1';
const ago = (ts: number) => {
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

export default function News() {
  const { p } = useTheme();
  const t = useT();
  const alerts = useAlerts((s) => s.items);
  const refreshAlerts = useAlerts((s) => s.refresh);
  const [cards, setCards] = useState<NewsCard[]>([]);
  const [reports, setReports] = useState<ReportView[]>([]);
  const [tab, setTab] = useState<'news' | 'reports' | 'alerts'>('news');
  const [loading, setLoading] = useState(false);
  const [voted, setVoted] = useState<Record<string, 'real' | 'fake'>>({});
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const raw = await AsyncStorage.getItem(CACHE);
      if (raw) setCards(JSON.parse(raw));
    } catch {
      /* no cache yet */
    }
    if (cloudConfigured()) {
      try {
        const fix = await getFix({ maxWaitMs: 4000 });
        if (fix) {
          const [n, r] = await Promise.all([cloud.get<{ cards: NewsCard[] }>(`/v1/news?lat=${fix.lat}&lon=${fix.lon}`), cloud.get<{ reports: ReportView[] }>(`/v1/reports?lat=${fix.lat}&lon=${fix.lon}`)]);
          setCards(n.cards);
          setReports(r.reports);
          AsyncStorage.setItem(CACHE, JSON.stringify(n.cards)).catch(() => {});
        }
      } catch (e) {
        setErr(String((e as Error).message));
      }
    }
    void refreshAlerts();
    setLoading(false);
  }, [refreshAlerts]);

  useEffect(() => {
    void load();
  }, [load]);

  const cast = async (id: string, v: 'real' | 'fake') => {
    setVoted((x) => ({ ...x, [id]: v }));
    try {
      await vote(id, v);
      void load();
    } catch (e) {
      setErr(String((e as Error).message));
    }
  };

  // offline: the news feed is built from the alerts this phone already has
  const offlineCards: NewsCard[] = alerts.map((a) => ({ id: a.id, kind: 'alert', title: a.title, summary: a.body.split(/\s+/).slice(0, 58).join(' '), severity: a.severity, source: a.source, ts: a.seenAt }));
  const feed = cards.length ? cards : offlineCards;

  const badge = (b?: string) => (b === 'community-verified' ? <Badge soft label={t('communityVerified')} color={p.ok} /> : b === 'disputed' ? <Badge soft label={t('disputed')} color={p.warn} /> : <Badge soft label={t('newReport')} color={p.muted} />);

  return (
    <Screen back={false} title={t('newsTitle')} right={<Btn size="sm" kind="ghost" icon="refresh" label="" onPress={() => void load()} disabled={loading} />}>
      <Row style={{ gap: 6, flexWrap: 'wrap' }}>
        <Chip icon="news" label={t('tabNews')} active={tab === 'news'} onPress={() => setTab('news')} />
        <Chip icon="camera" label={t('reportsTitle')} active={tab === 'reports'} onPress={() => setTab('reports')} />
        <Chip icon="siren" label={t('tabAlerts')} active={tab === 'alerts'} onPress={() => setTab('alerts')} />
      </Row>
      {err ? <Txt size={12} color={p.danger}>{err}</Txt> : null}

      {tab === 'news' &&
        feed.map((c, i) => (
          <Appear key={c.id} index={i}>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {c.mediaUrl ? <Image source={{ uri: cloud.mediaUrl(c.mediaUrl) }} style={{ width: '100%', height: 160, backgroundColor: p.cardAlt }} resizeMode="cover" /> : null}
              <View style={{ padding: 14, gap: 6 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  {c.severity ? <Badge soft label={t(c.severity as 'severe').toUpperCase()} color={severityColor(p, c.severity)} /> : badge(c.badge)}
                  <Txt size={11} color={p.muted}>
                    {c.source} · {ago(c.ts)}
                  </Txt>
                </Row>
                <Txt size={16} weight="600">
                  {c.title}
                </Txt>
                <Txt size={13.5} color={p.muted}>
                  {c.summary}
                </Txt>
              </View>
            </Card>
          </Appear>
        ))}

      {tab === 'alerts' && (alerts.length ? alerts.map((a, i) => (
        <Appear key={a.id} index={i}>
          <AlertCard a={a} />
        </Appear>
      )) : <Txt size={13} color={p.muted}>{t('noAlerts')}</Txt>)}

      {tab === 'reports' && (
        <>
          <Btn label={t('postReport')} icon="camera" onPress={() => router.push('/report/new' as never)} />
          {!cloudConfigured() ? <Txt size={12} color={p.muted}>{t('serverNotSet')}</Txt> : null}
          {reports.map((r, i) => (
            <Appear key={r.id} index={i}>
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                <Image source={{ uri: cloud.mediaUrl(r.thumbUrl ?? r.mediaUrl) }} style={{ width: '100%', height: 230, backgroundColor: p.cardAlt }} resizeMode="cover" />
                <View style={{ padding: 14, gap: 8 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    {badge(r.badge)}
                    {r.kind === 'video' ? <Icon name="playTri" size={13} color={p.muted} /> : null}
                    {r.delayed ? <Txt size={11} color={p.muted}>{t('delayed')}</Txt> : null}
                  </Row>
                  <Txt size={14} weight="500">
                    {r.summary}
                  </Txt>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Txt size={12} color={p.muted}>
                      {t('isItReal')}
                    </Txt>
                    <Row style={{ gap: 6 }}>
                      <Btn size="sm" kind={voted[r.id] === 'real' ? 'primary' : 'secondary'} icon="check" label={`${t('real')} ${r.realVotes}`} onPress={() => void cast(r.id, 'real')} />
                      <Btn size="sm" kind={voted[r.id] === 'fake' ? 'danger' : 'secondary'} icon="close" label={`${t('fake')} ${r.fakeVotes}`} onPress={() => void cast(r.id, 'fake')} />
                    </Row>
                  </Row>
                </View>
              </Card>
            </Appear>
          ))}
        </>
      )}
    </Screen>
  );
}
