import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SosPanel } from '../components/SosPanel';
import { Btn, Txt } from '../components/ui';
import { useLocal } from '../i18n';
import { estimateHoursLeft, setLifeboat } from '../services/lifeboat';
import { useMesh } from '../services/mesh';
import { sendSafeNow } from '../services/sos';
import { useLifeboat } from '../state/lifeboat';

/** Near-black, low-light screen for a phone that must last. Only what matters in a disaster is here. */
const BG = '#060606';
const INK = '#EDEDED';
const MUTED = '#9A9A9A';

const TIPS: readonly (readonly [string, string])[] = [
  ['Keep airplane mode off. Bluetooth mesh needs the radio to hear neighbours.', 'मेश के लिए एयरप्लेन मोड बंद रखें। ब्लूटूथ मेश पड़ोसियों की आवाज़ सुनने के लिए रेडियो चाहता है।'],
  ['Lower the screen brightness, or turn it off and wake it only when needed.', 'स्क्रीन की चमक कम करें, या ज़रूरत पड़ने पर ही स्क्रीन चालू करें।'],
  ['Close apps you are not using. Background games and video drain the battery fast.', 'जो ऐप इस्तेमाल नहीं कर रहे उन्हें बंद करें। बैकग्राउंड में गेम और वीडियो बैटरी तेज़ी से खाते हैं।'],
  ['Turn off Wi-Fi and mobile data when there is no signal, so the phone stops searching.', 'सिग्नल न हो तो वाई-फ़ाई और मोबाइल डेटा बंद करें, ताकि फ़ोन बार-बार सिग्नल न ढूँढे।'],
];

export default function LifeboatScreen() {
  const local = useLocal();
  const insets = useSafeAreaInsets();
  const active = useLifeboat((s) => s.active);
  const battery = useLifeboat((s) => s.battery);
  const charging = useLifeboat((s) => s.charging);
  const neighbours = useMesh((s) => s.neighbours);
  const [safeNote, setSafeNote] = useState('');

  const withLifeboat = battery === null ? null : estimateHoursLeft(battery, true);
  const withoutLifeboat = battery === null ? null : estimateHoursLeft(battery, false);

  const markSafe = async () => {
    setSafeNote(local(['Sending "I am safe"...', '"मैं सुरक्षित हूँ" भेजा जा रहा है...'] as const));
    try {
      const r = await sendSafeNow();
      setSafeNote(
        r.cloud
          ? local(['Sent to your family.', 'आपके परिवार को भेज दिया गया।'] as const)
          : local(['Sent over the mesh. It will reach family when there is a connection.', 'मेश से भेज दिया गया। कनेक्शन मिलते ही परिवार तक पहुँचेगा।'] as const),
      );
    } catch {
      setSafeNote(local(['Could not send. Try again.', 'भेज नहीं पाए। फिर से कोशिश करें।'] as const));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32, paddingHorizontal: 20, gap: 22 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={local(['Close', 'बंद करें'] as const)}>
          <Txt size={14} color={MUTED}>
            {local(['Close', 'बंद करें'] as const)}
          </Txt>
        </Pressable>

        <View style={{ gap: 6 }}>
          <Txt size={28} weight="700" color={INK}>
            {local(['Lifeboat', 'लाइफ़बोट'] as const)}
          </Txt>
          <Txt size={15} color={INK}>
            {active
              ? local(['Lifeboat mode is on. Phone is saving battery.', 'लाइफ़बोट मोड चालू है। फ़ोन बैटरी बचा रहा है।'] as const)
              : local(['Lifeboat mode is off.', 'लाइफ़बोट मोड बंद है।'] as const)}
          </Txt>
        </View>

        <View style={{ gap: 6 }}>
          <Txt size={13} color={MUTED}>
            {local(['Battery', 'बैटरी'] as const)}
          </Txt>
          <Txt size={22} weight="600" color={INK}>
            {battery === null
              ? local(['Reading not available in this build', 'इस बिल्ड में बैटरी की जानकारी नहीं है'] as const)
              : `${battery}%${charging ? ` · ${local(['charging', 'चार्ज हो रहा है'] as const)}` : ''}`}
          </Txt>
          {withLifeboat !== null && withoutLifeboat !== null ? (
            <Txt size={14} color={MUTED}>
              {local([
                `About ${withLifeboat} h with Lifeboat on, about ${withoutLifeboat} h without. Estimates only.`,
                `लाइफ़बोट चालू होने पर लगभग ${withLifeboat} घंटे, बंद होने पर लगभग ${withoutLifeboat} घंटे। यह सिर्फ़ अनुमान है।`,
              ] as const)}
            </Txt>
          ) : null}
        </View>

        <SosPanel variant="adult" />

        <View style={{ gap: 10 }}>
          <Btn label={local(['I am safe', 'मैं सुरक्षित हूँ'] as const)} kind="secondary" icon="check" onPress={() => void markSafe()} />
          {safeNote ? (
            <Txt size={13} color={MUTED}>
              {safeNote}
            </Txt>
          ) : null}
        </View>

        <View style={{ gap: 4 }}>
          <Txt size={13} color={MUTED}>
            {local(['Phones nearby over Bluetooth', 'ब्लूटूथ से पास के फ़ोन'] as const)}
          </Txt>
          <Txt size={22} weight="600" color={INK}>
            {neighbours}
          </Txt>
        </View>

        <View style={{ gap: 10 }}>
          {active ? (
            <Btn label={local(['Leave lifeboat mode', 'लाइफ़बोट मोड से बाहर आएँ'] as const)} kind="ghost" onPress={() => setLifeboat(false)} />
          ) : (
            <Btn label={local(['Turn on lifeboat mode', 'लाइफ़बोट मोड चालू करें'] as const)} kind="secondary" onPress={() => setLifeboat(true)} />
          )}
        </View>

        <View style={{ gap: 12 }}>
          <Txt size={13} color={MUTED}>
            {local(['Tips to make the battery last', 'बैटरी ज़्यादा चलाने के सुझाव'] as const)}
          </Txt>
          {TIPS.map(([en, hi]) => (
            <Txt key={en} size={14} color={INK}>
              {`• ${local([en, hi] as const)}`}
            </Txt>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
