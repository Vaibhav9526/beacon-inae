import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { Bell } from '../components/Deco';
import { Icon, type IconName } from '../components/Icon';
import { Screen } from '../components/Screen';
import { Appear, Btn, Card, Press, Row, Txt, useTheme, type TintName } from '../components/ui';
import { useLang, useLocal, relativeTime } from '../i18n';
import type { T } from '../kb/types';
import { useAlerts } from '../services/alerts';
import { useHubFeed } from '../services/hubFeed';
import { KIND_LABEL, SEVERITY_LABEL, mergeNotices, type NoticeKind, type NoticeRow } from '../services/notify';
import { useNotices } from '../state/notices';
import { severityColor } from '../theme';

const PAIR_TITLE: T = ['Notices', 'सूचनाएँ'];
const PAIR_MARK_ALL: T = ['Mark all read', 'सब पढ़ा हुआ करें'];
const PAIR_EMPTY: T = ['Nothing here yet. Updates from your hub and official alerts will show up here.', 'अभी यहाँ कुछ नहीं। हब और सरकारी चेतावनियों की सूचनाएँ यहाँ दिखेंगी।'];

const LIMIT = 50;

const ICON_FOR: Record<NoticeKind, IconName> = {
  news: 'news',
  weather: 'cloud',
  wind: 'wind',
  quake: 'mountain',
  flood: 'flood',
  alert: 'siren',
  health: 'heartPulse',
  supply: 'package',
  advisory: 'info',
  chat: 'family',
  custom: 'bell',
};

/** Tint by severity: the same pastels the alert cards use. */
const TINT_FOR = (s: NoticeRow['severity']): TintName => (s === 'severe' ? 'pink' : s === 'warning' ? 'peach' : s === 'watch' ? 'blue' : 'lilac');

export default function Notices() {
  const { p } = useTheme();
  const L = useLocal();
  const lang = useLang();
  const items = useHubFeed((s) => s.items);
  const alerts = useAlerts((s) => s.items);
  const readIds = useNotices((s) => s.readIds);
  const markRead = useNotices((s) => s.markRead);

  const rows = useMemo(() => mergeNotices(items, alerts, LIMIT), [items, alerts]);
  const read = useMemo(() => new Set(readIds), [readIds]);
  const unread = rows.filter((r) => !read.has(r.id)).length;

  return (
    <Screen title={L(PAIR_TITLE)}>
      {rows.length > 0 ? (
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Txt size={12.5} color={p.muted}>
            {unread > 0 ? `${unread}` : ''}
          </Txt>
          <Btn size="sm" kind="ghost" label={L(PAIR_MARK_ALL)} icon="check" disabled={unread === 0} onPress={() => markRead(rows.map((r) => r.id))} />
        </Row>
      ) : null}

      {rows.length === 0 ? (
        <Card tint="lilac" style={{ overflow: 'hidden', minHeight: 130, justifyContent: 'center', paddingRight: 96 }}>
          <Txt size={15} weight="600" color={p.tint.lilac.ink}>
            {L(PAIR_EMPTY)}
          </Txt>
          <View pointerEvents="none" style={{ position: 'absolute', right: -12, top: -14, transform: [{ rotate: '12deg' }] }}>
            <Bell size={88} />
          </View>
        </Card>
      ) : null}

      {rows.map((r, i) => {
        const isUnread = !read.has(r.id);
        const tint = TINT_FOR(r.severity);
        const ink = p.tint[tint].ink;
        return (
          <Appear key={`${r.origin}-${r.id}`} index={i}>
            <Press
              accessibilityRole="button"
              accessibilityLabel={r.title}
              onPress={() => router.push(`/notice/${encodeURIComponent(r.id)}` as never)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 20, backgroundColor: p.card, borderWidth: 1, borderColor: p.border }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: p.tint[tint].bg, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={ICON_FOR[r.kind]} size={18} color={ink} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Row style={{ gap: 6, alignItems: 'center' }}>
                  <Txt size={11} color={p.muted}>
                    {L(KIND_LABEL[r.kind])} · {relativeTime(r.at, lang)}
                  </Txt>
                  {r.severity === 'severe' || r.severity === 'warning' ? <Txt size={11} weight="600" color={severityColor(p, r.severity)}>{L(SEVERITY_LABEL[r.severity])}</Txt> : null}
                </Row>
                <Txt size={15} weight="600" numberOfLines={1}>
                  {r.title}
                </Txt>
                <Txt size={12.5} color={p.muted} numberOfLines={1}>
                  {r.body}
                </Txt>
              </View>
              {isUnread ? <View accessibilityLabel="unread" style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: p.accent }} /> : null}
            </Press>
          </Appear>
        );
      })}
    </Screen>
  );
}

