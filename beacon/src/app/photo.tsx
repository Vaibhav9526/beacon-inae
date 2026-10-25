import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Platform, View } from 'react-native';
import { PhotoHelperCard } from '../components/PhotoHelperCard';
import { PhotoTriage } from '../components/PhotoTriage';
import { Screen } from '../components/Screen';
import { Btn, Card, Press, Row, Txt, useTheme } from '../components/ui';
import { useLang, useT } from '../i18n';
import { useVlm } from '../services/vlm';

/** Photo check: take a photo, get guided first-aid steps. The camera flow mirrors adult/aid.tsx. */
export default function PhotoCheck() {
  const { p } = useTheme();
  const t = useT();
  const lang = useLang();
  const hi = lang === 'hi';
  const vlm = useVlm((x) => x.status);
  const [camera, setCamera] = useState(false);
  // the guided photo check; uri is undefined when there is no photo (web, no permission, capture failed)
  const [triage, setTriage] = useState<{ uri?: string } | null>(null);
  const [perm, askPerm] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const params = useLocalSearchParams<{ camera?: string }>();
  const autoOpened = useRef(false);

  const openCamera = async () => {
    try {
      if (Platform.OS === 'web') return setTriage({});
      if (!perm?.granted && !(await askPerm()).granted) return setTriage({});
      setCamera(true);
    } catch {
      setTriage({});
    }
  };

  // opened with ?camera=1 (e.g. from the More tile): start the camera once
  useEffect(() => {
    if (params.camera === '1' && !autoOpened.current) {
      autoOpened.current = true;
      void openCamera();
    }
  }, [params.camera]);

  useEffect(() => {
    void useVlm.getState().check();
  }, []);

  const shoot = async () => {
    let uri: string | undefined;
    try {
      uri = (await cam.current?.takePictureAsync({ quality: 0.5 }))?.uri;
    } catch {
      uri = undefined; // capture failed: the guided check still works without a photo
    }
    setCamera(false);
    setTriage({ uri });
  };

  const facts = [
    vlm === 'ready' ? (hi ? 'स्मार्ट विवरण: तैयार (गलत हो सकता है)' : 'Smart description: ready (can be wrong)') : hi ? 'केवल गाइडेड जाँच' : 'Guided check only',
    hi ? 'ऑफ़लाइन काम करता है' : 'Works offline',
    hi ? 'निदान नहीं है; आपात स्थिति में 112 पर कॉल करें' : 'Not a diagnosis; call 112 in an emergency',
  ];

  return (
    <Screen title={hi ? 'फोटो जाँच' : 'Photo check'}>
      <Card tint="yellow" style={{ gap: 12, padding: 18, borderRadius: 24 }}>
        <Txt size={14} color={p.tint.yellow.ink}>
          {hi ? 'फ़ोटो लें, फिर कुछ सवालों के जवाब दें। प्राथमिक उपचार के कदम आपके जवाबों से बनते हैं, फ़ोटो से नहीं।' : 'Take a photo, then answer a few questions. The first-aid steps come from your answers, not from the photo.'}
        </Txt>
        <Txt size={13} color={p.tint.yellow.ink} style={{ opacity: 0.85 }}>
          {hi ? 'यह ऑफ़लाइन काम करता है, और फ़ोटो आपके फ़ोन से बाहर नहीं जाती।' : 'It works offline, and the photo never leaves your phone.'}
        </Txt>
        <Press
          accessibilityRole="button"
          accessibilityLabel={hi ? 'फ़ोटो लें' : 'Take a photo'}
          onPress={() => void openCamera()}
          style={{ alignSelf: 'stretch', alignItems: 'center', backgroundColor: '#000', borderRadius: 999, paddingVertical: 16 }}>
          <Txt size={16} weight="600" color="#fff">
            {hi ? 'फ़ोटो लें' : 'Take a photo'}
          </Txt>
        </Press>
      </Card>

      <View style={{ gap: 10, marginTop: 8 }}>
        <Txt size={17} weight="700">
          {hi ? 'सेटिंग्स' : 'Settings'}
        </Txt>
        <PhotoHelperCard />
        <Row style={{ gap: 6, flexWrap: 'wrap' }}>
          {facts.map((f) => (
            <Card key={f} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 }}>
              <Txt size={12} weight="500">
                {f}
              </Txt>
            </Card>
          ))}
        </Row>
      </View>

      <Modal visible={camera} animationType="slide" onRequestClose={() => setCamera(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView ref={cam} style={{ flex: 1 }} facing="back" />
          <View style={{ position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center', gap: 12 }}>
            <Press accessibilityLabel={hi ? 'फ़ोटो लें' : 'Take photo'} onPress={() => void shoot()} style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: '#fff', borderWidth: 4, borderColor: 'rgba(255,255,255,0.5)' }}>
              <View />
            </Press>
            <Btn label={t('cancel')} kind="secondary" size="sm" onPress={() => setCamera(false)} />
          </View>
        </View>
      </Modal>

      <Modal visible={triage !== null} animationType="slide" onRequestClose={() => setTriage(null)}>
        {triage ? <PhotoTriage uri={triage.uri} onClose={() => setTriage(null)} /> : null}
      </Modal>
    </Screen>
  );
}
