import React from 'react';
import { Screen } from '../components/Screen';
import { SettingsView } from '../components/SettingsView';
import { useT } from '../i18n';

export default function SettingsRoute() {
  const t = useT();
  return (
    <Screen title={t('settings')}>
      <SettingsView />
    </Screen>
  );
}
