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

export default function Drills() {
  const { p } = useTheme();
  const t = useT();
  const L = useLocal();
  const stars = useSettings((s) => s.stars);
  return (
    <Screen title={t('drills')}>
      {DRILLS.map((d, i) => (
        <Appear key={d.id} index={i}>
          <Press accessibilityRole="button" onPress={() => router.push(`/drill/${d.id}` as never)}>
            <Card style={{ padding: 12 }}>
              <Row style={{ gap: 12 }}>
                <IconTile name={d.icon} tint={d.tint} size={38} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Txt size={14.5} weight="600">
                    {L(d.title)}
                  </Txt>
                  <Stars n={stars[d.id] ?? 0} />
                </View>
                <Icon name="next" size={16} color={p.muted} />
              </Row>
            </Card>
          </Press>
        </Appear>
      ))}
    </Screen>
  );
}
