import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useRef, useState } from 'react';
import { Platform, TextInput, View } from 'react-native';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { Appear, Badge, Btn, Card, IconTile, Row, Txt, useTheme } from '../components/ui';
import { type HubPairing, pairErrorText, pairWithHub, parsePairing, unpairHub, useHub } from '../services/hub';
import { severityColor } from '../theme';

/** Desktop hub: a small app on the computer that watches the weather, air, quakes and family health. */
export default function HubScreen() {
  const paired = useHub((s) => s.paired);
  return (
    <Screen title="Desktop hub">
      {paired ? <Paired /> : <Unpaired />}
    </Screen>
  );
}

function Unpaired() {
  const { p } = useTheme();
  const [scanning, setScanning] = useState(false);
  const [pending, setPending] = useState<HubPairing | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [code, setCode] = useState('');
  const [perm, askPerm] = useCameraPermissions();
  const lock = useRef(false);

  const choose = (raw: string) => {
    const parsed = parsePairing(raw);
    if (!parsed) {
      setErr('That is not a hub code.');
      return false;
    }
    setErr('');
    setPending(parsed);
    return true;
  };

  const openScanner = async () => {
    if (Platform.OS === 'web') return;
    if (!perm?.granted && !(await askPerm()).granted) return setErr('Camera access is needed to scan. You can paste the code instead.');
    lock.current = false;
    setErr('');
    setScanning(true);
  };

  const pair = async () => {
    if (!pending) return;
    setBusy(true);
    setErr('');
    try {
      await pairWithHub(pending);
      setPending(null);
    } catch (e) {
      setErr(pairErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (scanning) {
    return (
      <View style={{ flex: 1, gap: 12 }}>
        <View style={{ height: 360, borderRadius: 20, overflow: 'hidden', backgroundColor: '#000' }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (lock.current) return;
              if (choose(data)) {
                lock.current = true;
                setScanning(false);
              }
            }}
          />
        </View>
        <Btn kind="ghost" label="Cancel" icon="close" onPress={() => setScanning(false)} />
      </View>
    );
  }

  return (
    <>
      <Appear>
        <Card tint="lilac" style={{ gap: 6 }}>
          <Row>
            <IconTile name="radio" tint="lilac" size={36} />
            <Txt size={14} weight="600" style={{ flex: 1 }}>
              Not paired
            </Txt>
          </Row>
          <Txt size={13} color={p.muted}>
            A small app on your computer that watches weather, air, quakes and family health and warns you early.
          </Txt>
        </Card>
      </Appear>

      {pending ? (
        <Appear index={1}>
          <Card style={{ gap: 10 }}>
            <Txt size={14} weight="600">
              {`Pair with this hub? ${pending.hub.slice(0, 8)}`}
            </Txt>
            <Row style={{ gap: 8 }}>
              <Btn label="Pair" icon="link" onPress={pair} disabled={busy} size="sm" />
              <Btn label="Cancel" kind="ghost" onPress={() => setPending(null)} disabled={busy} size="sm" />
            </Row>
          </Card>
        </Appear>
      ) : (
        <Appear index={1}>
          <Btn label="Scan hub QR" icon="qr" onPress={openScanner} />
        </Appear>
      )}

      <Appear index={2}>
        <Card style={{ gap: 8 }}>
          <Txt size={12} weight="600" color={p.muted}>
            Paste pairing code
          </Txt>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder='{"v":1,"hub":"...","key":"...","token":"...","relay":"..."}'
            placeholderTextColor={p.muted}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            style={{ minHeight: 60, color: p.text, fontSize: 12, borderWidth: 1, borderColor: p.border, borderRadius: 12, padding: 10 }}
          />
          <Btn label="Use this code" kind="secondary" size="sm" disabled={!code.trim()} onPress={() => choose(code)} style={{ alignSelf: 'flex-start' }} />
        </Card>
      </Appear>

      {err ? (
        <Row style={{ gap: 6 }}>
          <Icon name="alert" size={14} color={p.muted} />
          <Txt size={12} color={p.muted}>
            {err}
          </Txt>
        </Row>
      ) : null}
    </>
  );
}

function Paired() {
  const { p } = useTheme();
  const paired = useHub((s) => s.paired);
  const messages = useHub((s) => s.messages);
  if (!paired) return null;
  const shortId = paired.hubId.slice(0, 8);
  const since = new Date(paired.pairedAt).toLocaleDateString();

  return (
    <>
      <Appear>
        <Card tint="lilac" style={{ gap: 8 }}>
          <Row>
            <IconTile name="radio" tint="lilac" size={36} />
            <View style={{ flex: 1 }}>
              <Txt size={14} weight="600">
                {`Hub ${shortId}`}
              </Txt>
              <Txt size={12} color={p.muted}>
                {`Paired ${since}`}
              </Txt>
            </View>
          </Row>
          <Btn kind="ghost" label="Unpair" icon="close" size="sm" onPress={unpairHub} style={{ alignSelf: 'flex-start' }} />
        </Card>
      </Appear>

      <Txt size={12} weight="600" color={p.muted}>
        ALERTS FROM YOUR HUB
      </Txt>

      {messages.length === 0 ? (
        <Appear index={1}>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="check" size={16} color={p.muted} />
            <Txt size={13} color={p.muted} style={{ flex: 1 }}>
              Nothing from the hub yet. It checks every 45 seconds while the app is open.
            </Txt>
          </Card>
        </Appear>
      ) : (
        [...messages].reverse().map((m, i) => (
          <Appear key={m.id} index={i + 1}>
            <Card style={{ gap: 6 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Badge soft label={m.severity.toUpperCase()} color={severityColor(p, m.severity)} />
                <Txt size={11} color={p.muted}>
                  {new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Txt>
              </Row>
              <Txt size={13}>{m.text}</Txt>
            </Card>
          </Appear>
        ))
      )}
    </>
  );
}
