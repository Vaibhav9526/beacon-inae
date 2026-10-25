import { router } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { Icon, type IconName } from '../../components/Icon';
import { PixelAvatar, cast } from '../../components/PixelAvatar';
import { Screen } from '../../components/Screen';
import { Appear, Card, IconTile, Press, Row, type TintName, Txt, useTheme } from '../../components/ui';
import { useLang, useT } from '../../i18n';

export default function More() {
  const { p } = useTheme();
  const t = useT();
  const lang = useLang();
  const items: { icon: IconName; tint: TintName; label: string; sub?: string; go: string }[] = [
    { icon: 'bot', tint: 'lilac', label: lang === 'hi' ? 'डेस्कटॉप हब' : 'Desktop hub', sub: lang === 'hi' ? 'आपके कंप्यूटर पर चल रहे एजेंट' : 'Agents running on your computer', go: '/hub' },
    { icon: 'heartPulse', tint: 'pink', label: t('medicalId'), go: '/medical' },
    { icon: 'family', tint: 'blue', label: t('tabKids'), go: '/family' },
    { icon: 'doc', tint: 'yellow', label: t('resourceBoard'), go: '/adult/community' },
    { icon: 'learn', tint: 'green', label: t('goBag'), go: '/gobag' },
    { icon: 'trophy', tint: 'peach', label: t('drills'), go: '/drills' },
    { icon: 'camera', tint: 'lilac', label: t('postReport'), go: '/report/new' },
    { icon: 'settings', tint: 'blue', label: t('settings'), go: '/settings' },
  ];
  return (
    <Screen back={false} title={t('tabMore')}>
      <Appear>
        <Press onPress={() => router.push('/adult/aid' as never)}>
          <Card tint="peach" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
            <PixelAvatar spec={cast('veer')} size={44} bg="rgba(255,255,255,0.6)" animated />
            <View style={{ flex: 1 }}>
              <Txt size={14.5} weight="600" color={p.dark ? p.text : '#17171B'}>
                {t('veerName')}
              </Txt>
              <Txt size={12} color={p.dark ? p.muted : '#5A3A20'}>
                {t('veerRole')}
              </Txt>
            </View>
            <Icon name="next" size={16} color={p.dark ? p.muted : '#5A3A20'} />
          </Card>
        </Press>
      </Appear>
      {items.map((i, k) => (
        <Appear key={i.go + i.label} index={k + 1}>
          <Press accessibilityRole="button" onPress={() => router.push(i.go as never)}>
            <Card style={{ padding: 11 }}>
              <Row style={{ gap: 12 }}>
                <IconTile name={i.icon} tint={i.tint} size={34} />
                <View style={{ flex: 1 }}>
                  <Txt size={14.5} weight="500">
                    {i.label}
                  </Txt>
                  {i.sub ? (
                    <Txt size={11.5} color={p.muted}>
                      {i.sub}
                    </Txt>
                  ) : null}
                </View>
                <Icon name="next" size={16} color={p.muted} />
              </Row>
            </Card>
          </Press>
        </Appear>
      ))}
    </Screen>
  );
}
