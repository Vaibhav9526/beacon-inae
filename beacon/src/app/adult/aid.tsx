import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Modal, Platform, View } from 'react-native';
import { type PersonaKey, PERSONAS } from '../../ai/persona';
import { GuideBrowser } from '../../components/GuideBrowser';
import { Icon } from '../../components/Icon';
import { PersonaChat } from '../../components/PersonaChat';
import { PhotoTriage } from '../../components/PhotoTriage';
import { PixelAvatar, cast } from '../../components/PixelAvatar';
import { Screen } from '../../components/Screen';
import { Btn, Chip, Press, Row, Txt, useTheme } from '../../components/ui';
import { useLang, useLocal, useT } from '../../i18n';
import { useVlm } from '../../services/vlm';
import { radius } from '../../theme';

export default function Aid() {
  const { p } = useTheme();
  const t = useT();
  const L = useLocal();
  const lang = useLang();
  const [persona, setPersona] = useState<PersonaKey>('asha');
  const [tab, setTab] = useState<'ask' | 'browse'>('ask');
  const [incoming, setIncoming] = useState<{ n: number; text: string }>({ n: 0, text: '' });
  const [camera, setCamera] = useState(false);
  // the guided photo check; uri is undefined when there is no photo (web, no permission, capture failed)
  const [triage, setTriage] = useState<{ uri?: string } | null>(null);
  const [perm, askPerm] = useCameraPermissions();
  const cam = React.useRef<CameraView>(null);
  const params = useLocalSearchParams<{ camera?: string }>();
  const autoOpened = React.useRef(false);

  const say = (text: string) => setIncoming((x) => ({ n: x.n + 1, text }));

  const openCamera = async () => {
    try {
      if (Platform.OS === 'web') return setTriage({});
      if (!perm?.granted && !(await askPerm()).granted) return setTriage({});
      setCamera(true);
    } catch {
      setTriage({});
    }
  };

  // opened from a Home tile (/adult/aid?camera=1): start the camera once
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

  return (
    <Screen back={false} scroll={tab === 'browse'} title={t('firstAidTab')} contentStyle={tab === 'ask' ? { padding: 0 } : undefined}>
      <View style={{ paddingHorizontal: tab === 'ask' ? 16 : 0, gap: 10 }}>
        <Row style={{ gap: 6 }}>
          <Chip icon="chat" label={lang === 'hi' ? 'पूछें' : 'Ask'} active={tab === 'ask'} onPress={() => setTab('ask')} />
          <Chip icon="doc" label={t('browseGuides')} active={tab === 'browse'} onPress={() => setTab('browse')} />
        </Row>
        {tab === 'ask' ? (
          <Press accessibilityRole="button" accessibilityLabel="Photo check" onPress={() => router.push('/photo' as never)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
            <Icon name="camera" size={16} color={p.text} />
            <Txt size={14} weight="600" style={{ flex: 1 }}>
              Photo check
            </Txt>
            <Icon name="next" size={14} color={p.muted} />
          </Press>
        ) : null}
        {tab === 'ask' ? (
          <Row style={{ gap: 8 }}>
            {(['asha', 'veer'] as PersonaKey[]).map((k) => {
              const on = persona === k;
              return (
                <Press key={k} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setPersona(k)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingLeft: 4, paddingRight: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? p.text : p.border, backgroundColor: on ? p.cardAlt : p.card }}>
                  <PixelAvatar spec={cast(k)} size={24} bg={p.tint[k === 'asha' ? 'green' : 'peach'].bg} />
                  <Txt size={13} weight={on ? '600' : '400'} color={p.text}>
                    {L(PERSONAS[k].name)}
                  </Txt>
                </Press>
              );
            })}
          </Row>
        ) : null}
      </View>

      {tab === 'ask' ? (
        <View style={{ flex: 1, marginTop: 12 }}>
          <PersonaChat persona={persona} incoming={incoming} onPhoto={() => void openCamera()} topPad={4} />
        </View>
      ) : (
        <GuideBrowser />
      )}

      <Modal visible={camera} animationType="slide" onRequestClose={() => setCamera(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView ref={cam} style={{ flex: 1 }} facing="back" />
          <View style={{ position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center', gap: 12 }}>
            <Press accessibilityLabel="Take photo" onPress={() => void shoot()} style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: '#fff', borderWidth: 4, borderColor: 'rgba(255,255,255,0.5)' }}>
              <View />
            </Press>
            <Btn label={t('cancel')} kind="secondary" size="sm" onPress={() => setCamera(false)} />
          </View>
        </View>
      </Modal>

      <Modal visible={triage !== null} animationType="slide" onRequestClose={() => setTriage(null)}>
        {triage ? <PhotoTriage uri={triage.uri} onClose={() => setTriage(null)} onSummary={(text) => say(text)} /> : null}
      </Modal>
    </Screen>
  );
}
