import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo } from 'react';
import { Linking, Share } from 'react-native';
import { Icon, type IconName } from '../../components/Icon';
import { Screen } from '../../components/Screen';
import { Appear, Badge, Btn, Card, Row, Txt, useTheme, type TintName } from '../../components/ui';
import { relativeTime, useLang, useLocal } from '../../i18n';
import type { T } from '../../kb/types';
import { dodontFor } from '../../kb/dodont';
import { useAlerts } from '../../services/alerts';
import { useHubFeed } from '../../services/hubFeed';
import { KIND_LABEL, SEVERITY_LABEL, dataRows, whenLabel, type NoticeKind } from '../../services/notify';
import type { FeedItem } from '../../services/wire';
import { hazardIdFor } from '../../state/phaseLogic';
import { useNotices } from '../../state/notices';
import { severityColor } from '../../theme';

const PAIR_TITLE: T = ['Details', 'विवरण'];
const PAIR_MISSING: T = ['This update is no longer stored on this phone.', 'यह अपडेट अब इस फ़ोन में सहेजा नहीं है।'];
const PAIR_BACK: T = ['Back', 'वापस'];
const PAIR_DATA: T = ['Numbers', 'आँकड़े'];
const PAIR_WHAT: T = ['What to do', 'क्या करें'];
const PAIR_DO: T = ['Do', 'करें'];
const PAIR_DONT: T = ['Do not', 'न करें'];
const PAIR_WEATHER: T = ['Open weather', 'मौसम खोलें'];
const PAIR_MAP: T = ['Open map', 'नक्शा खोलें'];
const PAIR_SHARE: T = ['Share', 'साझा करें'];
const PAIR_LINK: T = ['Open link', 'लिंक खोलें'];
const PAIR_ACTIONS: T = ['Quick actions', 'त्वरित कार्य'];

/** Kinds where the weather screen is the right next step. */
const WEATHER_KINDS: NoticeKind[] = ['weather', 'wind', 'flood'];
/** Internal tags the hub uses for routing; not shown to the person. */
const INTERNAL_TAGS = new Set(['notify', 'digest']);

const TINT_FOR = (s: 'info' | 'watch' | 'warning' | 'severe'): TintName => (s === 'severe' ? 'pink' : s === 'warning' ? 'peach' : s === 'watch' ? 'blue' : 'lilac');
const ICON_FOR: Record<NoticeKind, IconName> = { news: 'news', weather: 'cloud', wind: 'wind', quake: 'mountain', flood: 'flood', alert: 'siren', health: 'heartPulse', supply: 'package', advisory: 'info', chat: 'family', custom: 'bell' };

interface NoticeView {
  id: string;
  kind: NoticeKind;
  title: string;
  body: string;
  text: string;
  severity: 'info' | 'watch' | 'warning' | 'severe';
  at: number;
  source: string;
  url?: string;
  data?: FeedItem['data'];
  tags: string[];
}

function fromFeed(it: FeedItem, lang: 'en' | 'hi'): NoticeView {
  return {
    id: it.id,
    kind: it.kind,
    title: it.title,
    body: it.body,
    text: it.detail?.trim() || it.body,
    severity: it.severity,
    at: it.at,
    source: lang === 'hi' ? `${it.agentName} से` : `From ${it.agentName}`,
    url: it.url,
    data: it.data,
    tags: [...(it.place ? [it.place] : []), ...it.tags.filter((t) => !INTERNAL_TAGS.has(t))],
  };
}

