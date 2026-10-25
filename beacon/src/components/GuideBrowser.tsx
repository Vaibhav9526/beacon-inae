import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';
import { ALL_GUIDES, DISASTERS, searchGuides } from '../kb';
import { useLocal, useT } from '../i18n';
import { radius } from '../theme';
import { Flower } from './Deco';
import { Icon, guideIcon } from './Icon';
import { Appear, Badge, Card, Chip, IconTile, Press, Row, Txt, useTheme } from './ui';

type Kind = 'firstaid' | 'remedy' | 'disaster';

/** Browse every offline guide, with search that works in English, Hindi or Hinglish. */
export function GuideBrowser() {
  const { p } = useTheme();
  const t = useT();
  const L = useLocal();
  const [kind, setKind] = useState<Kind>('firstaid');
  const [q, setQ] = useState('');
  const results = useMemo(() => (q.trim() ? searchGuides(q, { limit: 12 }).map((m) => m.item) : ALL_GUIDES.filter((g) => g.kind === kind)), [q, kind]);

  // each guide category gets its own sticker tint: first aid=green, remedies=yellow, disasters=blue,
  // and emergency-level guides are pink, urgent ones peach (see the results branch below)
  const row = (key: string, icon: ReturnType<typeof guideIcon>, title: string, go: string, tint: 'pink' | 'yellow' | 'green' | 'lilac' | 'peach' | 'blue', badge?: boolean, i = 0) => (
    <Appear key={key} index={i}>
      <Press accessibilityRole="button" onPress={() => router.push(go as never)}>
        <Card tint={tint} style={{ padding: 14 }}>
          <Row style={{ gap: 12 }}>
            <IconTile name={icon} tint={tint} size={36} color={p.tint[tint].ink} />
            <Txt size={15} weight="700" color={p.tint[tint].ink} style={{ flex: 1 }}>
              {title}
            </Txt>
            {badge ? <Badge soft label="112" color={p.tint[tint].ink} /> : null}
            <Icon name="next" size={15} color={p.tint[tint].ink} />
          </Row>
        </Card>
      </Press>
    </Appear>
  );

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: p.card, borderRadius: radius.pill, borderWidth: 1, borderColor: p.border, paddingHorizontal: 14, height: 42, gap: 8 }}>
        <Icon name="search" size={15} color={p.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder={t('aidPlaceholder')} placeholderTextColor={p.muted} style={{ flex: 1, color: p.text, fontSize: 14, fontFamily: 'Poppins_400Regular', paddingVertical: 0 }} />
      </View>
      {!q.trim() ? (
        <Row style={{ flexWrap: 'wrap', gap: 6 }}>
          <Chip label={t('firstAidTab')} icon="aid" active={kind === 'firstaid'} onPress={() => setKind('firstaid')} />
          <Chip label={t('remedyTab')} icon="package" active={kind === 'remedy'} onPress={() => setKind('remedy')} />
          <Chip label={t('disasterTab')} icon="alert" active={kind === 'disaster'} onPress={() => setKind('disaster')} />
        </Row>
      ) : null}
      {!q.trim() && kind === 'disaster'
        ? DISASTERS.map((d, i) => row(d.id, guideIcon(d.id), L(d.title), `/disaster/${d.id}`, 'blue', false, i))
        : results.map((g, i) => row(g.id, guideIcon(g.id), L(g.title), `/guide/${g.id}`, g.level === 'emergency' ? 'pink' : g.level === 'urgent' ? 'peach' : kind === 'remedy' ? 'yellow' : 'green', g.level === 'emergency', i))}
      {q.trim() && results.length === 0 ? (
        <Card tint="lilac" style={{ overflow: 'hidden', minHeight: 120, justifyContent: 'center', paddingRight: 92 }}>
          <Txt size={15} weight="700" color={p.tint.lilac.ink}>
            {t('noMatch')}
          </Txt>
          <View pointerEvents="none" style={{ position: 'absolute', right: -12, top: -14, transform: [{ rotate: '12deg' }] }}>
            <Flower size={88} />
          </View>
        </Card>
      ) : null}
    </View>
  );
}
