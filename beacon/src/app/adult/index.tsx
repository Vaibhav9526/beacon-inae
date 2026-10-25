import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { AlertCard } from '../../components/AlertCard';
import { Icon, type IconName } from '../../components/Icon';
import { MicButton } from '../../components/MicButton';
import { PixelAvatar, cast } from '../../components/PixelAvatar';
import { Screen } from '../../components/Screen';
import { SosPanel } from '../../components/SosPanel';
import { StatusPill } from '../../components/Status';
import { Appear, Btn, Card, IconTile, Press, Row, SectionTitle, type TintName, Txt, useTheme } from '../../components/ui';
import { useLang, useT } from '../../i18n';
import { useAlerts } from '../../services/alerts';
import { useMesh } from '../../services/mesh';
import { call112, sendSafeNow } from '../../services/sos';
import { startWake, stopWake, useVoice, voiceSupported } from '../../services/voice';
import { handleVoiceCommand } from '../../services/voiceCommands';
import { useSettings } from '../../state/settings';

function Quick({ icon, label, onPress, tint, index }: { icon: IconName; label: string; onPress: () => void; tint: TintName; index: number }) {
  return (
    <Appear index={index} style={{ width: '48.5%' }}>
      <Press accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
        <Card style={{ padding: 12, gap: 10 }}>
          <IconTile name={icon} tint={tint} size={32} />
          <Txt size={13} weight="500">
            {label}
          </Txt>
        </Card>
      </Press>
    </Appear>
  );
}

export default function AdultHome() {
  const { p } = useTheme();
  const t = useT();
  const lang = useLang();
  const name = useSettings((s) => s.nickname);
  const voiceControl = useSettings((s) => s.voiceControl);
  const items = useAlerts((s) => s.items);
  const refresh = useAlerts((s) => s.refresh);
  const syncing = useAlerts((s) => s.syncing);
  const neighbours = useMesh((s) => s.neighbours);
  const channels = useMesh((s) => s.channels);
  const sosHeard = useMesh((s) => s.sos);
  const partial = useVoice((s) => s.partial);
  const [said, setSaid] = useState('');
  const top = items[0];

  const run = useCallback(async (text: string) => {
    setSaid(`“${text}”`);
    const out = await handleVoiceCommand(text);
    setSaid(`“${text}”  →  ${out.said}`);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      if (voiceControl && voiceSupported()) {
        void startWake(lang, (cmd) => void run(cmd), () => setSaid(lang === 'hi' ? 'हाँ, बोलिए…' : 'Yes? Listening…'));
        return () => stopWake();
      }
    }, [voiceControl, lang, refresh, run]),
  );
  useEffect(() => () => stopWake(), []);

  return (
    <Screen back={false} bottomPad={24}>
      <Appear>
        <Row style={{ justifyContent: 'space-between', paddingTop: 4 }}>
          <Row style={{ gap: 12, flex: 1 }}>
            <PixelAvatar spec={cast('you')} size={42} bg={p.tint.lilac.bg} animated />
            <View style={{ flex: 1, gap: 4 }}>
              <Txt size={20} weight="600" numberOfLines={1}>
                {lang === 'hi' ? 'नमस्ते' : 'Hello'}, {name || 'Beacon'}
              </Txt>
              <StatusPill />
            </View>
          </Row>
          <MicButton onText={(x) => void run(x)} size={40} filled />
        </Row>
      </Appear>

      {said || partial ? (
        <Appear>
          <Card style={{ padding: 10 }}>
            <Txt size={12.5} color={p.muted}>
              {said || partial}
            </Txt>
          </Card>
        </Appear>
      ) : voiceControl && voiceSupported() ? (
        <Row style={{ gap: 6 }}>
          <Icon name="mic" size={12} color={p.muted} />
          <Txt size={11.5} color={p.muted}>
            {t('heyBeacon')}
          </Txt>
        </Row>
      ) : null}

      {top ? (
        <Appear index={1}>
          <AlertCard a={top} compact />
        </Appear>
      ) : null}

      <Appear index={2}>
        <Card style={{ alignItems: 'center', paddingVertical: 16 }}>
          <SosPanel variant="adult" />
        </Card>
      </Appear>

      <Row style={{ flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
        <Quick index={3} icon="tent" tint="green" label={`${t('nearest')} ${t('shelter')}`} onPress={() => router.push({ pathname: '/map', params: { place: 'shelter' } } as never)} />
        <Quick index={4} icon="hospital" tint="pink" label={`${t('nearest')} ${t('hospital')}`} onPress={() => router.push({ pathname: '/map', params: { place: 'hospital' } } as never)} />
        <Quick index={5} icon="check" tint="blue" label={t('iAmSafe')} onPress={() => void sendSafeNow()} />
        <Quick index={6} icon="phone" tint="peach" label={t('call112')} onPress={() => void call112()} />
        <Quick index={7} icon="camera" tint="lilac" label={t('postReport')} onPress={() => router.push('/report/new' as never)} />
        <Quick index={8} icon="bot" tint="yellow" label={lang === 'hi' ? 'डेस्कटॉप हब' : 'Desktop hub'} onPress={() => router.push('/hub' as never)} />
      </Row>

      <SectionTitle right={<Btn size="sm" kind="ghost" icon="refresh" label="" onPress={() => void refresh()} disabled={syncing} />}>{t('alertsNearYou')}</SectionTitle>
      {items.length === 0 ? (
        <Card>
          <Txt size={13} color={p.muted}>
            {t('noAlerts')}
          </Txt>
        </Card>
      ) : (
        items.slice(0, 3).map((a, i) => (
          <Appear key={a.id} index={i}>
            <AlertCard a={a} compact />
          </Appear>
        ))
      )}
      {items.length > 3 ? <Btn kind="secondary" size="sm" label={`${t('tabAlerts')} (${items.length})`} onPress={() => router.push('/adult/news' as never)} /> : null}

      <Press onPress={() => router.push('/adult/community' as never)}>
        <Card style={{ padding: 12 }}>
          <Row style={{ gap: 12 }}>
            <IconTile name="bluetooth" tint="blue" size={34} />
            <View style={{ flex: 1 }}>
              <Txt size={14} weight="500">
                {t('communityTitle')}
              </Txt>
              <Txt size={12} color={p.muted}>
                {neighbours} {t('nearbyPhones')} · {channels.length} {t('channel').toLowerCase()}
                {sosHeard.length ? ` · SOS ${sosHeard.length}` : ''}
              </Txt>
            </View>
            <Icon name="next" size={16} color={p.muted} />
          </Row>
        </Card>
      </Press>
    </Screen>
  );
}
