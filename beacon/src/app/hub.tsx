import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useRef, useState } from 'react';
import { Linking, Platform, Pressable, TextInput, View } from 'react-native';
import { AskDesktop } from '../components/AskDesktop';
import { Bell, Shield } from '../components/Deco';
import { FamilyChat } from '../components/FamilyChat';
import { Icon, type IconName } from '../components/Icon';
import { Screen } from '../components/Screen';
import { Appear, Badge, Btn, Card, Chip, IconTile, Press, Row, Txt, useTheme, type TintName } from '../components/ui';
import { type HubPairing, pairErrorText, pairWithHub, parsePairing, unpairHub, useHub } from '../services/hub';
import { useHubFeed } from '../services/hubFeed';
import { type FeedItem, type FeedKind, type MemberRole } from '../services/wire';
import { severityColor } from '../theme';

type Tab = 'feed' | 'family' | 'ask' | 'connection';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'feed', label: 'Feed' },
  { id: 'family', label: 'Family' },
  { id: 'ask', label: 'Ask desktop' },
  { id: 'connection', label: 'Connection' },
];

/** Desktop hub: a small app on the computer that watches the weather, air, quakes and family health. */
export default function HubScreen() {
  const paired = useHub((s) => s.paired);
  return (
    <Screen title="Desktop hub">{paired ? <Paired /> : <Unpaired />}</Screen>
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
        <Card tint="lilac" style={{ gap: 6, overflow: 'hidden', paddingRight: 88, minHeight: 150 }}>
          <View pointerEvents="none" style={{ position: 'absolute', right: -14, top: -16, transform: [{ rotate: '12deg' }] }}>
            <Bell size={96} />
          </View>
          <Row>
            <IconTile name="radio" tint="lilac" size={40} color="#1A1033" />
            <Txt size={16} weight="700" color="#1A1033" style={{ flex: 1 }}>
              Not paired
            </Txt>
          </Row>
          <Txt size={13} color="#1A1033">
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
          <Txt size={12} color={p.muted} style={{ marginTop: 6 }}>
            Ask an adult for your invite QR. अपने परिवार के बड़े से इनवाइट QR माँगें।
          </Txt>
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
            placeholder='{"v":2,"hub":"...","key":"...","token":"...","relay":"...","gk":"..."}'
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
  const [tab, setTab] = useState<Tab>('feed');
  return (
    <>
      <View style={{ flexDirection: 'row', gap: 18, borderBottomWidth: 1, borderBottomColor: p.border }}>
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <Pressable key={t.id} onPress={() => setTab(t.id)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={{ paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: on ? p.text : 'transparent' }}>
              <Txt size={14} weight={on ? '600' : '400'} color={on ? p.text : p.muted}>
                {t.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
      {tab === 'feed' ? <FeedTab /> : null}
      {tab === 'family' ? <FamilyTab /> : null}
      {tab === 'ask' ? <AskDesktop /> : null}
      {tab === 'connection' ? <ConnectionTab /> : null}
    </>
  );
}

const KIND: Record<FeedKind, { icon: IconName; tint: TintName }> = {
  news: { icon: 'news', tint: 'lilac' },
  weather: { icon: 'cloud', tint: 'blue' },
  wind: { icon: 'wind', tint: 'green' },
  quake: { icon: 'zap', tint: 'peach' },
  flood: { icon: 'flood', tint: 'blue' },
  alert: { icon: 'alert', tint: 'pink' },
  health: { icon: 'heartPulse', tint: 'pink' },
  supply: { icon: 'package', tint: 'yellow' },
  advisory: { icon: 'info', tint: 'lilac' },
  chat: { icon: 'chat', tint: 'green' },
  custom: { icon: 'sparkle', tint: 'lilac' },
};

const ago = (ts: number) => {
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

function FeedTab() {
  const { p } = useTheme();
  const items = useHubFeed((s) => s.items);
  const elder = useHubFeed((s) => s.you?.role === 'elder');
  if (items.length === 0) {
    return (
      <Card tint="green" style={{ minHeight: 110, justifyContent: 'center', overflow: 'hidden', paddingRight: 90 }}>
        <Txt size={14} weight="600" color={p.tint.green.ink}>
          Nothing from the hub yet. खबरें और अलर्ट यहाँ आएँगे।
        </Txt>
        <View pointerEvents="none" style={{ position: 'absolute', right: -12, top: -14, transform: [{ rotate: '12deg' }] }}>
          <Shield size={84} />
        </View>
      </Card>
    );
  }
  return (
    <View>
      {items.map((it, i) => (
        <View key={it.id}>
          {i > 0 ? <View style={{ height: 1, backgroundColor: p.border }} /> : null}
          <FeedRow item={it} elder={elder} />
        </View>
      ))}
    </View>
  );
}

function FeedRow({ item, elder }: { item: FeedItem; elder: boolean }) {
  const { p } = useTheme();
  const [open, setOpen] = useState(false);
  const k = KIND[item.kind] ?? KIND.custom;
  const scale = elder ? 1.25 : 1;
  const safeUrl = item.url && /^https?:\/\//i.test(item.url) ? item.url : null;
  return (
    <Press onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityLabel={item.title} style={{ flexDirection: 'row', gap: 12, paddingVertical: 12 }}>
      <View style={{ width: 40 * scale, height: 40 * scale, borderRadius: 20 * scale, backgroundColor: p.tint[k.tint].bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={k.icon} size={18 * scale} color={p.tint[k.tint].ink} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Txt size={14 * scale} weight="700" numberOfLines={open ? undefined : 1}>
          {item.title}
        </Txt>
        <Txt size={13 * scale} color={p.muted} numberOfLines={open ? undefined : 1}>
          {item.body}
        </Txt>
        <Row style={{ gap: 6, flexWrap: 'wrap' }}>
          <Txt size={11.5 * scale} color={p.muted}>
            {`${item.agentName} · ${ago(item.at)}`}
          </Txt>
          {item.severity !== 'info' ? <Badge soft label={item.severity.toUpperCase()} color={severityColor(p, item.severity)} /> : null}
        </Row>
        {open && safeUrl ? (
          <Btn label="Open link" kind="ghost" size="sm" icon="link" onPress={() => void Linking.openURL(safeUrl)} style={{ alignSelf: 'flex-start' }} />
        ) : null}
      </View>
    </Press>
  );
}

const ROLE_LABEL: Record<MemberRole, string> = { adult: 'Adult', elder: 'Elder', child: 'Child' };

function FamilyTab() {
  const { p } = useTheme();
  const members = useHubFeed((s) => s.members);
  const you = useHubFeed((s) => s.you);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState<MemberRole>('elder');

  return (
    <View style={{ gap: 14 }}>
      <Card style={{ gap: 2 }}>
        {members.length === 0 ? (
          <Txt size={13} color={p.muted}>
            Members appear here once the hub has added you to the family.
          </Txt>
        ) : (
          members.map((m, i) => (
            <View key={m.id}>
              {i > 0 ? <View style={{ height: 1, backgroundColor: p.border, marginVertical: 8 }} /> : null}
              <Row style={{ gap: 12, paddingVertical: 4 }}>
                <IconTile name="me" tint={m.role === 'elder' ? 'peach' : m.role === 'child' ? 'yellow' : 'lilac'} size={36} />
                <Txt size={14} weight="600" style={{ flex: 1 }}>
                  {m.name}
                  {you?.id === m.id ? ' (you)' : ''}
                </Txt>
                <Badge soft label={ROLE_LABEL[m.role]} color={p.muted} />
              </Row>
            </View>
          ))
        )}
      </Card>

      {you?.role === 'adult' ? (
        <>
          <Btn label={adding ? 'Close' : 'Add a family member'} kind="secondary" icon="plus" onPress={() => setAdding((a) => !a)} />
          {adding ? (
            <Card style={{ gap: 10 }}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Name"
                placeholderTextColor={p.muted}
                accessibilityLabel="New member name"
                style={{ height: 42, color: p.text, fontSize: 15, borderWidth: 1, borderColor: p.border, borderRadius: 12, paddingHorizontal: 12 }}
              />
              <Row style={{ gap: 8 }}>
                {(['adult', 'elder', 'child'] as MemberRole[]).map((r) => (
                  <Chip key={r} label={ROLE_LABEL[r]} active={role === r} onPress={() => setRole(r)} />
                ))}
              </Row>
              <Txt size={12} color={p.muted}>
                Show the invite QR on the desktop Hub. The desktop makes invites, not this phone. डेस्कटॉप पर QR दिखाएँ।
              </Txt>
            </Card>
          ) : null}
        </>
      ) : null}

      <FamilyChat />
    </View>
  );
}

function ConnectionTab() {
  const { p } = useTheme();
  const paired = useHub((s) => s.paired);
  const lastSyncAt = useHub((s) => s.lastSyncAt);
  if (!paired) return null;
  const shortId = paired.hubId.slice(0, 8);
  const since = new Date(paired.pairedAt).toLocaleDateString();
  const sync = lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not yet';
  return (
    <Card tint="lilac" style={{ gap: 8, overflow: 'hidden', paddingRight: 88, minHeight: 150 }}>
      <View pointerEvents="none" style={{ position: 'absolute', right: -14, top: -16, transform: [{ rotate: '12deg' }] }}>
        <Bell size={96} />
      </View>
      <Row>
        <IconTile name="radio" tint="lilac" size={40} color="#1A1033" />
        <View style={{ flex: 1 }}>
          <Txt size={16} weight="700" color="#1A1033">
            {`Hub ${shortId}`}
          </Txt>
          <Txt size={12} color="#1A1033">
            {`Paired ${since} · Encrypted: ${paired.gk ? 'yes' : 'no, pair again'}`}
          </Txt>
          <Txt size={12} color="#1A1033">
            {`Last sync ${sync}`}
          </Txt>
        </View>
      </Row>
      <Btn kind="secondary" label="Unpair" icon="close" size="sm" onPress={unpairHub} style={{ alignSelf: 'flex-start' }} />
    </Card>
  );
}
