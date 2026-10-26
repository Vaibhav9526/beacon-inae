import React, { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { distanceKm } from '../../alerts/sources';
import GlobalChat from '../../components/GlobalChat';
import { Icon } from '../../components/Icon';
import { Screen } from '../../components/Screen';
import { useKeyboardOpen } from '../../components/TabBar';
import { SkeletonList } from '../../components/Skeleton';
import { Appear, Badge, Btn, Card, Chip, Press, Row, Txt, useTheme } from '../../components/ui';
import { useT } from '../../i18n';
import { CHANNEL_LEVELS } from '../../mesh/geohash';
import { deliveryText, healthDot } from '../../mesh/radioPolicy';
import type { MsgKind, PublicMessage } from '../../mesh/node';
import { cloud, cloudConfigured } from '../../services/cloud';
import { getFix, lastKnownFix } from '../../services/location';
import { useMesh } from '../../services/mesh';
import { radius } from '../../theme';

type Tab = 'chat' | 'board' | 'people' | 'sos' | 'global';
const levelKey = ['channelBlock', 'channelNeighborhood', 'channelCity', 'channelProvince', 'channelRegion'] as const;
const TABS: Tab[] = ['chat', 'global', 'board', 'people', 'sos'];

/** A channel is related to another when one cell contains the other (block inside neighbourhood, and so on). */
const related = (a: string, b: string) => a === b || a.startsWith(b) || b.startsWith(a);

const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function Community() {
  const { p } = useTheme();
  const t = useT();
  const mesh = useMesh();
  const [tab, setTab] = useState<Tab>('chat');
  const [level, setLevel] = useState(1); // neighbourhood by default
  const [text, setText] = useState('');
  const [kind, setKind] = useState<MsgKind>('need');
  const [privateTo, setPrivateTo] = useState<string | null>(null);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  // the tab bar is hidden while typing, so the composer drops the bar clearance and sits on the keyboard
  const kbOpen = useKeyboardOpen();

  const [sendNote, setSendNote] = useState<string | null>(null);
  useEffect(() => {
    void mesh.start().then(() => mesh.refreshChannels()).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // no GPS fix yet: keep trying so the channel chips fill in; until then everyone shares the 'local' room
  useEffect(() => {
    if (mesh.channels.length > 0 || !mesh.running) return;
    const h = setInterval(() => void mesh.refreshChannels().catch(() => {}), 20_000);
    return () => clearInterval(h);
  }, [mesh.channels.length, mesh.running]); // eslint-disable-line react-hooks/exhaustive-deps

  const channel = mesh.channels[level] ?? mesh.channels[0] ?? 'geo:local';
  // family drill traffic (BCN-DRILL1:) is handled by the drill screen, not shown as chat
  // without a fix every phone listens to everything; with one, the chosen cell plus the shared 'local' room
  const noFix = mesh.channels.length === 0;
  const chat = useMemo(() => mesh.chat.filter((m) => (noFix || m.channel === 'geo:local' || related(m.channel, channel)) && !m.text.startsWith('BCN-DRILL1:')).sort((a, b) => a.timestamp - b.timestamp), [mesh.chat, channel, noFix]);
  const dm = useMemo(() => (privateTo ? mesh.priv.filter((m) => m.from === privateTo) : []), [mesh.priv, privateTo]);

  // posts other gateways uploaded to the server (so people beyond Bluetooth range still see them)
  const [serverBoard, setServerBoard] = useState<PublicMessage[]>([]);
  const [boardLoading, setBoardLoading] = useState(false);
  useEffect(() => {
    if (tab !== 'board' || !cloudConfigured()) return;
    setBoardLoading(true);
    void (async () => {
      try {
        const fix = await getFix({ maxWaitMs: 3000 });
        if (!fix) return;
        const r = await cloud.get<{ posts: { id: string; kind: MsgKind; text: string; nickname: string; ts: number }[] }>(`/v1/board?lat=${fix.lat}&lon=${fix.lon}`);
        setServerBoard(r.posts.map((x) => ({ id: 'srv:' + x.id, channel: 'server', from: 'server', nickname: x.nickname, text: x.text, kind: x.kind, timestamp: x.ts, verified: false, hops: 0 })));
      } catch {
        /* offline: the mesh posts are still shown */
      } finally {
        setBoardLoading(false);
      }
    })();
  }, [tab]);
  const board = useMemo(() => {
    const seen = new Set<string>();
    return [...mesh.board, ...serverBoard]
      .filter((m) => {
        const k = `${m.nickname}|${m.text}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [mesh.board, serverBoard]);

  const send = async () => {
    const v = text.trim();
    if (!v) return;
    setSendNote(null);
    if (!mesh.running) await mesh.start().catch(() => {});
    if (privateTo) mesh.sendPrivate(privateTo, v);
    else if (mesh.sendChat(channel, v, tab === 'board' ? kind : 'chat') === null) {
      setSendNote('Not sent: the mesh is not running. Open Mesh status. · भेजा नहीं गया: मेश चालू नहीं है।');
      return;
    }
    setText('');
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 100);
  };

  // a run is consecutive messages from one sender: only the first bubble of a run shows the nickname
  const bubble = (m: PublicMessage, grouped: boolean) => {
    const mine = m.from === mesh.myId;
    return (
      <Appear key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '78%', marginTop: grouped ? 0 : 8 }}>
        {!mine && !grouped ? (
          <Row style={{ gap: 5, paddingHorizontal: 4, marginBottom: 3 }}>
            <Txt size={11.5} color={p.muted}>
              {m.nickname}
            </Txt>
            {m.verified ? <Icon name="check" size={10} color={p.muted} /> : null}
            {m.hops > 0 ? (
              <Txt size={10.5} color={p.muted}>
                {m.hops} {t('hops')}
              </Txt>
            ) : null}
          </Row>
        ) : null}
        <View style={{ backgroundColor: mine ? p.brand : p.card, borderWidth: mine ? 0 : 1, borderColor: p.border, borderRadius: 18, paddingVertical: 8, paddingHorizontal: 12, gap: 2 }}>
          <Txt size={14} color={mine ? p.onBrand : p.text}>
            {m.text}
          </Txt>
          <Txt size={10} color={mine ? p.onBrand : p.muted} style={{ alignSelf: 'flex-end', opacity: 0.7 }}>
            {clock(m.timestamp)}
          </Txt>
        </View>
        {mine && mesh.delivery[m.id] ? (
          <Txt size={10.5} color={p.muted} style={{ alignSelf: 'flex-end', marginTop: 2, textAlign: 'right' }}>
            {deliveryText(mesh.delivery[m.id].neighbours).join(' · ')}
          </Txt>
        ) : null}
      </Appear>
    );
  };

  return (
    <Screen back={false} scroll={false} title={t('communityTitle')} contentStyle={kbOpen ? { paddingBottom: 0 } : undefined}>
      <View style={{ paddingHorizontal: 16, gap: 10 }}>
        <Row style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          {TABS.map((k) => (
            <TextTab
              key={k}
              active={tab === k}
              label={k === 'chat' ? t('chat') : k === 'global' ? 'Global / वैश्विक' : k === 'board' ? t('resourceBoard') : k === 'people' ? t('peopleNearby') : `SOS ${mesh.sos.length}`}
              onPress={() => {
                setTab(k);
                setPrivateTo(null);
              }}
            />
          ))}
          <MeshChip />
          {tab === 'people' ? (
            <Press accessibilityRole="link" onPress={() => router.push('/mesh')} style={{ paddingVertical: 6, marginLeft: 'auto' }}>
              <Txt size={12.5} color={p.muted}>
                Mesh health
              </Txt>
            </Press>
          ) : null}
        </Row>
        {tab === 'chat' ? (
          <Txt size={12} color={p.muted}>
            {mesh.radioAvailable ? 'Messages hop between phones over Bluetooth' : t('offlineNoMesh')}
          </Txt>
        ) : null}
        {tab === 'chat' && mesh.radioAvailable && mesh.radioError ? (
          <Press accessibilityRole="link" onPress={() => router.push('/meshtest')}>
            <Txt size={12} color={p.tint.yellow.ink}>
              {mesh.radioError} · Fix it · ठीक करें
            </Txt>
          </Press>
        ) : null}
        {sendNote ? <Txt size={12} color={p.tint.pink.ink}>{sendNote}</Txt> : null}
        {tab === 'chat' && !privateTo ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {CHANNEL_LEVELS.map((l, i) => {
              const active = level === i;
              return (
                <Press
                  key={l.name}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setLevel(i)}
                  style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: active ? p.text : p.border, backgroundColor: active ? p.cardAlt : 'transparent' }}
                >
                  <Txt size={12} weight={active ? '600' : '400'} color={active ? p.text : p.muted}>
                    {`${t(levelKey[i])} · ${(mesh.channels[i] ?? '').replace('geo:', '').toUpperCase() || '—'}`}
                  </Txt>
                </Press>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      {tab === 'global' ? <GlobalChat /> : null}
      <KeyboardAvoidingView style={{ flex: tab === 'global' ? 0 : 1, display: tab === 'global' ? 'none' : 'flex' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
        <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, gap: 8 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })} showsVerticalScrollIndicator={false}>
          {tab === 'chat' && !privateTo ? (chat.length === 0 ? <Empty text="No messages yet. Say hello." /> : chat.map((m, i) => bubble(m, chat[i - 1]?.from === m.from))) : null}

          {tab === 'chat' && privateTo ? (
            <>
              <Btn size="sm" kind="ghost" icon="back" label={t('back')} onPress={() => setPrivateTo(null)} style={{ alignSelf: 'flex-start' }} />
              {dm.map((m) => (
                <View key={m.id} style={{ alignSelf: 'flex-start', maxWidth: '78%', backgroundColor: p.card, borderWidth: 1, borderColor: p.border, borderRadius: 18, paddingVertical: 8, paddingHorizontal: 12 }}>
                  <Txt size={14} color={p.text}>{m.text}</Txt>
                  {m.viaCourier ? <Txt size={10} color={p.muted}>via courier</Txt> : null}
                </View>
              ))}
            </>
          ) : null}

          {tab === 'board' ? (
            <>
              <Row style={{ gap: 6 }}>
                <Chip icon="alert" label={t('askHelp')} active={kind === 'need'} onPress={() => setKind('need')} />
                <Chip icon="heart" label={t('offerHelp')} active={kind === 'offer'} onPress={() => setKind('offer')} />
              </Row>
              {board.length === 0 && boardLoading ? <SkeletonList n={3} /> : null}
              {board.length === 0 && !boardLoading ? <Empty text={t('nobodyYet')} /> : null}
              {board.map((m, i) => {
                const bt = p.tint[m.kind === 'offer' ? 'green' : 'pink'];
                return (
                  <Appear key={m.id} index={i}>
                    <Card tint={m.kind === 'offer' ? 'green' : 'pink'} style={{ gap: 6, padding: 14, borderRadius: 24 }}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Badge soft label={(m.kind === 'offer' ? t('offerBoard') : t('needBoard')).toUpperCase()} color={bt.ink} />
                        <Txt size={11} color={bt.ink}>
                          {m.nickname} · {clock(m.timestamp)}
                        </Txt>
                      </Row>
                      <Txt size={14} color={bt.ink}>{m.text}</Txt>
                    </Card>
                  </Appear>
                );
              })}
            </>
          ) : null}

          {tab === 'people' ? (
            mesh.peers.length === 0 ? (
              <Empty text={t('nobodyYet')} />
            ) : (
              mesh.peers.map((peer, i) => (
                <Appear key={peer.id} index={i}>
                  <Card style={{ padding: 12 }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <View>
                        <Txt size={14.5} weight="500">
                          {peer.nickname || peer.id.slice(0, 6)}
                        </Txt>
                        <Txt size={11.5} color={p.muted}>
                          {peer.direct ? 'direct' : 'via relay'} · {Math.max(0, Math.round((Date.now() - peer.lastSeen) / 1000))}s
                        </Txt>
                      </View>
                      <Btn
                        size="sm"
                        kind="secondary"
                        icon="lock"
                        label={t('private')}
                        onPress={() => {
                          setPrivateTo(peer.id);
                          setTab('chat');
                        }}
                      />
                    </Row>
                  </Card>
                </Appear>
              ))
            )
          ) : null}

          {tab === 'sos' ? <SosHeard /> : null}
        </ScrollView>

        {tab !== 'people' && tab !== 'sos' && tab !== 'global' ? (
          <Row style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12, gap: 8 }}>
            <TextInput value={text} onChangeText={setText} onSubmitEditing={() => void send()} placeholder={t('typeMessage')} placeholderTextColor={p.muted} style={{ flex: 1, height: 42, backgroundColor: p.card, borderWidth: 1, borderColor: p.border, borderRadius: 21, paddingHorizontal: 16, color: p.text, fontSize: 14, fontFamily: 'Poppins_400Regular', paddingVertical: 0 }} />
            <Press accessibilityLabel={t('send')} onPress={() => void send()} disabled={!text.trim()} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center', opacity: text.trim() ? 1 : 0.4 }}>
              <Icon name="send" size={16} color={p.onAccent} />
            </Press>
          </Row>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** Small 'Mesh status' chip: a red / amber / green dot that opens the on-device self-test. */
function MeshChip() {
  const { p } = useTheme();
  const status = useMesh((s) => s.status);
  const links = useMesh((s) => s.neighbours);
  const dot = healthDot({ status, links });
  const color = dot === 'green' ? p.tint.green.ink : dot === 'amber' ? p.tint.yellow.ink : p.tint.pink.ink;
  return (
    <Press
      accessibilityRole="link"
      accessibilityLabel="Mesh status"
      onPress={() => router.push('/meshtest')}
      style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: p.border }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Txt size={11.5} color={p.muted}>
        Mesh status · मेश स्थिति
      </Txt>
    </Press>
  );
}

/** Plain text tab: bold ink when active, muted otherwise. */
function TextTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { p } = useTheme();
  return (
    <Press accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={{ paddingVertical: 6, paddingRight: 14 }}>
      <Txt size={14} weight={active ? '600' : '400'} color={active ? p.text : p.muted}>
        {label}
      </Txt>
    </Press>
  );
}

function SosHeard() {
  const { p } = useTheme();
  const t = useT();
  const sos = useMesh((s) => s.sos);
  const [here, setHere] = useState<{ lat: number; lon: number } | null>(null);
  useEffect(() => {
    void lastKnownFix().then(setHere);
  }, []);
  if (sos.length === 0) return <Empty text={t('nobodyYet')} />;
  return (
    <>
      {[...sos].sort((a, b) => b.timestamp - a.timestamp).map((m, i) => {
        const d = here && m.lat ? Math.round(distanceKm(here, m) * 10) / 10 : null;
        return (
          <Appear key={m.id} index={i}>
            <Card tint="pink" style={{ gap: 5, padding: 14, borderRadius: 24 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Row style={{ gap: 6 }}>
                  <Icon name="siren" size={14} color={p.tint.pink.ink} />
                  <Txt size={14.5} weight="700" color={p.tint.pink.ink}>
                    {m.name}
                  </Txt>
                </Row>
                <Badge soft label={m.verified ? t('verifiedOfficial') : t('unverified')} color={p.tint.pink.ink} />
              </Row>
              <Txt size={13.5} color={p.tint.pink.ink}>{m.note}</Txt>
              {m.medical ? <Txt size={12} color={p.tint.pink.ink}>{m.medical}</Txt> : null}
              <Txt size={11.5} color={p.tint.pink.ink} style={{ opacity: 0.8 }}>
                {d !== null ? `${d} km · ` : ''}
                {m.hops} {t('hops')} · {clock(m.timestamp)}
              </Txt>
            </Card>
          </Appear>
        );
      })}
    </>
  );
}

/** Empty state: centered muted text. */
function Empty({ text }: { text: string }) {
  const { p } = useTheme();
  return (
    <View style={{ paddingVertical: 36, alignItems: 'center' }}>
      <Txt size={14} color={p.muted} style={{ textAlign: 'center' }}>
        {text}
      </Txt>
    </View>
  );
}
