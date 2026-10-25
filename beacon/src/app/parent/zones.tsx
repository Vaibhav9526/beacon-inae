import React, { useCallback, useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Shield } from '../../components/Deco';
import { Icon } from '../../components/Icon';
import { Screen } from '../../components/Screen';
import { ZoneMap } from '../../components/ZoneMap';
import { Appear, Btn, Card, Chip, Row, Txt, useTheme } from '../../components/ui';
import { useT } from '../../i18n';
import { cloudConfigured } from '../../services/cloud';
import { pushZones } from '../../services/gateway';
import { getFix } from '../../services/location';
import { useSettings } from '../../state/settings';
import { radius } from '../../theme';

export default function Zones() {
  const { p } = useTheme();
  const t = useT();
  const zones = useSettings((s) => s.zones);
  const children = useSettings((s) => s.children);
  const set = useSettings((s) => s.set);
  const [name, setName] = useState('');
  const [rad, setRad] = useState(200);
  const [me, setMe] = useState<{ lat: number; lon: number } | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    void getFix({ maxWaitMs: 4000 }).then(setMe);
  }, []);

  // Zones live on the server per family code so the child's position can be matched against them.
  const sync = useCallback(
    async (next: typeof zones) => {
      if (!cloudConfigured()) return;
      try {
        await Promise.all(children.map((c) => pushZones(c.code, next)));
        setStatus('synced');
      } catch (e) {
        setStatus(String((e as Error).message));
      }
    },
    [children],
  );

  const add = async () => {
    const here = await getFix({ maxWaitMs: 5000 });
    if (!here || !name.trim()) return;
    const next = [...zones, { id: Math.random().toString(36).slice(2, 8), name: name.trim(), lat: here.lat, lon: here.lon, radius: rad }];
    set({ zones: next });
    setName('');
    void sync(next);
  };

  const remove = (id: string) => {
    const next = zones.filter((z) => z.id !== id);
    set({ zones: next });
    void sync(next);
  };

  return (
    <Screen back={false} title={t('safeZones')}>
      <Appear>
        <Card tint="green" style={{ overflow: 'hidden', minHeight: 130, justifyContent: 'flex-end', padding: 20 }}>
          <Txt size={28} weight="700" color={p.tint.green.ink} style={{ paddingRight: 92 }}>
            {t('safeZones')}
          </Txt>
          <View pointerEvents="none" style={{ position: 'absolute', right: -12, top: -14, transform: [{ rotate: '12deg' }] }}>
            <Shield size={92} />
          </View>
        </Card>
      </Appear>
      <ZoneMap zones={zones} me={me} />
      {zones.map((z, i) => (
        <Appear key={z.id} index={i}>
          <Card tint="green" style={{ padding: 12, borderRadius: 24 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Row style={{ gap: 10 }}>
                <Icon name="pin" size={15} color={p.tint.green.ink} />
                <Txt size={14.5} weight="600" color={p.tint.green.ink}>
                  {z.name}
                </Txt>
                <Txt size={12} color={p.tint.green.ink}>
                  {z.radius} m
                </Txt>
              </Row>
              <Btn size="sm" kind="ghost" icon="close" label="" onPress={() => remove(z.id)} />
            </Row>
          </Card>
        </Appear>
      ))}
      <Card style={{ gap: 10 }}>
        <TextInput value={name} onChangeText={setName} placeholder={t('zoneName')} placeholderTextColor={p.muted} style={{ backgroundColor: p.cardAlt, borderRadius: radius.md, paddingHorizontal: 14, height: 42, color: p.text, fontSize: 14, fontFamily: 'Poppins_400Regular', paddingVertical: 0 }} />
        <Row style={{ gap: 6 }}>
          {[100, 200, 500, 1000].map((r) => (
            <Chip key={r} label={`${r} m`} active={rad === r} onPress={() => setRad(r)} />
          ))}
        </Row>
        <Btn label={t('addZone')} icon="pin" onPress={() => void add()} disabled={!name.trim()} />
        {status ? <Txt size={12} color={p.muted}>{status}</Txt> : null}
        {!cloudConfigured() ? <Txt size={12} color={p.muted}>{t('serverNotSet')}</Txt> : null}
      </Card>
    </Screen>
  );
}
