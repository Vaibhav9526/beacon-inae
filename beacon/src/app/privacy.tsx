import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { Shield } from '../components/Deco';
import { HeroCard } from '../components/HeroCard';
import { Screen } from '../components/Screen';
import { Switch } from '../components/Switch';
import { Appear, Btn, Card, Row, SectionTitle, Txt, useTheme } from '../components/ui';
import * as haptics from '../services/haptics';
import { listWipeTargets, wipeEverything } from '../services/wipe';

/** Time the person has to press erase a second time. */
const CONFIRM_MS = 4000;

export default function Privacy() {
  const { p } = useTheme();
  const targets = listWipeTargets();
  const [keepModels, setKeepModels] = useState(true);
  const [armedUntil, setArmedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  // While armed, tick the countdown; disarm when the window closes.
  useEffect(() => {
    if (armedUntil === null) return;
    const id = setInterval(() => {
      const t = Date.now();
      if (t >= armedUntil) setArmedUntil(null);
      else setNow(t);
    }, 200);
    return () => clearInterval(id);
  }, [armedUntil]);

  const secondsLeft = armedUntil === null ? 0 : Math.max(0, Math.ceil((armedUntil - now) / 1000));

  const erase = async () => {
    setArmedUntil(null);
    setBusy(true);
    haptics.warn();
    const { failed } = await wipeEverything({ keepModels });
    const go = () => router.replace('/welcome' as never);
    if (failed.length > 0) {
      Alert.alert('Some items could not be erased', `Still on this phone: ${failed.join(', ')}.`, [{ text: 'OK', onPress: go }]);
    } else {
      go();
    }
  };

  const onErase = () => {
    if (busy) return;
    if (armedUntil === null) {
      // first press: arm and show the countdown
      haptics.soft();
      const until = Date.now() + CONFIRM_MS;
      setNow(Date.now());
      setArmedUntil(until);
      return;
    }
    void erase();
  };

  return (
    <Screen title="Privacy">
      <Appear>
        <HeroCard title="Only on this phone" subtitle="Nothing leaves it unless you send it." tint="pink" deco={<Shield size={110} />} />
      </Appear>

      <SectionTitle>Stored on this phone</SectionTitle>
      <Card style={{ gap: 14 }}>
        {targets.map((t) => (
          <View key={t.id} style={{ gap: 3 }}>
            <Txt size={15} weight="600">
              {t.label}
            </Txt>
            <Txt size={13} color={p.muted}>
              {t.detail}
            </Txt>
          </View>
        ))}
      </Card>

      <Card>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 3 }}>
            <Txt size={15} weight="600">
              Keep downloaded models
            </Txt>
            <Txt size={13} color={p.muted}>
              Saves downloading them again. They hold no personal data.
            </Txt>
          </View>
          <Switch value={keepModels} onValueChange={setKeepModels} accessibilityLabel="Keep downloaded models" disabled={busy} />
        </Row>
      </Card>

      <Btn
        kind="danger"
        size="lg"
        haptic={false}
        disabled={busy}
        label={busy ? 'Erasing...' : armedUntil !== null ? `Press again to erase (${secondsLeft}s)` : 'Erase everything on this phone'}
        accessibilityLabel="Erase everything on this phone"
        onPress={onErase}
        style={{ marginTop: 8 }}
      />
    </Screen>
  );
}
