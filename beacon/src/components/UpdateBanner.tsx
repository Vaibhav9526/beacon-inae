import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { useLocal } from '../i18n';
import { compareVersions, currentVersion } from '../services/updates';
import { useUpdateCheck, useUpdates } from '../state/updates';
import { Btn, Card, Row, Txt } from './ui';

/** Slim card shown when a newer APK exists and this version was not dismissed. Mount it on Home. */
export function UpdateBanner() {
  const local = useLocal();
  const { latest } = useUpdateCheck();
  const dismissedVersion = useUpdates((s) => s.dismissedVersion);
  const dismiss = useUpdates((s) => s.dismiss);
  const current = useMemo(() => currentVersion(), []);

  if (!latest || latest.version === dismissedVersion || compareVersions(latest.version, current) <= 0) return null;

  const mb = (latest.sizeBytes / 1048576).toFixed(1);

  return (
    <Card tint="blue" style={{ marginHorizontal: 16, marginTop: 8, gap: 10 }} accessibilityRole="summary">
      <Txt size={14} weight="600">
        {local([`Update available: version ${latest.version} (${mb} MB)`, `अपडेट उपलब्ध: वर्ज़न ${latest.version} (${mb} MB)`] as const)}
      </Txt>
      <Row style={{ gap: 8, flexWrap: 'wrap' }}>
        <Btn size="sm" label={local(['See what is new', 'क्या नया है देखें'] as const)} onPress={() => router.push('/update' as never)} />
        <Btn size="sm" kind="ghost" label={local(['Later', 'बाद में'] as const)} onPress={() => dismiss(latest.version)} />
      </Row>
    </Card>
  );
}
