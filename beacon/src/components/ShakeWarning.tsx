import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import { Modal, Platform, ScrollView, View } from 'react-native';
import { useLocal } from '../i18n';
import { dodontFor } from '../kb/dodont';
import { useQuake } from '../services/quakeService';
import { sendSafeNow } from '../services/sos';
import { speak, stopSpeaking } from '../services/speech';
import { useSettings } from '../state/settings';
import { Btn, Txt } from './ui';

const AUTO_DISMISS_MS = 90_000;
const BG = '#4A0F14';
const INK = '#FFF4F2';

/**
 * Full-screen red warning when nearby phones agree they felt strong shaking.
 * Mount once near the app root. It is a phone-to-phone estimate, never an official alert.
 */
export function ShakeWarning() {
  const local = useLocal();
  const lang = useSettings((s) => s.lang);
  const hapticsOn = useSettings((s) => s.haptics);
  const warningAt = useQuake((s) => s.warningAt);
  const testing = useQuake((s) => s.testing);
  const phones = useQuake((s) => s.phones);
  const dismiss = useQuake((s) => s.dismiss);
  const [sent, setSent] = useState<'idle' | 'sending' | 'error'>('idle');
  const active = warningAt !== null;

  useEffect(() => {
    if (warningAt === null) return;
    setSent('idle');
    void speak(lang === 'hi' ? 'तेज़ झटके। झुको। सिर ढको। कसकर पकड़ो।' : 'Strong shaking. Drop. Cover. Hold on.', lang).catch(() => {});
    const pulse = () => {
      if (hapticsOn && Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    };
    pulse();
    const h = setInterval(pulse, 1500);
    const auto = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => {
      clearInterval(h);
      clearTimeout(auto);
      stopSpeaking();
    };
  }, [warningAt, lang, hapticsOn, dismiss]);

  if (!active) return null;

  const guide = dodontFor('earthquake', lang);
  const safe = async () => {
    if (testing) return dismiss();
    setSent('sending');
    try {
      await sendSafeNow();
      dismiss();
    } catch {
      setSent('error');
    }
  };

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={dismiss}>
      <View style={{ flex: 1, backgroundColor: BG }}>
        <ScrollView contentContainerStyle={{ padding: 22, paddingTop: 56, gap: 14 }}>
          {testing ? (
            <Txt size={13} weight="700" color="#FFD9D4" style={{ letterSpacing: 1 }}>
              {local(['TEST. Nothing was sent.', 'टेस्ट। कुछ भेजा नहीं गया।'] as const)}
            </Txt>
          ) : null}
          <Txt size={30} weight="700" color={INK}>
            {local([`Strong shaking felt by ${phones} phones near you.`, `आपके पास ${phones} फ़ोनों ने तेज़ झटके महसूस किए।`] as const)}
          </Txt>
          <Txt size={40} weight="700" color="#FFB4AB">
            {local(['DROP. COVER. HOLD ON.', 'झुको। सिर ढको। पकड़ो।'] as const)}
          </Txt>
          {guide ? (
            <View style={{ gap: 8 }}>
              {guide.do.slice(0, 3).map((l) => (
                <Txt key={l} size={16} color={INK}>
                  {l}
                </Txt>
              ))}
              {guide.dont.slice(0, 2).map((l) => (
                <Txt key={l} size={15} color="#FFD9D4">
                  {l}
                </Txt>
              ))}
            </View>
          ) : null}
          <Txt size={13} color="#FFD9D4">
            This is a phone-to-phone estimate, not an official alert. Check official sources.
          </Txt>
          <Txt size={13} color="#FFD9D4">
            यह फ़ोन-से-फ़ोन का अनुमान है, आधिकारिक अलर्ट नहीं। आधिकारिक स्रोत देखें।
          </Txt>
          <Btn
            size="lg"
            icon="check"
            label={
              sent === 'sending'
                ? local(['Sending...', 'भेज रहे हैं...'] as const)
                : sent === 'error'
                  ? local(['Could not send. Try again', 'भेज नहीं पाए। फिर कोशिश करें'] as const)
                  : local(['I am safe', 'मैं सुरक्षित हूँ'] as const)
            }
            onPress={() => void safe()}
            disabled={sent === 'sending'}
          />
          <Btn size="lg" kind="secondary" label={local(['This is a false alarm', 'यह झूठा अलार्म है'] as const)} onPress={dismiss} />
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Small non-blocking chip for a "possible" verdict. Mount near the top of the app root. */
export function ShakeChip() {
  const local = useLocal();
  const nearby = useQuake((s) => s.nearbyFelt);
  const warning = useQuake((s) => s.warningAt !== null);
  if (!nearby || warning) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={{ position: 'absolute', top: 48, alignSelf: 'center', backgroundColor: '#F7E6A8', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 }}
    >
      <Txt size={13} weight="600" color="#5C4700">
        {local(['Shaking felt by a phone nearby', 'पास के एक फ़ोन ने झटका महसूस किया'] as const)}
      </Txt>
    </View>
  );
}
