import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useState } from 'react';
import { Modal, Platform, View } from 'react-native';
import { type PersonaKey, PERSONAS } from '../../ai/persona';
import { GuideBrowser } from '../../components/GuideBrowser';
import { PersonaChat } from '../../components/PersonaChat';
import { PixelAvatar, cast } from '../../components/PixelAvatar';
import { Screen } from '../../components/Screen';
import { Btn, Card, Chip, Press, Row, Txt, useTheme } from '../../components/ui';
import { useLang, useLocal, useT } from '../../i18n';
import { PHOTO_CHOICES, describeImage } from '../../services/vision';
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
  const [looking, setLooking] = useState(false);
  const [choices, setChoices] = useState(false);
  const [perm, askPerm] = useCameraPermissions();
  const cam = React.useRef<CameraView>(null);

  const say = (text: string) => setIncoming((x) => ({ n: x.n + 1, text }));

  const openCamera = async () => {
    if (Platform.OS === 'web') return setChoices(true);
    if (!perm?.granted && !(await askPerm()).granted) return setChoices(true);
    setCamera(true);
  };

  const shoot = async () => {
    const pic = await cam.current?.takePictureAsync({ quality: 0.5 });
    setCamera(false);
    if (!pic) return;
    setLooking(true);
    const text = await describeImage(pic.uri).catch(() => null);
    setLooking(false);
    if (text) say(text);
    else setChoices(true); // no vision model on this phone: let the person say what they see
  };

  return (
    <Screen back={false} scroll={tab === 'browse'} title={t('aidTitle')} contentStyle={tab === 'ask' ? { padding: 0 } : undefined}>
      <View style={{ paddingHorizontal: tab === 'ask' ? 16 : 0, gap: 10 }}>
        <Row style={{ gap: 6 }}>
          <Chip icon="chat" label={lang === 'hi' ? 'पूछें' : 'Ask'} active={tab === 'ask'} onPress={() => setTab('ask')} />
          <Chip icon="doc" label={t('browseGuides')} active={tab === 'browse'} onPress={() => setTab('browse')} />
        </Row>
        {tab === 'ask' ? (
          <Row style={{ gap: 8 }}>
            {(['asha', 'veer'] as PersonaKey[]).map((k) => (
              <Press key={k} onPress={() => setPersona(k)} style={{ flex: 1 }}>
                <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderColor: persona === k ? p.text : p.border }}>
                  <PixelAvatar spec={cast(k)} size={32} bg={p.tint[k === 'asha' ? 'green' : 'peach'].bg} />
                  <View style={{ flex: 1 }}>
                    <Txt size={12.5} weight="600">
                      {L(PERSONAS[k].name)}
                    </Txt>
                    <Txt size={10.5} color={p.muted} numberOfLines={1}>
                      {L(PERSONAS[k].role)}
                    </Txt>
                  </View>
                </Card>
              </Press>
            ))}
          </Row>
        ) : null}
      </View>

      {tab === 'ask' ? (
        <View style={{ flex: 1 }}>
          <PersonaChat persona={persona} incoming={incoming} onPhoto={() => void openCamera()} />
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

      <Modal visible={choices || looking} transparent animationType="fade" onRequestClose={() => setChoices(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: p.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 18, gap: 12 }}>
            {looking ? (
              <Txt size={14} weight="500" style={{ textAlign: 'center' }}>
                {t('describingPhoto')}
              </Txt>
            ) : (
              <>
                <Txt size={12.5} color={p.muted}>
                  {t('photoFailed')}
                </Txt>
                <Row style={{ flexWrap: 'wrap', gap: 6 }}>
                  {PHOTO_CHOICES.map((c) => (
                    <Chip
                      key={c.query}
                      label={lang === 'hi' ? c.hi : c.en}
                      onPress={() => {
                        setChoices(false);
                        say(c.query);
                      }}
                    />
                  ))}
                </Row>
                <Btn label={t('cancel')} kind="ghost" size="sm" onPress={() => setChoices(false)} />
              </>
            )}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
