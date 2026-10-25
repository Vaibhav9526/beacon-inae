import { router } from 'expo-router';
import React, { useState } from 'react';
import { TextInput, View } from 'react-native';
import { Icon, type IconName } from '../../components/Icon';
import { PixelAvatar, SPECIES, buddy } from '../../components/PixelAvatar';
import { Screen } from '../../components/Screen';
import { Appear, Btn, Card, Press, Row, SectionTitle, Txt, useTheme } from '../../components/ui';
import { useT } from '../../i18n';
import { useSettings } from '../../state/settings';
import { radius } from '../../theme';

const BADGES: { id: string; icon: IconName; en: string; hi: string }[] = [
  { id: 'earthquake', icon: 'mountain', en: 'Quake hero', hi: 'भूकंप वीर' },
  { id: 'fire', icon: 'fire', en: 'Fire smart', hi: 'आग समझदार' },
  { id: 'flood', icon: 'flood', en: 'Flood ready', hi: 'बाढ़ तैयार' },
  { id: 'lost', icon: 'compass', en: 'Never lost', hi: 'कभी नहीं खोया' },
  { id: 'game-bag', icon: 'learn', en: 'Bag master', hi: 'बैग मास्टर' },
  { id: 'game-safe', icon: 'shield', en: 'Safety judge', hi: 'सुरक्षा जज' },
];

export default function Me() {
  const { p } = useTheme();
  const t = useT();
  const s = useSettings();
  const [gate, setGate] = useState<{ a: number; b: number } | null>(null);
  const [answer, setAnswer] = useState('');
  const [open, setOpen] = useState(false);
  const total = Object.values(s.stars).reduce((a, b) => a + b, 0);
  const startGate = () => setGate({ a: 6 + Math.floor(Math.random() * 6), b: 6 + Math.floor(Math.random() * 6) });
  const check = () => {
    if (gate && Number(answer) === gate.a * gate.b) {
      setOpen(true);
      setGate(null);
    }
    setAnswer('');
  };

  return (
    <Screen back={false} bottomPad={120}>
      <Appear>
        <Row style={{ gap: 14, paddingTop: 6 }}>
          <PixelAvatar spec={buddy(SPECIES[s.kidAvatar % SPECIES.length])} size={64} bg={p.tint.yellow.bg} animated />
          <View style={{ gap: 3 }}>
            <Txt size={22} weight="600">
              {s.kidName || 'Explorer'}
            </Txt>
            <Row style={{ gap: 5 }}>
              <Icon name="star" size={13} color="#E9B44C" fill="#E9B44C" />
              <Txt size={13} color={p.muted}>
                {total} {t('kidStars')}
              </Txt>
            </Row>
          </View>
        </Row>
      </Appear>

      <SectionTitle>{t('kidChooseBuddy')}</SectionTitle>
      <Row style={{ flexWrap: 'wrap', gap: 10 }}>
        {SPECIES.map((sp, i) => (
          <Press key={sp} accessibilityLabel={sp} onPress={() => s.set({ kidAvatar: i })} style={{ padding: 3, borderRadius: 999, borderWidth: 1.5, borderColor: s.kidAvatar === i ? p.text : 'transparent' }}>
            <PixelAvatar spec={buddy(sp)} size={42} bg={p.cardAlt} />
          </Press>
        ))}
      </Row>

      <SectionTitle>{t('kidBadges')}</SectionTitle>
      <Row style={{ flexWrap: 'wrap', gap: 10 }}>
        {BADGES.map((b, i) => {
          const earned = (s.stars[b.id] ?? 0) >= 3;
          return (
            <Appear key={b.id} index={i} style={{ width: '30%' }}>
              <View style={{ alignItems: 'center', gap: 5, opacity: earned ? 1 : 0.4 }}>
                <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: earned ? p.tint.yellow.bg : p.cardAlt, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={b.icon} size={22} color={earned ? p.tint.yellow.ink : p.muted} />
                </View>
                <Txt size={11} color={p.muted} style={{ textAlign: 'center' }}>
                  {s.lang === 'hi' ? b.hi : b.en}
                </Txt>
              </View>
            </Appear>
          );
        })}
      </Row>

      <Card style={{ gap: 4 }}>
        <Txt size={11} weight="600" color={p.muted} style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
          {t('yourCode')}
        </Txt>
        <Txt size={26} weight="600" style={{ letterSpacing: 4 }}>
          {s.familyCode}
        </Txt>
        <Txt size={12} color={p.muted}>
          {t('shareCodeHint')}
        </Txt>
      </Card>

      {/* parent gate: kids cannot change settings or leave kid mode by accident */}
      {open ? (
        <Card style={{ gap: 8 }}>
          <Btn label={t('settings')} icon="settings" kind="secondary" onPress={() => router.push('/settings' as never)} />
          <Btn
            label={t('switchMode')}
            kind="ghost"
            onPress={() => {
              s.set({ onboarded: false, mode: null });
              router.replace('/welcome');
            }}
          />
        </Card>
      ) : gate ? (
        <Card style={{ gap: 8 }}>
          <Txt size={13.5} weight="500">
            {s.lang === 'hi' ? 'माता-पिता के लिए: ' : 'For parents: '} {gate.a} × {gate.b} = ?
          </Txt>
          <Row>
            <TextInput value={answer} onChangeText={setAnswer} keyboardType="number-pad" onSubmitEditing={check} style={{ flex: 1, height: 40, backgroundColor: p.cardAlt, borderRadius: radius.pill, paddingHorizontal: 16, fontSize: 15, color: p.text, fontFamily: 'Lexend_400Regular', paddingVertical: 0 }} />
            <Btn label="OK" onPress={check} />
          </Row>
        </Card>
      ) : (
        <Btn label={t('settings')} icon="lock" kind="ghost" onPress={startGate} />
      )}
    </Screen>
  );
}
