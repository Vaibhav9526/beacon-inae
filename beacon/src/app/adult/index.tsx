import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { AlertCard } from '../../components/AlertCard';
import { DayStrip, dateLine } from '../../components/DayStrip';
import { HeroCard, PlanGrid } from '../../components/HeroCard';
import { Icon } from '../../components/Icon';
import { MicButton } from '../../components/MicButton';
import { PhaseChip } from '../../components/PhaseChip';
import { PixelAvatar, cast } from '../../components/PixelAvatar';
import { usePhaseHome } from '../../components/phaseHome';
import { Screen } from '../../components/Screen';
import { SkeletonList } from '../../components/Skeleton';
import { SosPanel } from '../../components/SosPanel';
import { StatusPill } from '../../components/Status';
import { Appear, Btn, Card, Press, Row, SectionTitle, Txt, useTheme } from '../../components/ui';
import { useLang, useT } from '../../i18n';
import { useAlerts } from '../../services/alerts';
import { useMesh } from '../../services/mesh';
import { startWake, stopWake, useVoice, voiceSupported } from '../../services/voice';
import { handleVoiceCommand } from '../../services/voiceCommands';
import { useSettings } from '../../state/settings';

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
  // the banner only for a serious alert; it is then left out of the list below so it never shows twice
  const top = items[0];
  const banner = top && (top.severity === 'warning' || top.severity === 'severe') ? top : undefined;
  const listed = items.filter((a) => a.id !== banner?.id);

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

  const { phase, hero, plan, sosFirst, showWeek } = usePhaseHome();

  return (
    <Screen back={false} bottomPad={24}>
      <Appear>
        <Row style={{ justifyContent: 'space-between', paddingTop: 4 }}>
          <Row style={{ gap: 12, flex: 1 }}>
            <PixelAvatar spec={cast('you')} size={44} bg={p.tint.lilac.bg} animated />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt size={20} weight="700" numberOfLines={1}>
                {lang === 'hi' ? 'नमस्ते' : 'Hello'}, {name || 'Beacon'}
              </Txt>
              <Txt size={12} color={p.muted}>
                {dateLine()}
              </Txt>
            </View>
          </Row>
          <MicButton onText={(x) => void run(x)} size={40} filled />
        </Row>
      </Appear>

      <Appear index={1}>
        <Row style={{ gap: 8, flexWrap: 'wrap' }}>
          <StatusPill />
          <PhaseChip />
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

      {banner && phase !== 'alert' ? (
        <Appear index={1}>
          <AlertCard a={banner} compact />
        </Appear>
      ) : null}

      {sosFirst ? (
        <Appear index={2}>
          <SosPanel variant="adult" />
        </Appear>
      ) : null}

      <Appear index={sosFirst ? 3 : 2}>
        <HeroCard {...hero} />
      </Appear>

      {sosFirst ? null : (
        <Appear index={3}>
          <SosPanel variant="adult" />
        </Appear>
      )}

      {showWeek ? <DayStrip /> : null}

      <SectionTitle>Your Plan</SectionTitle>
      <PlanGrid items={plan} />

      <SectionTitle right={<Btn size="sm" kind="ghost" icon="refresh" label="" onPress={() => void refresh()} disabled={syncing} />}>{t('alertsNearYou')}</SectionTitle>
      {listed.length === 0 && syncing && items.length === 0 ? (
        <SkeletonList n={2} />
      ) : listed.length === 0 ? (
        <Card>
          <Txt size={13} color={p.muted}>
            {t('noAlerts')}
          </Txt>
        </Card>
      ) : (
        listed.slice(0, 3).map((a, i) => (
          <Appear key={a.id} index={i}>
            <AlertCard a={a} compact />
          </Appear>
        ))
      )}
      {listed.length > 3 ? <Btn kind="secondary" size="sm" label={`${t('tabAlerts')} (${listed.length})`} onPress={() => router.push('/adult/news' as never)} /> : null}

      <Press onPress={() => router.push('/adult/community' as never)}>
        <Card style={{ padding: 12 }}>
          <Row style={{ gap: 12 }}>
            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: p.tint.blue.bg, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="bluetooth" size={17} color={p.tint.blue.ink} />
            </View>
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