export default function NoticeDetail() {
  const { p } = useTheme();
  const L = useLocal();
  const lang = useLang();
  const raw = useLocalSearchParams<{ id: string }>().id;
  const id = raw ? decodeURIComponent(String(raw)) : '';
  const feedItem = useHubFeed((s) => s.items.find((i) => i.id === id));
  const alert = useAlerts((s) => s.items.find((a) => a.id === id));
  const markRead = useNotices((s) => s.markRead);

  useEffect(() => {
    if (id && (feedItem || alert)) markRead([id]);
  }, [id, feedItem, alert, markRead]);

  const v: NoticeView | null = useMemo(() => {
    if (feedItem) return fromFeed(feedItem, lang);
    if (alert)
      return { id: alert.id, kind: 'alert', title: alert.title, body: alert.body, text: alert.body, severity: alert.severity, at: alert.seenAt, source: alert.source, tags: [] };
    return null;
  }, [feedItem, alert, lang]);

  if (!v) {
    return (
      <Screen title={L(PAIR_TITLE)}>
        <Card tint="lilac" style={{ gap: 12, padding: 18 }}>
          <Txt size={15} color={p.tint.lilac.ink}>
            {L(PAIR_MISSING)}
          </Txt>
          <Btn label={L(PAIR_BACK)} icon="back" kind="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace('/notices' as never))} />
        </Card>
      </Screen>
    );
  }

  const tint = TINT_FOR(v.severity);
  const ink = p.tint[tint].ink;
  const rows = dataRows(v.data, lang);
  const hazard = dodontFor(hazardIdFor(`${v.title} ${v.body}`) ?? '', lang);
  const share = () => void Share.share({ title: v.title, message: `${v.title}\n\n${v.text}` }).catch(() => {});
  const openUrl = () => void Linking.openURL(v.url!).catch(() => {});

  return (
    <Screen title={L(PAIR_TITLE)}>
      <Appear index={0}>
        <Card tint={tint} style={{ gap: 10, padding: 18 }}>
          <Row style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge soft label={L(SEVERITY_LABEL[v.severity]).toUpperCase()} color={ink} />
            <Badge soft label={L(KIND_LABEL[v.kind])} color={ink} />
          </Row>
          <Txt size={22} weight="700" color={ink}>
            {v.title}
          </Txt>
          <Row style={{ gap: 8, flexWrap: 'wrap' }}>
            <Txt size={12} color={ink}>
              {whenLabel(v.at, Date.now(), lang)}
            </Txt>
            <Txt size={12} color={ink}>
              · {relativeTime(v.at, lang)}
            </Txt>
          </Row>
          <Txt size={12} weight="600" color={ink}>
            {v.source}
          </Txt>
          <Txt size={15} color={ink} style={{ marginTop: 6 }}>
            {v.text}
          </Txt>
        </Card>
      </Appear>

      {rows.length > 0 ? (
        <Appear index={1}>
          <Card style={{ gap: 10 }}>
            <Txt size={12} weight="600" color={p.muted}>
              {L(PAIR_DATA)}
            </Txt>
            {rows.map((r, i) => (
              <Row key={`${r.label}-${i}`} style={{ justifyContent: 'space-between', borderTopWidth: i === 0 ? 0 : 1, borderTopColor: p.border, paddingTop: i === 0 ? 0 : 8 }}>
                <Txt size={14} color={p.muted}>
                  {r.label}
                </Txt>
                <Txt size={15} weight="600">
                  {r.value}
                </Txt>
              </Row>
            ))}
          </Card>
        </Appear>
      ) : null}

      {v.tags.length > 0 ? (
        <Row style={{ gap: 6, flexWrap: 'wrap' }}>
          {v.tags.map((t) => (
            <Badge key={t} soft label={t} color={p.muted} />
          ))}
        </Row>
      ) : null}

      {hazard ? (
        <Appear index={2}>
          <Card tint="green" style={{ gap: 10 }}>
            <Txt size={16} weight="700" color={p.tint.green.ink}>
              {L(PAIR_WHAT)}
            </Txt>
            <Txt size={12} weight="600" color={p.tint.green.ink}>
              {L(PAIR_DO)}
            </Txt>
            {hazard.do.slice(0, 4).map((line) => (
              <Row key={line} style={{ gap: 8, alignItems: 'flex-start' }}>
                <Icon name="check" size={14} color={p.tint.green.ink} />
                <Txt size={14} color={p.tint.green.ink} style={{ flex: 1 }}>
                  {line}
                </Txt>
              </Row>
            ))}
            <Txt size={12} weight="600" color={p.tint.green.ink}>
              {L(PAIR_DONT)}
            </Txt>
            {hazard.dont.slice(0, 4).map((line) => (
              <Row key={line} style={{ gap: 8, alignItems: 'flex-start' }}>
                <Icon name="close" size={14} color={p.tint.green.ink} />
                <Txt size={14} color={p.tint.green.ink} style={{ flex: 1 }}>
                  {line}
                </Txt>
              </Row>
            ))}
          </Card>
        </Appear>
      ) : null}

      <Txt size={12} weight="600" color={p.muted}>
        {L(PAIR_ACTIONS)}
      </Txt>
      <Row style={{ gap: 8, flexWrap: 'wrap' }}>
        {WEATHER_KINDS.includes(v.kind) ? <Btn size="sm" kind="secondary" icon="cloud" label={L(PAIR_WEATHER)} onPress={() => router.push('/weather' as never)} /> : null}
        <Btn size="sm" kind="secondary" icon="map" label={L(PAIR_MAP)} onPress={() => router.push('/map' as never)} />
        <Btn size="sm" kind="secondary" icon="send" label={L(PAIR_SHARE)} onPress={share} />
        {v.url ? <Btn size="sm" kind="secondary" icon="link" label={L(PAIR_LINK)} onPress={openUrl} /> : null}
      </Row>
    </Screen>
  );
}
