import { router } from 'expo-router';
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Flower } from '../../components/Deco';
import { Icon, type IconName } from '../../components/Icon';
import { Appear, Card, IconTile, Press, Row, type TintName, Txt, useTheme } from '../../components/ui';
import { useLocal, useT } from '../../i18n';
import { useSettings } from '../../state/settings';
import { Stars } from '../../components/Stars';

const GAMES: { id: string; icon: IconName; tint: TintName; title: readonly [string, string]; sub: readonly [string, string] }[] = [
  { id: 'bag', icon: 'learn', tint: 'green', title: ['Pack the go-bag', 'गो-बैग भरो'], sub: ['Pack only what you need', 'सिर्फ़ ज़रूरी चीज़ें रखो'] },
  { id: 'safe', icon: 'shield', tint: 'lilac', title: ['Safe or not?', 'सुरक्षित या नहीं?'], sub: ['Judge 8 situations', '8 स्थितियाँ परखो'] },
  { id: 'dch', icon: 'mountain', tint: 'peach', title: ['Drop, cover, hold', 'झुको, ढको, पकड़ो'], sub: ['Tap in the right order, fast', 'सही क्रम में जल्दी टैप करो'] },
];

export default function Play() {
  const t = useT();
  const L = useLocal();
  const { p } = useTheme();
  const insets = useSafeAreaInsets();
  const stars = useSettings((s) => s.stars);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.bg }} contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 120, gap: 12 }} showsVerticalScrollIndicator={false}>
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
          <Press accessibilityRole="button" onPress={() => router.push(`/kid/game/${g.id}` as never)}>
            <Card tint={g.tint} style={{ padding: 16 }}>
              <Row style={{ gap: 14 }}>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: p.tint[g.tint].ink, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={g.icon} size={21} color={p.tint[g.tint].bg} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Txt size={16} weight="700" color={p.tint[g.tint].ink}>
                    {L(g.title)}
                  </Txt>
                  <Txt size={12.5} color={p.tint[g.tint].ink}>
                    {L(g.sub)}
                  </Txt>
                  <Stars n={stars['game-' + g.id] ?? 0} />
                </View>
                <Icon name="playTri" size={16} color={p.tint[g.tint].ink} fill={p.tint[g.tint].ink} />
              </Row>
            </Card>
          </Press>
        </Appear>
      ))}
    </ScrollView>
  );
}
