import React from 'react';
import { View } from 'react-native';
import { useT } from '../i18n';
import type { AlertItem } from '../services/alerts';
import { speak } from '../services/speech';
import { useSettings } from '../state/settings';
import { severityColor } from '../theme';
import { Icon, type IconName } from './Icon';
import { Badge, Card, Press, Row, Txt, useTheme } from './ui';

const iconFor = (a: AlertItem): IconName => {
  const t = `${a.title} ${a.source}`.toLowerCase();
  if (/quake/.test(t)) return 'mountain';
  if (/flood|rain/.test(t)) return 'flood';
  if (/wind|cyclone|storm gust/.test(t)) return 'wind';
  if (/heat/.test(t)) return 'heat';
  if (/thunder|lightning/.test(t)) return 'storm';
  if (/air|aqi|smoke/.test(t)) return 'cloud';
  return 'siren';
};

export function AlertCard({ a, compact }: { a: AlertItem; compact?: boolean }) {
  const { p } = useTheme();
  const t = useT();
  const lang = useSettings((s) => s.lang);
  const color = severityColor(p, a.severity);
  return (
    <Card style={{ gap: 6, padding: 12 }}>
      <Row style={{ alignItems: 'flex-start', gap: 10 }}>
        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: color + '22', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={iconFor(a)} size={16} color={color} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Row style={{ gap: 6, flexWrap: 'wrap' }}>
            <Badge soft label={t(a.severity).toUpperCase()} color={color} />
            <Badge soft label={a.trust === 'official' ? t('verifiedOfficial') : t('unverified')} color={a.trust === 'official' ? p.ok : p.muted} />
          </Row>
          <Txt size={15} weight="600">
            {a.title}
          </Txt>
          {!compact ? (
            <Txt size={13} color={p.muted}>
              {a.body}
            </Txt>
          ) : null}
          <Txt size={11} color={p.muted}>
            {a.source}
          </Txt>
        </View>
        {!compact ? (
          <Press accessibilityLabel={t('readAloud')} onPress={() => void speak(`${a.title}. ${a.body}`, lang, 'veer')} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: p.cardAlt, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="speaker" size={14} color={p.muted} />
          </Press>
        ) : null}
      </Row>
    </Card>
  );
}
