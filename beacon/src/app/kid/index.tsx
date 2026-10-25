import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { Bell, Bolt, Flower, Shield, Wave } from '../../components/Deco';
import { DayStrip, dateLine } from '../../components/DayStrip';
import { HeroCard, PlanGrid } from '../../components/HeroCard';
import { Icon, type IconName } from '../../components/Icon';
import { PixelAvatar, SPECIES, buddy, cast } from '../../components/PixelAvatar';
import { Screen } from '../../components/Screen';
import { SosPanel } from '../../components/SosPanel';
import { StatusPill } from '../../components/Status';
import { Appear, Btn, Card, Press, Row, SectionTitle, type TintName, Txt, useTheme } from '../../components/ui';
import { useLocal, useT } from '../../i18n';
import { DRILLS } from '../../kb/kidDrills';
import { sendSafeNow } from '../../services/sos';
import { useSettings } from '../../state/settings';

const DRILL_ICON: Record<string, IconName> = { earthquake: 'mountain', fire: 'fire', flood: 'flood', lost: 'compass' };
const DRILL_TINT: Record<string, TintName> = { earthquake: 'peach', fire: 'pink', flood: 'blue', lost: 'lilac' };
const DRILL_DECO: Record<string, React.ReactNode> = {
  earthquake: <Bell size={68} />,
  fire: <Bolt size={68} />,
  flood: <Wave size={68} />,
  lost: <Shield size={68} />,
};

export default function KidHome() {
  const t = useT();
  const L = useLocal();
  const { p } = useTheme();
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

  const plan = DRILLS.map((d) => ({
    id: d.id,
    label: 'Drill',
    title: L(d.title),
    meta: `${stars[d.id] ?? 0} of 3 stars`,
    tint: DRILL_TINT[d.id] ?? 'lilac',
    deco: DRILL_DECO[d.id] ?? <Shield size={68} />,
    onPress: () => router.push(`/drill/${d.id}` as never),
  }));

  return (
    <Screen back={false}>
      <Appear>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt size={20} weight="700">
              {lang(name, t('kidHello'))}
            </Txt>
            <Txt size={12} color={p.muted}>
              {dateLine()}
            </Txt>
            <View style={{ marginTop: 6, alignSelf: 'flex-start' }}>
              <StatusPill />
            </View>
          </View>
          <PixelAvatar spec={buddy(SPECIES[avatar % SPECIES.length])} size={48} bg={p.tint.lilac.bg} animated />
        </Row>
      </Appear>

      <DayStrip />

      <Appear index={1}>
        <HeroCard title="Daily Mission" subtitle="Finish a drill to earn a star" tint="yellow" deco={<Flower size={120} />}>
          <Row style={{ gap: 6 }}>
            <Icon name="star" size={15} color={p.tint.yellow.ink} fill={p.tint.yellow.ink} />
            <Txt size={13.5} weight="600" color={p.tint.yellow.ink}>
              {total} {total === 1 ? 'star' : 'stars'}
            </Txt>
          </Row>
        </HeroCard>
      </Appear>

      <Appear index={2}>
        <Row style={{ gap: 10 }}>
          {quick.map((q) => (
            <Press key={q.label} accessibilityRole="button" accessibilityLabel={q.label} onPress={() => router.navigate(q.go as never)} style={{ flex: 1 }}>
              <Card tint={q.tint} style={{ alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 6, borderRadius: 22 }}>
                <Icon name={q.icon} size={22} color={p.tint[q.tint].ink} />
                <Txt size={12} weight="600" color={p.tint[q.tint].ink} style={{ textAlign: 'center' }}>
                  {q.label}
                </Txt>
              </Card>
            </Press>
          ))}
        </Row>
      </Appear>

      <SectionTitle>{t('kidTodaysMission')}</SectionTitle>
      <PlanGrid items={plan} />

      <Appear index={6}>
        <Press onPress={() => router.navigate('/kid/didi' as never)}>
          <Card tint="yellow" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 22 }}>
            <PixelAvatar spec={cast('didi')} size={44} bg="rgba(255,255,255,0.6)" animated />
            <View style={{ flex: 1 }}>
              <Txt size={14.5} weight="600" color={p.tint.yellow.ink}>
                {t('kidAskDidi')}
              </Txt>
              <Txt size={12} color={p.tint.yellow.ink} style={{ opacity: 0.8 }}>
                {t('askMe')}
              </Txt>
            </View>
            <Icon name="next" size={16} color={p.tint.yellow.ink} />
          </Card>
        </Press>
      </Appear>

      <Appear index={7}>
        <SosPanel variant="kid" />
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
    </Screen>
  );
}

// "Hi, Explorer!" in either language with the child's name in it
function lang(name: string, hello: string) {
  return hello.replace('Explorer', name || 'Explorer').replace('खोजी', name || 'खोजी');
}
