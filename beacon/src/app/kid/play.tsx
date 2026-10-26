import { router } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { Flower } from '../../components/Deco';
import { Icon, type IconName } from '../../components/Icon';
import { Screen } from '../../components/Screen';
import { Appear, Card, Press, Row, type TintName, Txt, useTheme } from '../../components/ui';
import { type StringKey, useT } from '../../i18n';
import { useSettings } from '../../state/settings';
import { Stars } from '../../components/Stars';

const GAMES: { id: string; icon: IconName; tint: TintName; title: StringKey; sub: StringKey }[] = [
  { id: 'bag', icon: 'learn', tint: 'green', title: 'gameBagTitle', sub: 'gameBagSub' },
  { id: 'safe', icon: 'shield', tint: 'lilac', title: 'gameSafeTitle', sub: 'gameSafeSub' },
  { id: 'dch', icon: 'mountain', tint: 'peach', title: 'gameDchTitle', sub: 'gameDchSub' },
];

export default function Play() {
  const t = useT();
  const { p } = useTheme();
  const stars = useSettings((s) => s.stars);
  return (
    <Screen back={false}>
      <Appear>
        <Card tint="pink" style={{ overflow: 'hidden', minHeight: 140, justifyContent: 'flex-end', padding: 20 }}>
          <View style={{ gap: 4, paddingRight: 92 }}>
            <Txt size={30} weight="700" color={p.tint.pink.ink}>
              {t('kidGames')}
            </Txt>
            <Txt size={14} color={p.tint.pink.ink} style={{ opacity: 0.8 }}>
              {t('kidReady')}
            </Txt>
          </View>
          <View pointerEvents="none" style={{ position: 'absolute', right: -10, top: -14, transform: [{ rotate: '12deg' }] }}>
            <Flower size={92} />
          </View>
        </Card>
      </Appear>
      {GAMES.map((g, i) => (
        <Appear key={g.id} index={i + 1}>
          <Press accessibilityRole="button" accessibilityLabel={t(g.title)} onPress={() => router.push(`/game/${g.id}` as never)}>
            <Card tint={g.tint} style={{ padding: 16 }}>
              <Row style={{ gap: 14 }}>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: p.tint[g.tint].ink, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={g.icon} size={21} color={p.tint[g.tint].bg} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Txt size={16} weight="700" color={p.tint[g.tint].ink}>
                    {t(g.title)}
                  </Txt>
                  <Txt size={12.5} color={p.tint[g.tint].ink}>
                    {t(g.sub)}
                  </Txt>
                  <Stars n={stars['game-' + g.id] ?? 0} />
                </View>
                <Icon name="playTri" size={16} color={p.tint[g.tint].ink} fill={p.tint[g.tint].ink} />
              </Row>
            </Card>
          </Press>
        </Appear>
      ))}
    </Screen>
  );
}
