import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { Flower } from '../../components/Deco';
import { GuideView } from '../../components/GuideView';
import { Screen } from '../../components/Screen';
import { Card, Txt, useTheme } from '../../components/ui';
import { useLocal, useT } from '../../i18n';
import { getGuide } from '../../kb';

export default function GuideScreen() {
  const { p } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = getGuide(String(id));
  const L = useLocal();
  const t = useT();
  return (
    <Screen title={g ? L(g.title) : t('aidTitle')}>
      {g ? (
        <GuideView guide={g} />
      ) : (
        <Card tint="lilac" style={{ overflow: 'hidden', minHeight: 120, justifyContent: 'center', paddingRight: 92 }}>
          <Txt size={15} weight="700" color={p.tint.lilac.ink}>
            {t('noMatch')}
          </Txt>
          <View pointerEvents="none" style={{ position: 'absolute', right: -12, top: -14, transform: [{ rotate: '12deg' }] }}>
            <Flower size={88} />
          </View>
        </Card>
      )}
    </Screen>
  );
}
