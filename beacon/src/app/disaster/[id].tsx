import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { Wave } from '../../components/Deco';
import { DisasterView } from '../../components/GuideView';
import { Screen } from '../../components/Screen';
import { Card, Txt, useTheme } from '../../components/ui';
import { useLocal, useT } from '../../i18n';
import { getDisaster } from '../../kb';

export default function DisasterScreen() {
  const { p } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const d = getDisaster(String(id));
  const L = useLocal();
  const t = useT();
  return (
    <Screen title={d ? L(d.title) : t('aidTitle')}>
      {d ? (
        <DisasterView d={d} />
      ) : (
        <Card tint="blue" style={{ overflow: 'hidden', minHeight: 120, justifyContent: 'center', paddingRight: 92 }}>
          <Txt size={15} weight="700" color={p.tint.blue.ink}>
            {t('noMatch')}
          </Txt>
          <View pointerEvents="none" style={{ position: 'absolute', right: -12, top: -14, transform: [{ rotate: '12deg' }] }}>
            <Wave size={88} />
          </View>
        </Card>
      )}
    </Screen>
  );
}
