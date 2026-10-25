import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useRef, useState } from 'react';
import { Platform, TextInput, View } from 'react-native';
import { useLocal } from '../i18n';
import type { T } from '../kb/types';
import { encodeKey } from '../services/breadcrumbs';
import { ensureKey, importKey, makeNewKey, useFamilyKey } from '../state/familyKey';
import { fonts, radius } from '../theme';
import { MedicalQr } from './MedicalQr';
import { Btn, Card, Txt, useTheme } from './ui';

const P_SHOW: T = ['Show family key', 'परिवार की चाबी दिखाएँ'];
const P_HIDE: T = ['Hide', 'छिपाएँ'];
const P_SCAN: T = ['Scan family key', 'परिवार की चाबी स्कैन करें'];
const P_PASTE: T = ['Paste key instead', 'चाबी पेस्ट करें'];
const P_WARN: T = [
  'Do not share this QR with anyone outside your family. Whoever has it can read your family notes.',
  'यह QR परिवार के बाहर किसी को न दें। जिसके पास यह है, वह आपके परिवार के नोट पढ़ सकता है।',
];
const P_DONE: T = ['This phone now shares notes with your family.', 'यह फ़ोन अब आपके परिवार के साथ नोट साझा करता है।'];
const P_BAD: T = ['That is not a family key.', 'यह परिवार की चाबी नहीं है।'];
const P_CAM: T = [
  'Camera access is needed to scan. You can paste the key instead.',
  'स्कैन के लिए कैमरा चाहिए। आप चाबी पेस्ट भी कर सकते हैं।',
];
const P_NEW: T = ['Make a new key', 'नई चाबी बनाएँ'];
const P_NEW_WHY: T = [
  'Old notes become unreadable, and every family phone must scan the new key again. Use this only if the old key leaked.',
  'पुराने नोट पढ़े नहीं जा सकेंगे और हर पारिवारिक फ़ोन को नई चाबी फिर स्कैन करनी होगी। केवल तब करें जब पुरानी चाबी लीक हुई हो।',
];
const P_SURE: T = ['Yes, make a new key', 'हाँ, नई चाबी बनाएँ'];
const P_CANCEL: T = ['Cancel', 'रद्द करें'];
const P_USE: T = ['Use this key', 'यह चाबी इस्तेमाल करें'];
const P_PLACEHOLDER: T = ['Paste BCNKEY1:... here', 'BCNKEY1:... यहाँ पेस्ट करें'];
const P_HAVE: T = ['A family key is set on this phone.', 'इस फ़ोन में परिवार की चाबी लगी है।'];
const P_NONE: T = ['No family key yet.', 'अभी परिवार की चाबी नहीं है।'];

type Mode = 'idle' | 'show' | 'scan' | 'paste';

/** Show, scan, paste or renew the family key. The key never leaves the phone except as the QR/text the person shows. */
export function FamilyKeyShare({ onChanged }: { onChanged?: () => void }) {
  const { p } = useTheme();
  const L = useLocal();
  const hasKey = useFamilyKey((s) => s.key != null);
  const [mode, setMode] = useState<Mode>('idle');
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [qr, setQr] = useState('');
  const [confirmNew, setConfirmNew] = useState(false);
  const [perm, askPerm] = useCameraPermissions();
  const lock = useRef(false);

  const finish = (ok: boolean) => {
    setMsg({ ok, t: L(ok ? P_DONE : P_BAD) });
    if (ok) {
      setMode('idle');
      setText('');
      onChanged?.();
    }
  };

  const show = async () => {
    setQr(encodeKey(await ensureKey()));
    setMsg(null);
    setMode('show');
    onChanged?.();
  };

  const scan = async () => {
    if (Platform.OS === 'web') return setMode('paste');
    if (!perm?.granted && !(await askPerm()).granted) {
      setMsg({ ok: false, t: L(P_CAM) });
      return setMode('paste');
    }
    lock.current = false;
    setMsg(null);
    setMode('scan');
  };

  const renew = async () => {
    const k = await makeNewKey();
    setQr(encodeKey(k));
    setConfirmNew(false);
    setMsg(null);
    setMode('show');
    onChanged?.();
  };

  if (mode === 'scan') {
    return (
      <View style={{ gap: 12 }}>
        <View style={{ height: 320, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000' }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={async ({ data }) => {
              if (lock.current) return;
              lock.current = true;
              const ok = await importKey(data);
              if (ok) finish(true);
              else {
                setMsg({ ok: false, t: L(P_BAD) });
                setTimeout(() => (lock.current = false), 1500);
              }
            }}
          />
        </View>
        {msg && !msg.ok ? <Txt size={12.5} color={p.danger}>{msg.t}</Txt> : null}
        <Btn kind="ghost" label={L(P_CANCEL)} icon="close" onPress={() => setMode('idle')} />
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <Txt size={13} style={{ opacity: 0.75 }}>
        {L(hasKey ? P_HAVE : P_NONE)}
      </Txt>

      {msg ? (
        <Card tint={msg.ok ? 'green' : 'pink'} style={{ padding: 12 }}>
          <Txt size={13} weight="600">{msg.t}</Txt>
        </Card>
      ) : null}

      {mode === 'show' ? (
        <Card style={{ gap: 12, alignItems: 'center' }}>
          <MedicalQr text={qr} size={220} />
          <Txt size={11} selectable style={{ fontFamily: fonts.regular, opacity: 0.8 }}>
            {qr}
          </Txt>
          <Card tint="yellow" style={{ padding: 12, alignSelf: 'stretch' }}>
            <Txt size={12.5} weight="600">{L(P_WARN)}</Txt>
          </Card>
          <Btn kind="ghost" label={L(P_HIDE)} onPress={() => setMode('idle')} />
        </Card>
      ) : null}

      {mode === 'paste' ? (
        <View style={{ gap: 8 }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={L(P_PLACEHOLDER)}
            placeholderTextColor={p.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={{ borderWidth: 1, borderColor: p.border, borderRadius: radius.md, padding: 12, color: p.text, fontFamily: fonts.regular, backgroundColor: p.card }}
          />
          <Btn label={L(P_USE)} disabled={!text.trim()} onPress={async () => finish(await importKey(text))} />
        </View>
      ) : null}

      {mode !== 'show' ? <Btn label={L(P_SHOW)} icon="qr" onPress={show} /> : null}
      <Btn kind="secondary" label={L(P_SCAN)} icon="camera" onPress={scan} />
      {mode !== 'paste' ? <Btn kind="ghost" label={L(P_PASTE)} onPress={() => setMode('paste')} /> : null}

      {hasKey ? (
        confirmNew ? (
          <Card tint="pink" style={{ gap: 8 }}>
            <Txt size={12.5}>{L(P_NEW_WHY)}</Txt>
            <Btn kind="danger" label={L(P_SURE)} onPress={renew} />
            <Btn kind="ghost" label={L(P_CANCEL)} onPress={() => setConfirmNew(false)} />
          </Card>
        ) : (
          <Btn kind="ghost" label={L(P_NEW)} icon="refresh" onPress={() => setConfirmNew(true)} />
        )
      ) : null}
    </View>
  );
}
