import { useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Linking } from 'react-native';
import { OfflineMap } from '../components/OfflineMap';
import { Screen } from '../components/Screen';
import { Icon } from '../components/Icon';
import { Press, Txt, useTheme } from '../components/ui';
import { useT } from '../i18n';
import type { PlaceKind } from '../maps/osm';
import { searchUrl } from '../services/gmaps';
import { lastKnownFix } from '../services/location';
import { useSettings } from '../state/settings';

const SEARCH_TERM: Record<'hospital' | 'shelter' | 'pharmacy' | 'police', string> = {
  hospital: 'hospital',
  shelter: 'shelter',
  pharmacy: 'pharmacy',
  police: 'police station',
};

/** Shared map route. Kids get a "safe spots" title. */
export default function MapRoute() {
  const { place } = useLocalSearchParams<{ place?: PlaceKind }>();
  const t = useT();
  const { p } = useTheme();
  const mode = useSettings((s) => s.mode);
  const [filter, setFilter] = useState<PlaceKind | null>(place ?? null);
  const term = filter && filter in SEARCH_TERM ? SEARCH_TERM[filter as keyof typeof SEARCH_TERM] : null;

  const searchInMaps = () => {
    if (!term) return;
    void (async () => {
      try {
        const fix = await lastKnownFix();
        const url = searchUrl(term, fix ? { lat: fix.lat, lon: fix.lon } : undefined);
        await Linking.openURL(url);
      } catch {
        // silent no-op
      }
    })();
  };

  return (
    <Screen title={mode === 'kid' ? t('kidSafeSpot') : t('mapTitle')}>
      {term ? (
        <Press accessibilityRole="button" onPress={searchInMaps} style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: p.border, backgroundColor: p.card, marginBottom: 10 }}>
          <Icon name="navigate" size={14} color={p.text} />
          <Txt size={12.5} weight="600">
            Search in Google Maps · गूगल मैप्स में खोजें
          </Txt>
        </Press>
      ) : null}
      <OfflineMap initialPlace={place} onFilterChange={setFilter} />
    </Screen>
  );
}
