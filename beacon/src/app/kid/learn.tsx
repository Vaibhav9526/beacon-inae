import { router } from 'expo-router';
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../components/Icon';
import { Appear, Card, IconTile, Press, Row, Txt, useTheme } from '../../components/ui';
import { useLocal, useT } from '../../i18n';
import { DRILLS } from '../../kb/kidDrills';
import { useSettings } from '../../state/settings';
import { Stars } from '../../components/Stars';

export default function Learn() {
  const t = useT();
  const L = useLocal();
  const { p } = useTheme();
  const insets = useSafeAreaInsets();
  const stars = useSettings((s) => s.stars);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.bg }} contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 120, gap: 12 }} showsVerticalScrollIndicator={false}>
      <Appear>
        <View style={{ gap: 2 }}>
          <Txt size={24} weight="600">
            {t('kidDrills')}
          </Txt>
          <Txt size={13} color={p.muted}>
            {t('kidReady')}
          </Txt>
        </View>
      </Appear>
      {DRILLS.map((d, i) => (
        <Appear key={d.id} index={i + 1}>
          <Press accessibilityRole="button" onPress={() => router.push(`/drill/${d.id}` as never)}>
            <Card style={{ padding: 14 }}>
              <Row style={{ gap: 14 }}>
                <IconTile name={d.icon} tint={d.tint} size={44} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Txt size={15.5} weight="600">
                    {L(d.title)}
                  </Txt>
                  <Txt size={12} color={p.muted} numberOfLines={2}>
                    {L(d.intro)}
                  </Txt>
                  <Stars n={stars[d.id] ?? 0} />
                </View>
                <Icon name="next" size={16} color={p.muted} />
              </Row>
            </Card>
          </Press>
        </Appear>
      ))}
    </ScrollView>
  );
}
