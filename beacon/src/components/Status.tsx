import { useNetworkState } from 'expo-network';
import React from 'react';
import { View } from 'react-native';
import { useT } from '../i18n';
import { useMesh } from '../services/mesh';
import { radius } from '../theme';
import { Icon } from './Icon';
import { Txt, useTheme } from './ui';

export function useOnline(): boolean {
  const s = useNetworkState();
  return s.isInternetReachable ?? s.isConnected ?? true;
}

/** One glance: do I have internet, and how many phones can I reach over Bluetooth? */
export function StatusPill() {
  const { p } = useTheme();
  const t = useT();
  const online = useOnline();
  const neighbours = useMesh((s) => s.neighbours);
  const radio = useMesh((s) => s.radioAvailable);
  const status = useMesh((s) => s.status);
  const meshOn = radio && status === 'running';
  const label = online ? t('online') : meshOn ? t('offlineMesh') : t('offlineNoMesh');
  const color = online ? p.ok : meshOn ? p.warn : p.danger;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: p.card, borderWidth: 1, borderColor: p.border, paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.pill, alignSelf: 'flex-start' }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      <Txt size={11.5} weight="500">
        {label}
      </Txt>
      {radio ? (
        <>
          <Icon name="bluetooth" size={11} color={p.muted} />
          <Txt size={11.5} color={p.muted}>
            {neighbours}
          </Txt>
        </>
      ) : null}
    </View>
  );
}
