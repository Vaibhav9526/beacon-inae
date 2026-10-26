import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import type { RadioDiagnostics } from '../../modules/beacon-mesh';
import { deliveryText } from '../mesh/radioPolicy';
import { getBleTransport, requestMeshPermission, useMesh, type MeshPerm } from '../services/mesh';
import { buildChecklist, fmtBytes, overall, signalWord, type CheckRow, type FixKind, type Level } from './meshTestState';
import { Badge, Btn, Card, Row, SectionTitle, Txt, useTheme } from './ui';

const POLL_MS = 2000;

/**
 * Live checklist for the Bluetooth mesh: every step that has to be true for two phones to talk, the peers heard,
 * traffic counters, the last error, a test message and a two-phone guide. Reads the radio itself, invents nothing.
 */
export function MeshTest() {
  const mesh = useMesh();
  const { p } = useTheme();
  const [diag, setDiag] = useState<RadioDiagnostics | null>(null);
  const [, setTick] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const t = getBleTransport();
    const d = t ? await t.diagnostics() : null;
    if (alive.current) {
      setDiag(d);
      setTick((x) => x + 1); // counters live on the transport object: re-render to show them
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void mesh.start().catch(() => {});
    void refresh();
    const h = setInterval(() => void refresh(), POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(h);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = buildChecklist(diag, { status: mesh.status, radioError: mesh.radioError, radioAvailable: mesh.radioAvailable });
  const level = overall(rows);
  const c = getBleTransport()?.counters;

  const restart = async () => {
    setBusy(true);
    try {
      await mesh.stop();
      await mesh.start();
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const fix = async (kind: FixKind) => {
    setNote(null);
    try {
      if (kind === 'restart') return await restart();
      if (kind === 'bluetooth') {
        if (Platform.OS === 'android') await Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS');
        return;
      }
      if (kind === 'locationServices') {
        if (Platform.OS === 'android') await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
        return;
      }
      const res = await requestMeshPermission(kind as MeshPerm);
      if (res === 'blocked') {
        setNote('Android will not ask again. Open Settings, then Permissions, and allow it. · Settings > Permissions में अनुमति दें।');
        await Linking.openSettings();
      }
      if (res === 'granted' && kind === 'nearby') await restart();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not open the setting');
    } finally {
      void refresh();
    }
  };

  const sendTest = () => {
    const channel = mesh.channels[1] ?? mesh.channels[0] ?? 'geo:local';
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const id = mesh.sendChat(channel, `test ${time}`);
    if (!id) {
      setNote('Not sent: the mesh is not running. · भेजा नहीं गया: मेश चालू नहीं है।');
      return;
    }
    const d = useMesh.getState().delivery[id];
    setNote(`Sent "test ${time}" on ${channel.replace('geo:', '')}. ${deliveryText(d?.neighbours ?? 0).join(' · ')}`);
  };

  const tone = level === 'ok' ? 'green' : level === 'warn' ? 'yellow' : 'pink';
  const summary =
    level === 'ok'
      ? ['Ready: the mesh can talk to other phones.', 'तैयार: मेश दूसरे फ़ोन से बात कर सकता है।']
      : level === 'warn'
        ? ['Working, but not connected to a phone yet.', 'चल रहा है, पर अभी कोई फ़ोन नहीं जुड़ा।']
        : ['Something blocks the mesh. Fix the red rows.', 'कुछ रुकावट है। लाल पंक्तियाँ ठीक करें।'];

  const nick = (linkId: string) => mesh.peers.find((x) => x.link === linkId)?.nickname;

  return (
    <View style={{ gap: 12 }}>
      <Card tint={tone} style={{ padding: 14, gap: 4 }}>
        <Txt size={15} weight="700" color={p.tint[tone].ink}>
          {summary[0]}
        </Txt>
        <Txt size={12.5} color={p.tint[tone].ink}>
          {summary[1]}
        </Txt>
        {diag ? (
          <Txt size={11} color={p.tint[tone].ink} style={{ opacity: 0.75 }}>
            {diag.manufacturer} {diag.model} · Android API {diag.apiLevel} · id {diag.token || '-'}
          </Txt>
        ) : null}
      </Card>

      <SectionTitle>Checklist · जाँच सूची</SectionTitle>
      {rows.map((r) => (
        <CheckCard key={r.id} row={r} onFix={(k) => void fix(k)} />
      ))}

      <SectionTitle>Phones · फ़ोन</SectionTitle>
      {diag && (diag.links.length > 0 || diag.nearby.length > 0) ? (
        <>
          {diag.links.map((l) => (
            <Card key={l.id} style={{ padding: 12, gap: 2 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt size={14} weight="500">
                  {nick(l.id) ?? l.id}
                </Txt>
                <Badge soft label={l.ready ? 'LINKED' : 'CONNECTING'} color={l.ready ? p.tint.green.ink : p.tint.yellow.ink} />
              </Row>
              <Txt size={11.5} color={p.muted}>
                {l.role} · signal {l.rssi != null ? `${l.rssi} dBm (${signalWord(l.rssi)})` : 'not measured'} · MTU {l.mtu} · queued {l.queued}
              </Txt>
            </Card>
          ))}
          {diag.nearby
            .filter((n) => !n.linked)
            .map((n) => (
              <Card key={n.id} style={{ padding: 12, gap: 2 }}>
                <Txt size={14} weight="500">
                  Heard, not linked · {n.addr}
                </Txt>
                <Txt size={11.5} color={p.muted}>
                  {n.rssi} dBm ({signalWord(n.rssi)}) · seen {Math.round(n.ageMs / 1000)}s ago · failed attempts {n.failures}
                </Txt>
              </Card>
            ))}
        </>
      ) : (
        <Txt size={12.5} color={p.muted}>
          No phones heard yet. · अभी कोई फ़ोन नहीं मिला।
        </Txt>
      )}

      <SectionTitle>Traffic · ट्रैफ़िक</SectionTitle>
      <Card style={{ padding: 14, gap: 4 }}>
        <Txt size={13}>
          Sent: {c?.txPackets ?? 0} packets, {fmtBytes(c?.txBytes ?? 0)}
        </Txt>
        <Txt size={13}>
          Received: {c?.rxPackets ?? 0} packets, {fmtBytes(c?.rxBytes ?? 0)}
        </Txt>
        <Txt size={11.5} color={p.muted}>
          Radio frames sent {diag?.txFrames ?? 0} · received {diag?.rxFrames ?? 0} · links up {c?.linksUp ?? 0} · down {c?.linksDown ?? 0}
        </Txt>
        <Txt size={11.5} color={p.muted}>
          Mesh: {mesh.neighbours} neighbours · {mesh.peers.length} known peers
        </Txt>
      </Card>

      <Row style={{ gap: 8, flexWrap: 'wrap' }}>
        <Btn icon="send" label="Send test message · टेस्ट संदेश" onPress={sendTest} disabled={!mesh.running} />
        <Btn kind="secondary" icon="refresh" label={busy ? 'Restarting...' : 'Restart mesh · फिर शुरू करें'} onPress={() => void restart()} disabled={busy} />
      </Row>
      {note ? <Txt size={12.5}>{note}</Txt> : null}

      <TwoPhoneGuide />
      <KeepRunningCard />
    </View>
  );
}

const DOT: Record<Level, 'green' | 'yellow' | 'pink' | 'blue'> = { ok: 'green', warn: 'yellow', bad: 'pink', na: 'blue' };

function CheckCard({ row, onFix }: { row: CheckRow; onFix: (k: FixKind) => void }) {
  const { p } = useTheme();
  const tone = DOT[row.level];
  const fixKind = row.fix;
  return (
    <Card style={{ padding: 12, gap: 4 }}>
      <Row style={{ gap: 10, alignItems: 'flex-start' }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 5, backgroundColor: p.tint[tone].ink }} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt size={14} weight="600">
            {row.title[0]} · {row.title[1]}
          </Txt>
          <Txt size={12} color={p.muted}>
            {row.detail}
          </Txt>
        </View>
        {fixKind ? (
          <Btn
            size="sm"
            kind="secondary"
            label={fixKind === 'restart' ? 'Restart' : fixKind === 'bluetooth' || fixKind === 'locationServices' ? 'Open' : 'Grant'}
            onPress={() => onFix(fixKind)}
          />
        ) : null}
      </Row>
    </Card>
  );
}

function TwoPhoneGuide() {
  const steps: [string, string][] = [
    ['Install the same Beacon APK on both phones and open it once.', 'दोनों फ़ोन पर वही Beacon APK लगाएँ और एक बार खोलें।'],
    ['Allow "Nearby devices" (and Notifications) on both. Turn Bluetooth on.', 'दोनों पर "आस-पास के डिवाइस" और सूचनाओं की अनुमति दें। Bluetooth चालू करें।'],
    ['Keep both phones within 2 metres, screens on, this screen open.', 'दोनों फ़ोन 2 मीटर के भीतर रखें, स्क्रीन चालू, यही स्क्रीन खुली।'],
    ['Wait up to 30 seconds: "Phones connected" turns green on both.', '30 सेकंड तक रुकें: दोनों पर "जुड़े हुए फ़ोन" हरा हो जाएगा।'],
    ['Press "Send test message" on phone A; open the Chat tab on phone B.', 'फ़ोन A पर "टेस्ट संदेश" दबाएँ; फ़ोन B पर Chat टैब खोलें।'],
    ['Then walk apart until the link drops, send again, and come back: it arrives late.', 'फिर दूर जाएँ जब तक लिंक टूटे, फिर भेजें, और लौटें: संदेश देर से पहुँचेगा।'],
  ];
  return (
    <Card tint="blue" style={{ padding: 14, gap: 6 }}>
      <Txt size={15} weight="700">
        Two-phone test · दो फ़ोन की जाँच
      </Txt>
      {steps.map((s, i) => (
        <Txt key={i} size={12.5}>
          {i + 1}. {s[0]} {s[1]}
        </Txt>
      ))}
    </Card>
  );
}

/** Vivo, Xiaomi, Oppo, Realme and Samsung phones stop background Bluetooth to save battery: ask the person to exempt Beacon. */
function KeepRunningCard() {
  const open = async (action: string) => {
    try {
      if (Platform.OS === 'android') await Linking.sendIntent(action);
    } catch {
      await Linking.openSettings().catch(() => {});
    }
  };
  return (
    <Card tint="lilac" style={{ padding: 14, gap: 6 }}>
      <Txt size={15} weight="700">
        Keep Beacon running · Beacon को चालू रखें
      </Txt>
      <Txt size={12.5}>
        Some phones (vivo, Xiaomi, Oppo, Realme, Samsung) stop Bluetooth apps in the background. Set Beacon to "Unrestricted" or "Don't optimise", and allow Auto-start.
      </Txt>
      <Txt size={12.5}>कुछ फ़ोन बैकग्राउंड में Bluetooth ऐप बंद कर देते हैं। Beacon को "Unrestricted" या "Don't optimise" करें और Auto-start चालू रखें।</Txt>
      <Row style={{ gap: 8, flexWrap: 'wrap' }}>
        <Btn size="sm" kind="secondary" label="Battery optimisation" onPress={() => void open('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS')} />
        <Btn size="sm" kind="secondary" label="App settings · ऐप सेटिंग" onPress={() => void Linking.openSettings()} />
      </Row>
    </Card>
  );
}
