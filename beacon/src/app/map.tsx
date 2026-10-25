import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { OfflineMap } from '../components/OfflineMap';
import { Screen } from '../components/Screen';
import { useT } from '../i18n';
import type { PlaceKind } from '../maps/osm';
import { useSettings } from '../state/settings';

/** Shared map route. Kids get a "safe spots" title. */
export default function MapRoute() {
  const { place } = useLocalSearchParams<{ place?: PlaceKind }>();
  const t = useT();
  const mode = useSettings((s) => s.mode);

  return (
    <Screen title={mode === 'kid' ? t('kidSafeSpot') : t('mapTitle')}>
      <OfflineMap initialPlace={place} />
    </Screen>
  );
}
