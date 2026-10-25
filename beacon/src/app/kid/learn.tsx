import { router } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { Icon } from '../../components/Icon';
import { Screen } from '../../components/Screen';
import { Shield } from '../../components/Deco';
import { Appear, Card, IconTile, Press, Row, Txt, useTheme } from '../../components/ui';
import { useLocal, useT } from '../../i18n';
import { DRILLS } from '../../kb/kidDrills';
import { useSettings } from '../../state/settings';
import { Stars } from '../../components/Stars';

export default function Learn() {
  const t = useT();
  const L = useLocal();
  const { p } = useTheme();
  const stars = useSettings((s) => s.stars);
  return (
    <Screen back={false}>
      <Appear>
        <Card tint="green" style={{ overflow: 'hidden', minHeight: 140, justifyContent: 'flex-end', padding: 20 }}>
          <View style={{ gap: 4, paddingRight: 92 }}>
            <Txt size={30} weight="700" color={p.tint.green.ink}>
              {t('kidDrills')}
            </Txt>
            <Txt size={14} color={p.tint.green.ink} style={{ opacity: 0.8 }}>
              {t('kidReady')}
            </Txt>
          </View>
          <View pointerEvents="none" style={{ position: 'absolute', right: -10, top: -14, transform: [{ rotate: '12deg' }] }}>
            <Shield size={92} />
          </View>
        </Card>
      </Appear>
      {DRILLS.map((d, i) => (
        <Appear key={d.id} index={i + 1}>
          <Press accessibilityRole="button" onPress={() => router.push(`/drill/${d.id}` as never)}>
            <Card tint={d.tint} style={{ padding: 16 }}>
              <Row style={{ gap: 14 }}>
                <IconTile name={d.icon} tint={d.tint} size={44} color={p.tint[d.tint].ink} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Txt size={16} weight="700" color={p.tint[d.tint].ink}>
                    {L(d.title)}
                  </Txt>
                  <Txt size={12.5} color={p.tint[d.tint].ink} numberOfLines={2}>
                    {L(d.intro)}
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
