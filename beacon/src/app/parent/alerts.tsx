import React, { useEffect } from 'react';
import { AlertCard } from '../../components/AlertCard';
import { Screen } from '../../components/Screen';
import { Appear, Btn, Card, Txt, useTheme } from '../../components/ui';
import { useT } from '../../i18n';
import { useAlerts } from '../../services/alerts';

export default function ParentAlerts() {
  const { p } = useTheme();
  const t = useT();
  const items = useAlerts((s) => s.items);
  const refresh = useAlerts((s) => s.refresh);
  const syncing = useAlerts((s) => s.syncing);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <Screen back={false} title={t('alertsNearYou')} right={<Btn size="sm" kind="ghost" icon="refresh" label="" onPress={() => void refresh()} disabled={syncing} />}>
      {items.length === 0 ? (
        <Card>
          <Txt size={13} color={p.muted}>
            {t('noAlerts')}
          </Txt>
        </Card>
      ) : (
        items.map((a, i) => (
          <Appear key={a.id} index={i}>
            <AlertCard a={a} />
          </Appear>
        ))
      )}
    </Screen>
  );
}
