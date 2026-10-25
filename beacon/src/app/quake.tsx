import React from 'react';
import { View } from 'react-native';
import { Screen } from '../components/Screen';
import { Switch } from '../components/Switch';
import { Appear, Btn, Card, Row, SectionTitle, Txt, useTheme } from '../components/ui';
import { useLocal } from '../i18n';
import { useMesh } from '../services/mesh';
import { useQuake } from '../services/quakeService';
import { useQuakeSettings } from '../state/quakeSettings';

const POINTS: readonly (readonly [string, string])[] = [
  ['Your phone feels for strong, steady shaking. If three phones near each other agree within seconds, all of them show a warning.', 'आपका फ़ोन तेज़, लगातार झटकों को महसूस करता है। पास के तीन फ़ोन कुछ सेकंड में सहमत हों, तो सभी पर चेतावनी दिखती है।'],
  ['It works with no internet, over the Bluetooth mesh. At best it gives a few seconds of warning.', 'यह बिना इंटरनेट, ब्लूटूथ मेश से चलता है। ज़्यादा से ज़्यादा कुछ सेकंड की चेतावनी मिलती है।'],
  ['It only works if nearby phones also have Shake warning on, and the mesh is running.', 'यह तभी काम करता है जब पास के फ़ोनों पर भी शेक वॉर्निंग चालू हो और मेश चल रहा हो।'],
  ['A dropped phone, a bus ride or walking should not trigger it, but a false alarm is possible. You can dismiss it.', 'फ़ोन गिरने, बस में सफ़र या चलने से यह नहीं बजना चाहिए, फिर भी झूठा अलार्म हो सकता है। आप इसे बंद कर सकते हैं।'],
  ['It is never a substitute for official alerts. Always check official sources.', 'यह आधिकारिक अलर्ट का विकल्प कभी नहीं है। हमेशा आधिकारिक स्रोत देखें।'],
];

export default function QuakeScreen() {
  const local = useLocal();
  const { p } = useTheme();
  const enabled = useQuakeSettings((s) => s.enabled);
  const setEnabled = useQuakeSettings((s) => s.set);
  const running = useMesh((s) => s.running);
  const startTest = useQuake((s) => s.startTest);

  return (
    <Screen title={local(['Shake warning', 'शेक वॉर्निंग'] as const)}>
      <Appear>
        <Card tint="pink" style={{ gap: 4 }}>
          <Txt size={20} weight="700">
            {local(['Seconds of warning, no internet', 'कुछ सेकंड की चेतावनी, बिना इंटरनेट'] as const)}
          </Txt>
          <Txt size={13}>{local(['Phones near you agree over Bluetooth.', 'आपके पास के फ़ोन ब्लूटूथ पर सहमत होते हैं।'] as const)}</Txt>
        </Card>
      </Appear>

      <Card>
        <Row style={{ justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1, gap: 3 }}>
            <Txt size={15} weight="600">
              {local(['Shake warning', 'शेक वॉर्निंग'] as const)}
            </Txt>
            <Txt size={13} color={p.muted}>
              {enabled && !running
                ? local(['On, waiting for the mesh to start.', 'चालू है, मेश शुरू होने का इंतज़ार।'] as const)
                : local(['Off by default.', 'डिफ़ॉल्ट रूप से बंद।'] as const)}
            </Txt>
          </View>
          <Switch value={enabled} onValueChange={setEnabled} accessibilityLabel="Shake warning" />
        </Row>
      </Card>

      <SectionTitle>{local(['How it works and its limits', 'यह कैसे काम करता है और इसकी सीमाएँ'] as const)}</SectionTitle>
      <Card style={{ gap: 12 }}>
        {POINTS.map((t) => (
          <Txt key={t[0]} size={14}>
            {local(t)}
          </Txt>
        ))}
      </Card>

      <SectionTitle>{local(['Battery', 'बैटरी'] as const)}</SectionTitle>
      <Card>
        <Txt size={14}>
          {local([
            'It keeps the motion sensor awake, which uses a little battery. Lifeboat mode makes it check less often and less sensitively.',
            'यह मोशन सेंसर को चालू रखता है, जिससे थोड़ी बैटरी लगती है। लाइफ़बोट मोड में यह कम बार और कम संवेदनशीलता से जाँचता है।',
          ] as const)}
        </Txt>
      </Card>

      <SectionTitle>{local(['Test', 'टेस्ट'] as const)}</SectionTitle>
      <Card style={{ gap: 10 }}>
        <Txt size={14}>
          {local(['See the warning screen. It is marked TEST and never sent to other phones.', 'चेतावनी स्क्रीन देखें। इस पर TEST लिखा होता है और यह दूसरे फ़ोनों को नहीं भेजी जाती।'] as const)}
        </Txt>
        <Btn kind="secondary" label={local(['Show a test warning', 'टेस्ट चेतावनी दिखाएँ'] as const)} onPress={startTest} />
      </Card>
    </Screen>
  );
}
