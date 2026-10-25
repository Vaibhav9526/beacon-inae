import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { dateLine } from '../../components/DayStrip';
import { Icon } from '../../components/Icon';
import { PhaseChip } from '../../components/PhaseChip';
import { PixelAvatar, cast } from '../../components/PixelAvatar';
import { usePhaseHome } from '../../components/phaseHome';
import { Screen } from '../../components/Screen';
import { SosPanel } from '../../components/SosPanel';
import { StatusPill } from '../../components/Status';
import { TrendingList } from '../../components/TrendingStrip';
import { WeatherCard } from '../../components/WeatherCard';
import { Appear, Press, Row, Txt, useTheme } from '../../components/ui';
import { fonts } from '../../theme';
import { useLang, useT } from '../../i18n';
import { useAlerts } from '../../services/alerts';
import { startWake, stopWake, useVoice, voiceSupported } from '../../services/voice';
import { handleVoiceCommand } from '../../services/voiceCommands';
import { useSettings } from '../../state/settings';

export default function AdultHome() {
  const { p } = useTheme();
  const t = useT();
  const lang = useLang();
  const name = useSettings((s) => s.nickname);
  const voiceControl = useSettings((s) => s.voiceControl);
  const refresh = useAlerts((s) => s.refresh);
  const partial = useVoice((s) => s.partial);
  const [said, setSaid] = useState('');

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

  const { phase, banner, quick, safe } = usePhaseHome();
  const bannerInk = p.tint[banner.tint].ink;

  return (
    <Screen back={false} bottomPad={24}>
      <Appear>
        <Row style={{ justifyContent: 'space-between', paddingTop: 4 }}>
          <Row style={{ gap: 12, flex: 1 }}>
            <PixelAvatar spec={cast('you')} size={36} bg={p.tint.lilac.bg} animated />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 18, color: p.text }}>
                {lang === 'hi' ? 'नमस्ते' : 'Hello'}, {name || 'Beacon'}
              </Text>
              <Text style={{ fontFamily: fonts.regular, fontSize: 12, color: p.muted }}>{dateLine()}</Text>
            </View>
          </Row>
          <Press accessibilityRole="button" accessibilityLabel={lang === 'hi' ? 'और' : 'More'} onPress={() => router.push('/adult/more' as never)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: p.cardAlt, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="more" size={20} />
          </Press>
        </Row>
        <Row style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <StatusPill />
          <PhaseChip />
        </Row>
      </Appear>

      {said || partial ? (
        <Txt size={12.5} color={p.muted}>
          {said || partial}
        </Txt>
      ) : voiceControl && voiceSupported() ? (
        <Row style={{ gap: 6 }}>
          <Icon name="mic" size={12} color={p.muted} />
          <Txt size={11.5} color={p.muted}>
            {t('heyBeacon')}
          </Txt>
        </Row>
      ) : null}

      <Appear index={1}>
        <Press
          accessibilityRole={banner.onPress ? 'button' : undefined}
          accessibilityLabel={banner.title}
          onPress={banner.onPress}
          disabled={!banner.onPress}
          style={{ borderRadius: 20, padding: 16, gap: 10, backgroundColor: p.tint[banner.tint].bg }}>
          <Txt size={16} weight="700" color={bannerInk}>
            {banner.title}
          </Txt>
          {banner.actionLabel ? (
            <Txt size={14} weight="600" color={bannerInk} style={{ textDecorationLine: 'underline' }}>
              {banner.actionLabel}
            </Txt>
          ) : null}
        </Press>
      </Appear>

      <Appear index={2}>
        <WeatherCard />
      </Appear>

      <Appear index={3}>
        <SosPanel variant="adult" />
      </Appear>

      <Appear index={4}>
        <View style={{ gap: 12 }}>
          <Row style={{ justifyContent: phase === 'recover' ? 'flex-start' : 'space-between', gap: phase === 'recover' ? 20 : 0 }}>
            {quick.map((q) => (
              <Press key={q.id} accessibilityRole="button" accessibilityLabel={q.label} onPress={q.onPress} style={{ width: 76, alignItems: 'center', gap: 6 }}>
                <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: p.cardAlt, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={q.icon} size={22} color={p.text} />
                </View>
                <Txt size={12} weight="500" numberOfLines={1} style={{ textAlign: 'center' }}>
                  {q.label}
                </Txt>
              </Press>
            ))}
          </Row>
          <Press accessibilityRole="button" accessibilityLabel={safe.label} onPress={safe.onPress} style={{ alignSelf: 'center', paddingVertical: 4 }}>
            <Txt size={13.5} weight="600" style={{ textDecorationLine: 'underline' }}>
              {safe.label}
            </Txt>
          </Press>
        </View>
      </Appear>

      <Appear index={5}>
        <TrendingList />
      </Appear>
    </Screen>
  );
}
