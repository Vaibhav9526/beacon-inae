import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { router } from 'expo-router';
import * as VideoThumbnails from 'expo-video-thumbnails';
import React, { useRef, useState } from 'react';
import { Image, Platform, TextInput, View } from 'react-native';
import { Icon } from '../../components/Icon';
import { Screen } from '../../components/Screen';
import { Btn, Card, Chip, Press, Row, Txt, useTheme } from '../../components/ui';
import { useT } from '../../i18n';
import { currentPlace, submitReport } from '../../services/reports';
import { radius } from '../../theme';

interface Shot {
  kind: 'photo' | 'video';
  uri: string;
  mime: string;
  thumbUri?: string;
  capturedAt: number;
}

/**
 * Live-capture only. There is deliberately no "choose from gallery" anywhere: a report must be recorded here, now,
 * with the time and place attached, so old or borrowed pictures cannot be passed off as new.
 */
export default function NewReport() {
  const { p } = useTheme();
  const t = useT();
  const cam = useRef<CameraView>(null);
  const [perm, askPerm] = useCameraPermissions();
  const [mic, askMic] = useMicrophonePermissions();
  const [mode, setMode] = useState<'picture' | 'video'>('picture');
  const [recording, setRecording] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | 'sent' | 'queued' | 'rejected'>(null);
  const [error, setError] = useState('');

  if (Platform.OS === 'web') {
    return (
      <Screen title={t('postReport')}>
        <Txt size={13}>{t('captureOnly')}</Txt>
      </Screen>
    );
  }

  if (!perm?.granted) {
    return (
      <Screen title={t('postReport')}>
        <Card style={{ gap: 12, alignItems: 'center', paddingVertical: 24 }}>
          <Icon name="camera" size={26} color={p.muted} />
          <Txt size={13} color={p.muted} style={{ textAlign: 'center' }}>
            {t('captureOnly')}
          </Txt>
          <Btn label={t('continue')} onPress={() => void askPerm()} />
        </Card>
      </Screen>
    );
  }

  const snap = async () => {
    const pic = await cam.current?.takePictureAsync({ quality: 0.55, skipProcessing: false });
    if (pic) setShot({ kind: 'photo', uri: pic.uri, mime: 'image/jpeg', capturedAt: Date.now() });
  };

  const record = async () => {
    if (recording) {
      cam.current?.stopRecording();
      return;
    }
    if (!mic?.granted) await askMic();
    setRecording(true);
    const started = Date.now();
    try {
      const v = await cam.current?.recordAsync({ maxDuration: 15 });
      if (v?.uri) {
        let thumbUri: string | undefined;
        try {
          thumbUri = (await VideoThumbnails.getThumbnailAsync(v.uri, { time: 1000, quality: 0.5 })).uri;
        } catch {
          /* no poster frame: moderators will review it by hand */
        }
        setShot({ kind: 'video', uri: v.uri, mime: 'video/mp4', thumbUri, capturedAt: started });
      }
    } finally {
      setRecording(false);
    }
  };

  const submit = async () => {
    if (!shot) return;
    setBusy(true);
    setError('');
    const place = await currentPlace();
    if (!place) {
      setError('No location yet. Turn on location and try again.');
      setBusy(false);
      return;
    }
    const r = await submitReport({ kind: shot.kind, uri: shot.uri, mime: shot.mime, thumbUri: shot.thumbUri, caption: caption.trim(), capturedAt: shot.capturedAt, lat: place.lat, lon: place.lon });
    setBusy(false);
    setDone(r.result);
    if (r.error) setError(r.error);
  };

  if (done) {
    return (
      <Screen title={t('postReport')}>
        <Card style={{ alignItems: 'center', gap: 12, paddingVertical: 24 }}>
          <Icon name={done === 'rejected' ? 'alert' : 'check'} size={28} color={done === 'rejected' ? p.danger : p.ok} />
          <Txt size={14} weight="500" style={{ textAlign: 'center' }}>
            {done === 'sent' ? t('reportChecking') : done === 'queued' ? t('reportQueued') : error}
          </Txt>
          <Btn label={t('done')} onPress={() => router.back()} />
        </Card>
      </Screen>
    );
  }

  if (shot) {
    return (
      <Screen title={t('postReport')}>
        <View style={{ borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000', height: 300, alignItems: 'center', justifyContent: 'center' }}>
          <Image source={{ uri: shot.kind === 'video' ? (shot.thumbUri ?? shot.uri) : shot.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          {shot.kind === 'video' ? (
            <View style={{ position: 'absolute' }}>
              <Icon name="playTri" size={34} color="#fff" fill="#fff" />
            </View>
          ) : null}
        </View>
        <TextInput value={caption} onChangeText={setCaption} placeholder={t('caption')} placeholderTextColor={p.muted} maxLength={140} style={{ backgroundColor: p.card, borderRadius: radius.md, paddingHorizontal: 14, height: 46, color: p.text, fontSize: 14, borderWidth: 1, borderColor: p.border, fontFamily: 'Lexend_400Regular', paddingVertical: 0 }} />
        <Txt size={11.5} color={p.muted}>
          {t('captureOnly')}
        </Txt>
        {error ? <Txt size={12} color={p.danger}>{error}</Txt> : null}
        <Row style={{ gap: 8 }}>
          <Btn label={t('cancel')} kind="ghost" onPress={() => setShot(null)} />
          <View style={{ flex: 1 }}>
            <Btn label={busy ? '…' : t('submitReport')} icon="send" onPress={() => void submit()} disabled={busy} />
          </View>
        </Row>
      </Screen>
    );
  }

  return (
    <Screen title={t('postReport')} scroll={false}>
      <View style={{ flex: 1, margin: 12, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#000' }}>
        <CameraView ref={cam} style={{ flex: 1 }} facing="back" mode={mode} videoQuality="480p" mute={false} />
        <View style={{ position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
          <Chip icon="camera" label="Photo" active={mode === 'picture'} onPress={() => !recording && setMode('picture')} />
          <Chip icon="playTri" label="Video 15s" active={mode === 'video'} onPress={() => !recording && setMode('video')} />
        </View>
        <View style={{ position: 'absolute', bottom: 22, left: 0, right: 0, alignItems: 'center' }}>
          <Press accessibilityRole="button" accessibilityLabel={mode === 'picture' ? 'Take photo' : recording ? 'Stop' : 'Record'} onPress={mode === 'picture' ? snap : record} style={{ width: 70, height: 70, borderRadius: 35, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: 'rgba(255,255,255,0.5)' }}>
            <View style={{ width: recording ? 24 : 50, height: recording ? 24 : 50, borderRadius: recording ? 6 : 25, backgroundColor: mode === 'video' ? '#D14B4B' : '#fff', borderWidth: mode === 'picture' ? 2 : 0, borderColor: '#bbb' }} />
          </Press>
        </View>
      </View>
      <Txt size={11.5} color={p.muted} style={{ textAlign: 'center', paddingHorizontal: 20, paddingBottom: 12 }}>
        {t('captureOnly')}
      </Txt>
    </Screen>
  );
}
