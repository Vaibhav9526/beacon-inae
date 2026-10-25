import { router } from 'expo-router';
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
        <View style={{ gap: 2 }}>
          <Txt size={24} weight="600">
            {t('kidGames')}
          </Txt>
          <Txt size={13} color={p.muted}>
            {t('kidReady')}
          </Txt>
        </View>
      </Appear>
      {GAMES.map((g, i) => (
        <Appear key={g.id} index={i + 1}>
          <Press accessibilityRole="button" onPress={() => router.push(`/kid/game/${g.id}` as never)}>
            <Card tint={g.tint} style={{ padding: 14 }}>
              <Row style={{ gap: 14 }}>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.55)', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={g.icon} size={21} color={p.tint[g.tint].ink} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Txt size={15.5} weight="600" color={p.dark ? p.text : '#17171B'}>
                    {L(g.title)}
                  </Txt>
                  <Txt size={12} color={p.dark ? p.muted : '#4A4A55'}>
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
