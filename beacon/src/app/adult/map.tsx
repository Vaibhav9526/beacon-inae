import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { OfflineMap } from '../../components/OfflineMap';
import { Screen } from '../../components/Screen';
import { useT } from '../../i18n';
import type { PlaceKind } from '../../maps/osm';

export default function AdultMap() {
  const { place } = useLocalSearchParams<{ place?: PlaceKind }>();
  const t = useT();
  return (
    <Screen back={false} title={t('mapTitle')}>
      <OfflineMap initialPlace={place} />
    </Screen>
  );
}
