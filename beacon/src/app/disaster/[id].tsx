import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { DisasterView } from '../../components/GuideView';
import { Screen } from '../../components/Screen';
import { Txt } from '../../components/ui';
import { useLocal, useT } from '../../i18n';
import { getDisaster } from '../../kb';

export default function DisasterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const d = getDisaster(String(id));
  const L = useLocal();
  const t = useT();
  return <Screen title={d ? L(d.title) : t('aidTitle')}>{d ? <DisasterView d={d} /> : <Txt>{t('noMatch')}</Txt>}</Screen>;
}
