import { router } from 'expo-router';
import React, { useState } from 'react';
import { TextInput, View } from 'react-native';
import { Icon } from '../components/Icon';
import { PixelAvatar, SPECIES, buddy, cast } from '../components/PixelAvatar';
import { Screen } from '../components/Screen';
import { Appear, Btn, Card, Press, Row, Txt, useTheme } from '../components/ui';
import { translate } from '../i18n';
import type { Lang } from '../kb/types';
import { useSettings } from '../state/settings';
import { type Mode, radius } from '../theme';

type Step = 'lang' | 'who' | 'name';

export default function Welcome() {
  const { p } = useTheme();
  const s = useSettings();
  const [step, setStep] = useState<Step>('lang');
  const [mode, setMode] = useState<Mode>('adult');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(s.kidAvatar);
  const lang = s.lang;
  const t = (k: Parameters<typeof translate>[0]) => translate(k, lang);

  const finish = () => {
    const clean = name.trim();
    s.set({ mode, onboarded: true, nickname: mode === 'kid' ? clean : clean || (mode === 'parent' ? 'Parent' : 'Beacon user'), kidName: mode === 'kid' ? clean || 'Explorer' : s.kidName, kidAvatar: avatar });
    router.replace(`/${mode}` as never);
  };

  const roles: { mode: Mode; label: string; sub: string; tint: 'yellow' | 'blue' | 'lilac'; avatar: ReturnType<typeof cast> }[] = [
    { mode: 'kid', label: t('iAmKid'), sub: lang === 'hi' ? 'खेल, अभ्यास और मदद' : 'Games, drills and help', tint: 'yellow', avatar: buddy(SPECIES[avatar % SPECIES.length]) },
    { mode: 'parent', label: t('iAmParent'), sub: lang === 'hi' ? 'बच्चों की सुरक्षा देखें' : 'Keep an eye on your family', tint: 'blue', avatar: cast('guardian') },
    { mode: 'adult', label: t('iAmAdult'), sub: lang === 'hi' ? 'अलर्ट, नक्शा, समुदाय' : 'Alerts, map and community', tint: 'lilac', avatar: cast('sentinel') },
  ];

  return (
    <Screen back={false} scroll={false}>
      <View style={{ flex: 1, paddingHorizontal: 20, justifyContent: 'center', gap: 22 }}>
        <Appear>
          <View style={{ gap: 6 }}>
            <Row style={{ gap: 8 }}>
              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="radio" size={14} color={p.onAccent} />
              </View>
              <Txt size={20} weight="700">
                {t('appName')}
              </Txt>
            </Row>
            <Txt size={26} weight="600" style={{ lineHeight: 34 }}>
              {step === 'name' ? (mode === 'kid' ? t('kidNameQ') : t('yourName')) : step === 'who' ? t('whoAreYou') : t('chooseLanguage')}
            </Txt>
            <Txt size={13} color={p.muted}>
              {t('tagline')}
            </Txt>
          </View>
        </Appear>

        {step === 'lang' && (
          <View style={{ gap: 10 }}>
            {(
              [
                ['en', 'English', 'Hello'],
                ['hi', 'हिन्दी', 'नमस्ते'],
              ] as [Lang, string, string][]
            ).map(([code, label, hello], i) => (
              <Appear key={code} index={i + 1}>
                <Press
                  accessibilityRole="button"
                  onPress={() => {
                    s.set({ lang: code });
                    setStep('who');
                  }}>
                  <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16 }}>
                    <View>
                      <Txt size={17} weight="600">
                        {label}
                      </Txt>
                      <Txt size={12} color={p.muted}>
                        {hello}
                      </Txt>
                    </View>
                    <Icon name="next" size={18} color={p.muted} />
                  </Card>
                </Press>
              </Appear>
            ))}
          </View>
        )}

        {step === 'who' && (
          <View style={{ gap: 10 }}>
            {roles.map((r, i) => (
              <Appear key={r.mode} index={i + 1}>
                <Press
                  accessibilityRole="button"
                  onPress={() => {
                    setMode(r.mode);
                    setStep('name');
                  }}>
                  <Card tint={r.tint} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 }}>
                    <PixelAvatar spec={r.avatar} size={46} bg="rgba(255,255,255,0.55)" animated />
                    <View style={{ flex: 1 }}>
                      <Txt size={16.5} weight="600" color={p.dark ? p.text : '#17171B'}>
                        {r.label}
                      </Txt>
                      <Txt size={12} color={p.dark ? p.muted : '#4A4A55'}>
                        {r.sub}
                      </Txt>
                    </View>
                    <Icon name="next" size={18} color={p.dark ? p.muted : '#4A4A55'} />
                  </Card>
                </Press>
              </Appear>
            ))}
            <Btn label={t('back')} kind="ghost" size="sm" onPress={() => setStep('lang')} style={{ alignSelf: 'flex-start' }} />
          </View>
        )}

        {step === 'name' && (
          <View style={{ gap: 14 }}>
            <Appear index={1}>
              <TextInput value={name} onChangeText={setName} placeholder={t('yourName')} placeholderTextColor={p.muted} maxLength={24} style={{ backgroundColor: p.card, borderWidth: 1, borderColor: p.border, borderRadius: radius.md, paddingHorizontal: 16, height: 48, fontSize: 16, color: p.text, fontFamily: 'Lexend_400Regular', paddingVertical: 0 }} />
            </Appear>
            {mode === 'kid' ? (
              <Appear index={2}>
                <View style={{ gap: 8 }}>
                  <Txt size={12} color={p.muted}>
                    {t('kidChooseBuddy')}
                  </Txt>
                  <Row style={{ flexWrap: 'wrap', gap: 10 }}>
                    {SPECIES.map((sp, i) => (
                      <Press key={sp} accessibilityLabel={sp} onPress={() => setAvatar(i)} style={{ padding: 3, borderRadius: 999, borderWidth: 1.5, borderColor: avatar === i ? p.text : 'transparent' }}>
                        <PixelAvatar spec={buddy(sp)} size={46} bg={p.cardAlt} />
                      </Press>
                    ))}
                  </Row>
                </View>
              </Appear>
            ) : null}
            <Appear index={3}>
              <Row style={{ gap: 8 }}>
                <Btn label={t('back')} kind="ghost" onPress={() => setStep('who')} />
                <View style={{ flex: 1 }}>
                  <Btn label={mode === 'kid' ? t('kidLetsGo') : t('continue')} onPress={finish} />
                </View>
              </Row>
            </Appear>
          </View>
        )}
      </View>
    </Screen>
  );
}
