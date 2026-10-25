import React from 'react';
import { View } from 'react-native';
import { Shield } from '../components/Deco';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { Appear, Card, Press, Row, SectionTitle, Txt, useTheme } from '../components/ui';
import { useLocal, useT } from '../i18n';
import { GO_BAG } from '../kb';
import { useSettings } from '../state/settings';

export default function GoBag() {
  const { p } = useTheme();
  const t = useT();
  const L = useLocal();
  const checklist = useSettings((s) => s.checklist);
  const toggle = useSettings((s) => s.toggleCheck);
  const done = GO_BAG.filter((i) => checklist[i.id]).length;
  const groups = [...new Set(GO_BAG.map((i) => i.group[0]))];
  return (
    <Screen title={t('goBag')}>
      <Card tint="green" style={{ gap: 10, overflow: 'hidden', minHeight: 120, paddingRight: 84 }}>
        <View pointerEvents="none" style={{ position: 'absolute', right: -12, top: -16, transform: [{ rotate: '12deg' }] }}>
          <Shield size={88} />
        </View>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt size={14} weight="600" color={p.tint.green.ink}>
            {t('goBag')}
          </Txt>
          <Txt size={14} weight="700" color={p.tint.green.ink}>
            {done}/{GO_BAG.length}
          </Txt>
        </Row>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: p.tint.green.ink + '33', overflow: 'hidden' }}>
          <View style={{ width: `${(done / GO_BAG.length) * 100}%`, height: 8, backgroundColor: p.tint.green.ink }} />
        </View>
      </Card>
      {groups.map((g, gi) => {
        const items = GO_BAG.filter((i) => i.group[0] === g);
        const tint = (['pink', 'yellow', 'blue', 'lilac', 'peach'] as const)[gi % 5];
        return (
          <Appear key={g} index={gi}>
            <View style={{ gap: 8 }}>
              <SectionTitle>{L(items[0].group)}</SectionTitle>
              <Card tint={tint} style={{ gap: 12, padding: 16 }}>
                {items.map((i) => (
                  <Press key={i.id} accessibilityRole="checkbox" accessibilityState={{ checked: !!checklist[i.id] }} onPress={() => toggle(i.id)}>
                    <Row style={{ gap: 12 }}>
                      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#0A0A0C', backgroundColor: checklist[i.id] ? '#0A0A0C' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                        {checklist[i.id] ? <Icon name="check" size={12} color="#FFFFFF" strokeWidth={3} /> : null}
                      </View>
                      <Txt size={14.5} color="#0A0A0C" style={{ flex: 1, opacity: checklist[i.id] ? 0.5 : 1, textDecorationLine: checklist[i.id] ? 'line-through' : 'none' }}>
                        {L(i.item)}
                      </Txt>
                    </Row>
                  </Press>
                ))}
              </Card>
            </View>
          </Appear>
        );
      })}
    </Screen>
  );
}
