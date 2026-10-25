import React, { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { distanceKm } from '../../alerts/sources';
import { Flower, Ribbon } from '../../components/Deco';
import { Icon, type IconName } from '../../components/Icon';
import { Screen } from '../../components/Screen';
import { useKeyboardOpen } from '../../components/TabBar';
import { SkeletonList } from '../../components/Skeleton';
import { Appear, Badge, Btn, Card, Chip, Press, Row, Txt, useTheme } from '../../components/ui';
import { useT } from '../../i18n';
import { CHANNEL_LEVELS } from '../../mesh/geohash';
import type { MsgKind, PublicMessage } from '../../mesh/node';
import { cloud, cloudConfigured } from '../../services/cloud';
import { getFix, lastKnownFix } from '../../services/location';
import { useMesh } from '../../services/mesh';
import { radius } from '../../theme';

type Tab = 'chat' | 'board' | 'people' | 'sos';
const levelKey = ['channelBlock', 'channelNeighborhood', 'channelCity', 'channelProvince', 'channelRegion'] as const;
const TABS: { k: Tab; icon: IconName }[] = [
  { k: 'chat', icon: 'chat' },
  { k: 'board', icon: 'doc' },
  { k: 'people', icon: 'family' },
  { k: 'sos', icon: 'siren' },
];

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

  useEffect(() => {
    void mesh.start().then(() => mesh.refreshChannels()).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const channel = mesh.channels[level] ?? mesh.channels[0] ?? 'geo:local';
  const chat = useMemo(() => mesh.chat.filter((m) => m.channel === channel || m.channel === 'geo:local').sort((a, b) => a.timestamp - b.timestamp), [mesh.chat, channel]);
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

  const send = () => {
    const v = text.trim();
    if (!v) return;
    if (privateTo) mesh.sendPrivate(privateTo, v);
    else mesh.sendChat(channel, v, tab === 'board' ? kind : 'chat');
    setText('');
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 100);
  };

  const bubble = (m: PublicMessage) => {
    const mine = m.from === mesh.myId;
    return (
      <Appear key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
        <View style={{ backgroundColor: mine ? p.accent : p.tint.lilac.bg, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 24, borderBottomRightRadius: mine ? 6 : 24, borderBottomLeftRadius: mine ? 24 : 6, gap: 3 }}>
          <Row style={{ gap: 6 }}>
            <Txt size={11.5} weight="700" color={mine ? p.onAccent : p.tint.lilac.ink}>
              {mine ? 'You' : m.nickname}
            </Txt>
            {!mine ? <Icon name={m.verified ? 'check' : 'info'} size={11} color={p.tint.lilac.ink} /> : null}
            {m.hops > 0 ? (
              <Txt size={10} color={mine ? p.onAccent : p.tint.lilac.ink}>
                {m.hops} {t('hops')}
              </Txt>
            ) : null}
          </Row>
          <Txt size={14} color={mine ? p.onAccent : p.tint.lilac.ink}>
            {m.text}
          </Txt>
        </View>
      </Appear>
    );
  };

  return (
    <Screen back={false} scroll={false} title={t('communityTitle')} contentStyle={kbOpen ? { paddingBottom: 0 } : undefined}>
      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        <Row style={{ gap: 6, flexWrap: 'wrap' }}>
          {TABS.map(({ k, icon }) => (
            <Chip
              key={k}
              icon={icon}
              active={tab === k}
              label={k === 'chat' ? t('chat') : k === 'board' ? t('resourceBoard') : k === 'people' ? t('peopleNearby') : `SOS ${mesh.sos.length}`}
              onPress={() => {
                setTab(k);
                setPrivateTo(null);
              }}
            />
          ))}
          {tab === 'people' ? <Chip icon="bluetooth" label="Mesh health" onPress={() => router.push('/mesh')} /> : null}
        </Row>
        <Card tint="blue" style={{ overflow: 'hidden', minHeight: 84, justifyContent: 'center', paddingRight: 84 }}>
          <Txt size={12} color={p.tint.blue.ink}>
            {mesh.radioAvailable ? t('meshHint') : t('offlineNoMesh')}
          </Txt>
          <View pointerEvents="none" style={{ position: 'absolute', right: -12, top: -14, transform: [{ rotate: '12deg' }] }}>
            <Ribbon size={84} />
          </View>
        </Card>
        {tab === 'chat' && !privateTo ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {CHANNEL_LEVELS.map((l, i) => (
              <Chip key={l.name} active={level === i} label={`${t(levelKey[i])} · ${(mesh.channels[i] ?? '').replace('geo:', '').toUpperCase() || '—'}`} onPress={() => setLevel(i)} />
            ))}
          </ScrollView>
        ) : null}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
        <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 8 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })} showsVerticalScrollIndicator={false}>
          {tab === 'chat' && !privateTo && (chat.length === 0 ? <Empty text={t('nobodyYet')} /> : chat.map(bubble))}

          {tab === 'chat' && privateTo ? (
            <>
              <Btn size="sm" kind="ghost" icon="back" label={t('back')} onPress={() => setPrivateTo(null)} style={{ alignSelf: 'flex-start' }} />
              {dm.map((m) => (
                <View key={m.id} style={{ alignSelf: 'flex-start', backgroundColor: p.tint.yellow.bg, padding: 12, borderRadius: 24, borderBottomLeftRadius: 6, maxWidth: '88%' }}>
                  <Txt size={14} color={p.tint.yellow.ink}>{m.text}</Txt>
                  {m.viaCourier ? <Txt size={10} color={p.tint.yellow.ink}>via courier</Txt> : null}
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
                          {m.nickname} · {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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

        {tab !== 'people' && tab !== 'sos' ? (
          <Row style={{ padding: 12, gap: 8, backgroundColor: p.bg, borderTopWidth: 1, borderTopColor: p.border }}>
            <TextInput value={text} onChangeText={setText} onSubmitEditing={send} placeholder={t('typeMessage')} placeholderTextColor={p.muted} style={{ flex: 1, height: 40, backgroundColor: p.card, borderWidth: 1, borderColor: p.border, borderRadius: radius.pill, paddingHorizontal: 14, color: p.text, fontSize: 13.5, fontFamily: 'Poppins_400Regular', paddingVertical: 0 }} />
            <Press accessibilityLabel={t('send')} onPress={send} disabled={!text.trim()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center', opacity: text.trim() ? 1 : 0.4 }}>
              <Icon name="send" size={16} color={p.onAccent} />
            </Press>
          </Row>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
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
                {m.hops} {t('hops')} · {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Txt>
            </Card>
          </Appear>
        );
      })}
    </>
  );
}

/** Empty state: a yellow sticker card with a flower in the corner. */
function Empty({ text }: { text: string }) {
  const { p } = useTheme();
  return (
    <Card tint="yellow" style={{ overflow: 'hidden', minHeight: 110, justifyContent: 'center', paddingRight: 92 }}>
      <Txt size={15} weight="700" color={p.tint.yellow.ink}>
        {text}
      </Txt>
      <View pointerEvents="none" style={{ position: 'absolute', right: -12, top: -14, transform: [{ rotate: '12deg' }] }}>
        <Flower size={84} />
      </View>
    </Card>
  );
}
