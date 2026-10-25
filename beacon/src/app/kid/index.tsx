import { router } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '../../components/Icon';
import { Stars } from '../../components/Stars';
import { PixelAvatar, SPECIES, buddy, cast } from '../../components/PixelAvatar';
import { SosPanel } from '../../components/SosPanel';
import { StatusPill } from '../../components/Status';
import { Appear, Btn, Card, IconTile, Press, Row, SectionTitle, type TintName, Txt, useTheme } from '../../components/ui';
import { useLocal, useT } from '../../i18n';
import { DRILLS } from '../../kb/kidDrills';
import { sendSafeNow } from '../../services/sos';
import { useSettings } from '../../state/settings';

const DRILL_ICON: Record<string, IconName> = { earthquake: 'mountain', fire: 'fire', flood: 'flood', lost: 'compass' };
const DRILL_TINT: Record<string, TintName> = { earthquake: 'peach', fire: 'pink', flood: 'blue', lost: 'lilac' };

export default function KidHome() {
  const t = useT();
  const L = useLocal();
  const { p } = useTheme();
  const insets = useSafeAreaInsets();
  const name = useSettings((s) => s.kidName);
  const avatar = useSettings((s) => s.kidAvatar);
  const stars = useSettings((s) => s.stars);
  const total = Object.values(stars).reduce((a, b) => a + b, 0);
  const [told, setTold] = useState(false);

  const quick: { label: string; icon: IconName; tint: TintName; go: string }[] = [
    { label: t('kidGames'), icon: 'play', tint: 'lilac', go: '/kid/play' },
    { label: t('kidSafeMap'), icon: 'map', tint: 'green', go: '/map' },
    { label: t('kidAskDidi'), icon: 'chat', tint: 'yellow', go: '/kid/didi' },
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.bg }} contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 88 + insets.bottom, gap: 14 }} showsVerticalScrollIndicator={false}>
      <Appear>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ gap: 8, flex: 1 }}>
            <Txt size={24} weight="600">
              {lang(name, t('kidHello'))}
            </Txt>
            <Txt size={13} color={p.muted}>
              {t('kidReady')}
            </Txt>
            <StatusPill />
          </View>
          <PixelAvatar spec={buddy(SPECIES[avatar % SPECIES.length])} size={56} bg={p.tint.yellow.bg} animated />
        </Row>
      </Appear>

      <Appear index={1}>
        <Row style={{ gap: 10 }}>
          {quick.map((q) => (
            <Press key={q.label} accessibilityRole="button" accessibilityLabel={q.label} onPress={() => router.push(q.go as never)} style={{ flex: 1 }}>
              <Card tint={q.tint} style={{ alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 6 }}>
                <Icon name={q.icon} size={22} color={p.tint[q.tint].ink} />
                <Txt size={12} weight="600" color={p.dark ? p.text : '#17171B'} style={{ textAlign: 'center' }}>
                  {q.label}
                </Txt>
              </Card>
            </Press>
          ))}
        </Row>
      </Appear>

      <SectionTitle right={<Row style={{ gap: 4 }}><Icon name="star" size={12} color="#E9B44C" fill="#E9B44C" /><Txt size={12} color={p.muted}>{total}</Txt></Row>}>{t('kidTodaysMission')}</SectionTitle>
      {DRILLS.map((d, i) => (
        <Appear key={d.id} index={i + 2}>
          <Press accessibilityRole="button" onPress={() => router.push(`/drill/${d.id}` as never)}>
            <Card style={{ padding: 12 }}>
              <Row style={{ gap: 12 }}>
                <IconTile name={DRILL_ICON[d.id] ?? 'shield'} tint={DRILL_TINT[d.id] ?? 'lilac'} size={38} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Txt size={14.5} weight="600">
                    {L(d.title)}
                  </Txt>
                  <Stars n={stars[d.id] ?? 0} />
                </View>
                <Icon name="next" size={16} color={p.muted} />
              </Row>
            </Card>
          </Press>
        </Appear>
      ))}

      <Appear index={6}>
        <Press onPress={() => router.push('/kid/didi' as never)}>
          <Card tint="yellow" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
            <PixelAvatar spec={cast('didi')} size={44} bg="rgba(255,255,255,0.6)" animated />
            <View style={{ flex: 1 }}>
              <Txt size={14.5} weight="600" color={p.dark ? p.text : '#17171B'}>
                {t('kidAskDidi')}
              </Txt>
              <Txt size={12} color={p.dark ? p.muted : '#5A4A20'}>
                {t('askMe')}
              </Txt>
            </View>
            <Icon name="next" size={16} color={p.dark ? p.muted : '#5A4A20'} />
          </Card>
        </Press>
      </Appear>

      <Appear index={7}>
        <Card style={{ alignItems: 'center', paddingVertical: 18 }}>
          <SosPanel variant="kid" />
        </Card>
      </Appear>

      <Appear index={8}>
        <View style={{ gap: 8 }}>
          <Btn
            kind="secondary"
            icon="check"
            label={told ? t('iAmSafeSent') : t('kidTellParents')}
            onPress={async () => {
              await sendSafeNow();
              setTold(true);
            }}
          />
          <Row style={{ justifyContent: 'center', gap: 6 }}>
            <Icon name="lock" size={11} color={p.muted} />
            <Txt size={11} color={p.muted}>
              {t('kidNoStrangers')}
            </Txt>
          </Row>
        </View>
      </Appear>
    </ScrollView>
  );
}

// "Hi, Explorer!" in either language with the child's name in it
function lang(name: string, hello: string) {
  return hello.replace('Explorer', name || 'Explorer').replace('खोजी', name || 'खोजी');
}
