import React from 'react';
import { View } from 'react-native';
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
      <Card style={{ gap: 8 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt size={13} color={p.muted}>
            {t('goBag')}
          </Txt>
          <Txt size={13} weight="600">
            {done}/{GO_BAG.length}
          </Txt>
        </Row>
        <View style={{ height: 5, borderRadius: 3, backgroundColor: p.cardAlt, overflow: 'hidden' }}>
          <View style={{ width: `${(done / GO_BAG.length) * 100}%`, height: 5, backgroundColor: p.ok }} />
        </View>
      </Card>
      {groups.map((g, gi) => {
        const items = GO_BAG.filter((i) => i.group[0] === g);
        return (
          <Appear key={g} index={gi}>
            <View style={{ gap: 8 }}>
              <SectionTitle>{L(items[0].group)}</SectionTitle>
              <Card style={{ gap: 12, padding: 12 }}>
                {items.map((i) => (
                  <Press key={i.id} accessibilityRole="checkbox" accessibilityState={{ checked: !!checklist[i.id] }} onPress={() => toggle(i.id)}>
                    <Row style={{ gap: 12 }}>
                      <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: checklist[i.id] ? p.ok : p.border, backgroundColor: checklist[i.id] ? p.ok : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                        {checklist[i.id] ? <Icon name="check" size={12} color="#fff" strokeWidth={3} /> : null}
                      </View>
                      <Txt size={14} style={{ flex: 1, opacity: checklist[i.id] ? 0.5 : 1, textDecorationLine: checklist[i.id] ? 'line-through' : 'none' }}>
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
