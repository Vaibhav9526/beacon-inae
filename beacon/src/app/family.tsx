import React, { useCallback, useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { Appear, Badge, Btn, Card, Row, Txt, useTheme } from '../components/ui';
import { relativeTime, useLang, useT } from '../i18n';
import { cloudConfigured } from '../services/cloud';
import { type FamilyView, fetchFamily } from '../services/gateway';
import { useMesh } from '../services/mesh';
import { sendSafeNow } from '../services/sos';
import { useSettings } from '../state/settings';
import { radius } from '../theme';

/** Family reunification: tell people you are safe, and look up relatives by their family code, over the internet or the mesh. */
export default function Family() {
  const { p } = useTheme();
  const t = useT();
  const lang = useLang();
  const code = useSettings((s) => s.familyCode);
  const meshSafe = useMesh((s) => s.safe);
  const [lookup, setLookup] = useState('');
  const [view, setView] = useState<FamilyView | null>(null);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);

  const load = useCallback(async () => {
    const c = lookup.trim().toUpperCase();
    if (!c) return;
    setErr('');
    try {
      setView(await fetchFamily(c));
    } catch (e) {
      setView(null);
      setErr(cloudConfigured() ? String((e as Error).message) : t('needInternet'));
    }
  }, [lookup, t]);

  useEffect(() => {
    setView(null);
  }, [lookup]);

  const fromMesh = lookup.trim() ? meshSafe.filter((m) => m.family === lookup.trim().toUpperCase()) : [];

  return (
    <Screen title={t('tabKids')}>
      <Appear>
        <Card style={{ gap: 6 }}>
          <Txt size={11} weight="600" color={p.muted} style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
            {t('yourCode')}
          </Txt>
          <Txt size={28} weight="600" style={{ letterSpacing: 4 }}>
            {code}
          </Txt>
          <Txt size={12} color={p.muted}>
            {t('shareCodeHint')}
          </Txt>
          <View style={{ marginTop: 6, alignSelf: 'flex-start' }}>
            <Btn
              label={sent ? t('iAmSafeSent') : t('iAmSafe')}
              icon="check"
              size="sm"
              onPress={async () => {
                await sendSafeNow();
                setSent(true);
              }}
            />
          </View>
        </Card>
      </Appear>

      <Card style={{ gap: 10 }}>
        <Txt size={14} weight="600">
          {t('enterCode')}
        </Txt>
        <Row>
          <TextInput value={lookup} onChangeText={(v) => setLookup(v.toUpperCase())} autoCapitalize="characters" maxLength={12} placeholder="ABCD2345" placeholderTextColor={p.muted} style={{ flex: 1, height: 42, backgroundColor: p.cardAlt, borderRadius: radius.pill, paddingHorizontal: 16, color: p.text, fontSize: 15, letterSpacing: 2, fontFamily: 'Lexend_400Regular', paddingVertical: 0 }} />
          <Btn label="" icon="search" onPress={() => void load()} disabled={lookup.trim().length < 6} />
        </Row>
        {err ? <Txt size={12} color={p.danger}>{err}</Txt> : null}
      </Card>

      {fromMesh.map((m, i) => (
        <Appear key={'m' + i}>
          <Card style={{ gap: 2, padding: 12 }}>
            <Row style={{ gap: 8 }}>
              <Icon name="check" size={14} color={p.ok} />
              <Txt size={14} weight="500">
                {m.name} · {t('iAmSafe')}
              </Txt>
            </Row>
            <Txt size={11.5} color={p.muted}>
              mesh · {relativeTime(m.timestamp, lang)}
            </Txt>
          </Card>
        </Appear>
      ))}
      {view?.members.map((m, i) => (
        <Appear key={i}>
          <Card style={{ gap: 4, padding: 12 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt size={15} weight="600">
                {m.name}
              </Txt>
              {m.zone ? <Badge soft label={`${t('inZone')} ${m.zone}`} color={p.ok} /> : null}
            </Row>
            <Txt size={11.5} color={p.muted}>
              {m.lat.toFixed(4)}, {m.lon.toFixed(4)} · {t('lastSeen')} {relativeTime(m.ts, lang)}
            </Txt>
          </Card>
        </Appear>
      ))}
      {view?.safe.map((m, i) => (
        <Appear key={'s' + i}>
          <Card style={{ padding: 12 }}>
            <Row style={{ gap: 8 }}>
              <Icon name={m.kind === 'sos' ? 'siren' : 'check'} size={14} color={m.kind === 'sos' ? p.danger : p.ok} />
              <Txt size={13} style={{ flex: 1 }}>
                {m.name} {m.kind === 'sos' ? t('childSos') : t('childSafeAt')} · {relativeTime(m.ts, lang)}
              </Txt>
            </Row>
          </Card>
        </Appear>
      ))}
    </Screen>
  );
}
