import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { GuideView } from '../../components/GuideView';
import { Screen } from '../../components/Screen';
import { Txt } from '../../components/ui';
import { useLocal, useT } from '../../i18n';
import { getGuide } from '../../kb';

export default function GuideScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = getGuide(String(id));
  const L = useLocal();
  const t = useT();
  return <Screen title={g ? L(g.title) : t('aidTitle')}>{g ? <GuideView guide={g} /> : <Txt>{t('noMatch')}</Txt>}</Screen>;
}
