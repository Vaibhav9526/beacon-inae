import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useT } from '../i18n';
import { useMesh } from '../services/mesh';
import { useShake } from '../services/shake';
import { type SosResult, call112, sendSafeNow, sendSosNow, smsFallback } from '../services/sos';
import { useSettings } from '../state/settings';
import { Icon } from './Icon';
import { Btn, Card, Row, Txt, useTheme } from './ui';

type Phase = 'idle' | 'holding' | 'sending' | 'sent';

/**
 * The red help button. A deliberate press-and-hold (so a pocket cannot trigger it) sends an SOS over the Bluetooth
 * mesh and to the family at the same moment. Shaking the phone 3 times does the same after a 5 s cancel window.
 */
export function SosPanel({ variant }: { variant: 'kid' | 'adult' }) {
  const { p } = useTheme();
  const t = useT();
  const haptics = useSettings((s) => s.haptics);
  const shakeSos = useSettings((s) => s.shakeSos);
  const sosActive = useMesh((s) => s.sosActive);
  const [phase, setPhase] = useState<Phase>(sosActive ? 'sent' : 'idle');
  const [result, setResult] = useState<SosResult | null>(null);
  const [safeMsg, setSafeMsg] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const [pct, setPct] = useState(0);
  const holdMs = variant === 'kid' ? 1600 : 2200;
  const anim = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    const id = progress.addListener(({ value }) => setPct(value));
    return () => progress.removeListener(id);
  }, [progress]);

  const fire = useCallback(async () => {
    setPhase('sending');
    try {
      const r = await sendSosNow();
      setResult(r);
      setPhase('sent');
    } catch {
      setPhase('idle'); // nothing went out: back to the button so it can be pressed again
    }
  }, []);

  const begin = () => {
    if (phase !== 'idle') return;
    setPhase('holding');
    if (haptics && Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    progress.setValue(0);
    anim.current = Animated.timing(progress, { toValue: 1, duration: holdMs, easing: Easing.linear, useNativeDriver: false });
    anim.current.start(({ finished }) => {
      if (finished) void fire();
    });
  };

  const release = () => {
    if (phase !== 'holding') return;
    anim.current?.stop();
    progress.setValue(0);
    setPhase('idle');
  };

  const onShake = useCallback(() => setCountdown((c) => (c === null && phase === 'idle' ? 5 : c)), [phase]);
  useShake(onShake, shakeSos && variant === 'adult');
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      setCountdown(null);
      void fire();
      return;
    }
    if (haptics && Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    const h = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(h);
  }, [countdown, fire, haptics]);

  const cancel = () => {
    useMesh.getState().cancelSos();
    setPhase('idle');
    setResult(null);
  };

  const safe = async () => {
    try {
      await sendSafeNow();
      setSafeMsg(true);
    } catch {
      /* not sent: leave the panel as it is */
      return;
    }
    setPhase('idle');
    setResult(null);
  };

  const size = 96;
  const r = size / 2 - 4;
  const circ = 2 * Math.PI * r;

  if (countdown !== null) {
    return (
      <Card style={{ alignItems: 'center', gap: 8, borderColor: p.danger }}>
        <Txt size={34} weight="600" color={p.danger}>
          {countdown}
        </Txt>
        <Txt size={13} color={p.muted}>
          {t('sosSending')}
        </Txt>
        <Btn label={t('sosCancel')} kind="secondary" size="sm" onPress={() => setCountdown(null)} />
      </Card>
    );
  }

  if (phase === 'sending' || phase === 'sent') {
    return (
      <Card style={{ gap: 12, borderColor: p.danger }}>
        <Row style={{ alignItems: 'flex-start' }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: p.danger + '22', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="siren" size={17} color={p.danger} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt size={15} weight="600" color={p.danger}>
              {phase === 'sending' ? t('sosSending') : t('sosSent')}
            </Txt>
            {result ? (
              <View style={{ marginTop: 4, gap: 2 }}>
                <Row style={{ gap: 6 }}>
                  <Icon name="check" size={12} color={p.ok} />
                  <Txt size={12} color={p.muted}>
                    {t('sosSentMesh')}
                  </Txt>
                </Row>
                {result.cloud ? (
                  <Row style={{ gap: 6 }}>
                    <Icon name="check" size={12} color={p.ok} />
                    <Txt size={12} color={p.muted}>
                      {t('sosSentCloud')}
                    </Txt>
                  </Row>
                ) : null}
              </View>
            ) : null}
          </View>
        </Row>
        <Row style={{ flexWrap: 'wrap', gap: 8 }}>
          <Btn label={t('call112')} icon="phone" kind="danger" size="sm" onPress={() => void call112()} />
          {variant === 'adult' ? <Btn label="SMS" icon="chat" kind="secondary" size="sm" onPress={() => void smsFallback()} /> : null}
          <Btn label={t('iAmSafe')} icon="check" kind="secondary" size="sm" onPress={() => void safe()} />
          <Btn label={t('sosCancel')} kind="ghost" size="sm" onPress={cancel} />
        </Row>
      </Card>
    );
  }

  return (
    <Card tint="pink" style={{ alignItems: 'center', gap: 10, padding: 20 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${t('holdForHelp')}. ${t('tellsParents')}`} onPressIn={begin} onPressOut={release} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={p.danger + '33'} strokeWidth={3} fill="none" />
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={p.danger} strokeWidth={3} strokeLinecap="round" fill="none" strokeDasharray={`${circ}`} strokeDashoffset={circ * (1 - pct)} rotation={-90} originX={size / 2} originY={size / 2} />
        </Svg>
        <View style={{ width: size - 18, height: size - 18, borderRadius: size, backgroundColor: '#0A0A0C', alignItems: 'center', justifyContent: 'center', transform: [{ scale: phase === 'holding' ? 0.95 : 1 }] }}>
          <Txt size={22} weight="700" color="#fff" style={{ letterSpacing: 1 }}>
            SOS
          </Txt>
        </View>
      </Pressable>
      <Txt size={14} weight="600" color={p.tint.pink.ink} style={{ textAlign: 'center' }}>
        {phase === 'holding' ? t('sosHold') : t('holdForHelp')}
      </Txt>
      <Txt size={12} color={p.tint.pink.ink} style={{ textAlign: 'center' }}>
        {variant === 'kid' ? t('tellsParents') : shakeSos ? t('sosShakeHint') : ''}
      </Txt>
      {safeMsg ? (
        <Txt size={12} color={p.tint.pink.ink} weight="600">
          {t('iAmSafeSent')}
        </Txt>
      ) : null}
    </Card>
  );
}
