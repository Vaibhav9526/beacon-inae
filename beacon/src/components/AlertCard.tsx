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
  // alerts are sticker cards: severe=pink, warn=peach, watch=blue, info=lilac
  const tint = a.severity === 'severe' ? 'pink' : a.severity === 'warning' ? 'peach' : a.severity === 'watch' ? 'blue' : 'lilac';
  const ink = p.tint[tint].ink;
  return (
    <Card tint={tint} style={{ gap: 6, padding: 16 }}>
      <Row style={{ alignItems: 'flex-start', gap: 10 }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: ink, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={iconFor(a)} size={17} color={p.tint[tint].bg} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Row style={{ gap: 6, flexWrap: 'wrap' }}>
            <Badge soft label={t(a.severity).toUpperCase()} color={ink} />
            <Badge soft label={a.trust === 'official' ? t('verifiedOfficial') : t('unverified')} color={ink} />
          </Row>
          <Txt size={16} weight="700" color={ink}>
            {a.title}
          </Txt>
          {!compact ? (
            <Txt size={13} color={ink}>
              {a.body}
            </Txt>
          ) : null}
          <Txt size={11} color={ink}>
            {a.source}
          </Txt>
        </View>
        {!compact ? (
          <Press accessibilityLabel={t('readAloud')} onPress={() => void speak(`${a.title}. ${a.body}`, lang, 'veer')} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: ink, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="speaker" size={14} color={p.tint[tint].bg} />
          </Press>
        ) : null}
      </Row>
    </Card>
  );
}
