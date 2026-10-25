import React from 'react';
import { Screen } from '../../components/Screen';
import { SettingsView } from '../../components/SettingsView';
import { useT } from '../../i18n';

export default function ParentSettings() {
  const t = useT();
  return (
    <Screen back={false} title={t('settings')}>
      <SettingsView />
    </Screen>
  );
}
