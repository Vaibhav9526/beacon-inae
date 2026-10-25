import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Linking, TextInput, View } from 'react-native';
import { distanceKm } from '../../alerts/sources';
import { Icon } from '../../components/Icon';
import { PixelAvatar, SPECIES, buddy } from '../../components/PixelAvatar';
import { Screen } from '../../components/Screen';
import { StatusPill } from '../../components/Status';
import { ZoneMap } from '../../components/ZoneMap';
import { Appear, Badge, Btn, Card, Row, Txt, useTheme } from '../../components/ui';
import { relativeTime, useLang, useT } from '../../i18n';
import { cloudConfigured } from '../../services/cloud';
import { type FamilyView, fetchFamily } from '../../services/gateway';
import { lastKnownFix } from '../../services/location';
import { useMesh } from '../../services/mesh';
import { useSettings } from '../../state/settings';
import { radius } from '../../theme';

export default function ParentHome() {
  const { p } = useTheme();
  const t = useT();
  const lang = useLang();
  const children = useSettings((s) => s.children);
  const set = useSettings((s) => s.set);
  const meshSafe = useMesh((s) => s.safe);
  const meshSos = useMesh((s) => s.sos);
  const [views, setViews] = useState<Record<string, FamilyView>>({});
  const [me, setMe] = useState<{ lat: number; lon: number } | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setMe(await lastKnownFix());
    if (!cloudConfigured()) return;
    const out: Record<string, FamilyView> = {};
    await Promise.all(
      children.map(async (c) => {
        try {
          out[c.code] = await fetchFamily(c.code);
        } catch (e) {
          setErr(String((e as Error).message));
        }
      }),
    );
    setViews((v) => ({ ...v, ...out }));
  }, [children]);

  useFocusEffect(
    useCallback(() => {
      void load();
      const h = setInterval(() => void load(), 15_000);
      return () => clearInterval(h);
    }, [load]),
  );

  const add = () => {
    const c = code.trim().toUpperCase();
    if (c.length < 6 || children.some((x) => x.code === c)) return;
    set({ children: [...children, { code: c, name: name.trim() || 'Child' }] });
    setCode('');
    setName('');
  };

  const input = { backgroundColor: p.cardAlt, borderRadius: radius.md, paddingHorizontal: 14, height: 42, color: p.text, fontSize: 14, fontFamily: 'Lexend_400Regular', paddingVertical: 0 } as const;

  return (
    <Screen back={false} title={t('parentTitle')}>
      <StatusPill />
      {!cloudConfigured() ? <Txt size={12} color={p.muted}>{t('serverNotSet')}</Txt> : null}
      {err ? <Txt size={12} color={p.danger}>{err}</Txt> : null}

      {children.length === 0 ? (
        <Appear>
          <Card style={{ alignItems: 'center', gap: 8, paddingVertical: 22 }}>
            <PixelAvatar spec={buddy('panda')} size={56} bg={p.cardAlt} animated />
            <Txt size={13} color={p.muted}>
              {t('noChildYet')}
            </Txt>
          </Card>
        </Appear>
      ) : null}

      {children.map((c, idx) => {
        const v = views[c.code];
        const m = v?.members[0];
        const last = [...(v?.safe ?? [])].sort((a, b) => b.ts - a.ts)[0];
        const meshEvents = [...meshSafe.filter((x) => x.family === c.code).map((x) => ({ ts: x.timestamp, kind: 'safe' as const, name: x.name })), ...meshSos.map((x) => ({ ts: x.timestamp, kind: 'sos' as const, name: x.name })).filter((x) => x.name === c.name)].sort((a, b) => b.ts - a.ts)[0];
        const sos = (last?.kind === 'sos' && Date.now() - last.ts < 3600_000 ? last : null) ?? (meshEvents?.kind === 'sos' && Date.now() - meshEvents.ts < 3600_000 ? meshEvents : null);
        const dist = me && m ? Math.round(distanceKm(me, m) * 1000) : null;
        return (
          <Appear key={c.code} index={idx}>
            <Card style={{ gap: 10, borderColor: sos ? p.danger : p.border }}>
              {sos ? (
                <Row style={{ backgroundColor: p.danger, borderRadius: radius.md, padding: 9, gap: 8 }}>
                  <Icon name="siren" size={15} color="#fff" />
                  <Txt size={13} weight="600" color="#fff" style={{ flex: 1 }}>
                    {c.name} {t('childSos')} · {relativeTime(sos.ts, lang)}
                  </Txt>
                </Row>
              ) : null}
              <Row style={{ gap: 12 }}>
                <PixelAvatar spec={buddy(SPECIES[idx % SPECIES.length])} size={44} bg={p.tint.blue.bg} animated />
                <View style={{ flex: 1 }}>
                  <Txt size={16} weight="600">
                    {c.name}
                  </Txt>
                  <Txt size={11.5} color={p.muted}>
                    {m ? `${t('lastSeen')} ${relativeTime(m.ts, lang)}${dist !== null ? ` · ${dist < 1000 ? dist + ' m' : (dist / 1000).toFixed(1) + ' km'}` : ''}` : '…'}
                  </Txt>
                </View>
                {m ? (m.zone ? <Badge soft label={`${t('inZone')} ${m.zone}`} color={p.ok} /> : v?.zones.length ? <Badge soft label={t('outOfZones')} color={p.warn} /> : null) : null}
              </Row>
              {m ? <ZoneMap child={m} zones={v?.zones ?? []} me={me} /> : null}
              {last && last.kind === 'safe' ? (
                <Row style={{ gap: 6 }}>
                  <Icon name="check" size={13} color={p.ok} />
                  <Txt size={12.5} color={p.ok}>
                    {c.name} {t('childSafeAt')} · {relativeTime(last.ts, lang)}
                  </Txt>
                </Row>
              ) : meshEvents?.kind === 'safe' ? (
                <Row style={{ gap: 6 }}>
                  <Icon name="bluetooth" size={13} color={p.ok} />
                  <Txt size={12.5} color={p.ok}>
                    {c.name} {t('childSafeAt')} · {relativeTime(meshEvents.ts, lang)}
                  </Txt>
                </Row>
              ) : null}
              <Row style={{ gap: 6 }}>
                {m ? <Btn size="sm" kind="secondary" icon="map" label="Maps" onPress={() => void Linking.openURL(`geo:${m.lat},${m.lon}?q=${m.lat},${m.lon}(${encodeURIComponent(c.name)})`)} /> : null}
                <Btn size="sm" kind="ghost" label={t('remove')} onPress={() => set({ children: children.filter((x) => x.code !== c.code) })} />
              </Row>
            </Card>
          </Appear>
        );
      })}

      <Card style={{ gap: 8 }}>
        <Txt size={14} weight="600">
          {t('pairChild')}
        </Txt>
        <TextInput value={name} onChangeText={setName} placeholder={t('yourName')} placeholderTextColor={p.muted} style={input} />
        <TextInput value={code} onChangeText={(v) => setCode(v.toUpperCase())} autoCapitalize="characters" maxLength={12} placeholder={t('enterCode')} placeholderTextColor={p.muted} style={[input, { letterSpacing: 2 }]} />
        <Btn label={t('pairChild')} onPress={add} disabled={code.trim().length < 6} />
      </Card>
    </Screen>
  );
}
