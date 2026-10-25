import { router } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { Stars } from '../components/Stars';
import { Appear, Card, IconTile, Press, Row, Txt, useTheme } from '../components/ui';
import { useLocal, useT } from '../i18n';
import { DRILLS } from '../kb/kidDrills';
import { useSettings } from '../state/settings';
import { Bolt } from '../components/Deco';

export default function Drills() {
  const { p } = useTheme();
  const t = useT();
  const L = useLocal();
  const stars = useSettings((s) => s.stars);
  return (
    <Screen title={t('drills')}>
      <Appear>
        <Card tint="yellow" style={{ overflow: 'hidden', minHeight: 130, justifyContent: 'flex-end', padding: 20 }}>
          <Txt size={28} weight="700" color={p.tint.yellow.ink} style={{ paddingRight: 92 }}>
            {t('drills')}
          </Txt>
          <View pointerEvents="none" style={{ position: 'absolute', right: -12, top: -14, transform: [{ rotate: '12deg' }] }}>
            <Bolt size={92} />
          </View>
        </Card>
      </Appear>
      {DRILLS.map((d, i) => (
        <Appear key={d.id} index={i}>
          <Press accessibilityRole="button" onPress={() => router.push(`/drill/${d.id}` as never)}>
            <Card tint={d.tint} style={{ padding: 14, borderRadius: 24 }}>
              <Row style={{ gap: 12 }}>
                <IconTile name={d.icon} tint={d.tint} size={40} color={p.tint[d.tint].ink} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Txt size={15.5} weight="700" color={p.tint[d.tint].ink}>
                    {L(d.title)}
                  </Txt>
                  <Stars n={stars[d.id] ?? 0} />
                </View>
                <Icon name="next" size={16} color={p.tint[d.tint].ink} />
              </Row>
            </Card>
          </Press>
        </Appear>
      ))}
    </Screen>
  );
}
