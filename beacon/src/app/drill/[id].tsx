import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useRef, useState } from 'react';
import { Animated, Platform, View } from 'react-native';
import { Shield, Sun } from '../../components/Deco';
import { Icon } from '../../components/Icon';
import { PixelAvatar, SPECIES, buddy } from '../../components/PixelAvatar';
import { Screen } from '../../components/Screen';
import { Stars } from '../../components/Stars';
import { Appear, Btn, Card, IconTile, Press, Row, Txt, useTheme } from '../../components/ui';
import { useLocal, useT } from '../../i18n';
import { getDrill } from '../../kb/kidDrills';
import { speak } from '../../services/speech';
import { useSettings } from '../../state/settings';
import { radius } from '../../theme';

const OPTION_TINTS = ['blue', 'yellow', 'lilac', 'peach'] as const;

export default function DrillScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const drill = getDrill(String(id));
  const { p } = useTheme();
  const t = useT();
  const L = useLocal();
  const lang = useSettings((s) => s.lang);
  const haptics = useSettings((s) => s.haptics);
  const avatar = useSettings((s) => s.kidAvatar);
  const setStars = useSettings((s) => s.setStars);
  const [i, setI] = useState(-1); // -1 = intro
  const [picked, setPicked] = useState<number | null>(null);
  const [wrong, setWrong] = useState(0);
  const shake = useRef(new Animated.Value(0)).current;
  if (!drill) return null;

  const done = i >= drill.steps.length;
  const step = drill.steps[i];
  const stars = wrong === 0 ? 3 : wrong <= 2 ? 2 : 1;

  const choose = (k: number) => {
    if (picked !== null && step.options[picked].correct) return;
    setPicked(k);
    const ok = step.options[k].correct;
    if (haptics && Platform.OS !== 'web') Haptics.notificationAsync(ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => {});
    if (!ok) {
      setWrong((w) => w + 1);
      Animated.sequence([-8, 8, -6, 6, 0].map((v) => Animated.timing(shake, { toValue: v, duration: 55, useNativeDriver: true }))).start();
    } else void speak(L(step.why), lang, 'didi');
  };

  const next = () => {
    setPicked(null);
    if (i + 1 >= drill.steps.length) setStars(drill.id, wrong === 0 ? 3 : wrong <= 2 ? 2 : 1);
    setI(i + 1);
  };

  return (
    <Screen title={L(drill.title)}>
      {i === -1 ? (
        <Appear>
          <Card style={{ alignItems: 'center', gap: 16, paddingTop: 64, paddingBottom: 28, paddingHorizontal: 18, overflow: 'hidden' }}>
            <View pointerEvents="none" style={{ position: 'absolute', right: -12, top: -16, transform: [{ rotate: '12deg' }] }}>
              <Shield size={84} />
            </View>
            <IconTile name={drill.icon} tint={drill.tint} size={72} />
            <Txt size={16} weight="500" style={{ textAlign: 'center', paddingHorizontal: 12 }}>
              {L(drill.intro)}
            </Txt>
            <Btn label={t('kidLetsGo')} size="lg" onPress={() => setI(0)} />
          </Card>
        </Appear>
      ) : done ? (
        <Appear>
          <Card style={{ alignItems: 'center', gap: 14, paddingTop: 64, paddingBottom: 28, paddingHorizontal: 18, overflow: 'hidden' }}>
            <View pointerEvents="none" style={{ position: 'absolute', right: -12, top: -16, transform: [{ rotate: '12deg' }] }}>
              <Sun size={84} />
            </View>
            <PixelAvatar spec={buddy(SPECIES[avatar % SPECIES.length])} size={84} bg={p.tint.yellow.bg} animated />
            <Stars n={stars} size={26} />
            <Txt size={20} weight="600">
              {lang === 'hi' ? 'शाबाश!' : 'Well done!'}
            </Txt>
            <Btn label={t('done')} onPress={() => router.back()} />
          </Card>
        </Appear>
      ) : (
        <View style={{ gap: 14 }}>
          <Row style={{ gap: 5 }}>
            {drill.steps.map((_, k) => (
              <View key={k} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: k <= i ? p.text : p.border }} />
            ))}
          </Row>
          <Appear key={`q${i}`}>
            <Card style={{ alignItems: 'center', gap: 12, paddingVertical: 22 }}>
              <IconTile name={step.icon} tint={drill.tint} size={52} />
              <Txt size={17} weight="600" style={{ textAlign: 'center' }}>
                {L(step.prompt)}
              </Txt>
            </Card>
          </Appear>
          <Animated.View style={{ gap: 8, transform: [{ translateX: shake }] }}>
            {step.options.map((o, k) => {
              const chosen = picked === k;
              const good = chosen && o.correct;
              const bad = chosen && !o.correct;
              const tone = good ? 'green' : bad ? 'pink' : OPTION_TINTS[k % OPTION_TINTS.length];
              const ink = p.tint[tone].ink;
              return (
                <Appear key={`${i}-${k}`} index={k + 1}>
                  <Press accessibilityRole="button" onPress={() => choose(k)}>
                    <Card tint={tone} style={{ padding: 12, borderRadius: 24 }}>
                      <Row style={{ gap: 12 }}>
                        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: ink, alignItems: 'center', justifyContent: 'center' }}>
                          {chosen ? <Icon name={o.correct ? 'check' : 'close'} size={13} color={p.tint[tone].bg} /> : <Txt size={11.5} weight="600" color={p.tint[tone].bg}>{'ABC'[k]}</Txt>}
                        </View>
                        <Txt size={14.5} color={ink} style={{ flex: 1 }}>
                          {L(o.label)}
                        </Txt>
                      </Row>
                    </Card>
                  </Press>
                </Appear>
              );
            })}
          </Animated.View>
          {picked !== null ? (
            <Appear>
              <View style={{ gap: 10 }}>
                <Card tint={step.options[picked].correct ? 'green' : 'peach'} style={{ borderRadius: radius.md }}>
                  <Txt size={13.5} color={p.dark ? p.text : '#1D1D22'}>
                    {L(step.why)}
                  </Txt>
                </Card>
                {step.options[picked].correct ? <Btn label={i + 1 >= drill.steps.length ? t('done') : t('continue')} onPress={next} /> : null}
              </View>
            </Appear>
          ) : null}
        </View>
      )}
    </Screen>
  );
}
