import React, { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { distanceKm } from '../../alerts/sources';
import { Icon, type IconName } from '../../components/Icon';
import { Screen } from '../../components/Screen';
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

  useEffect(() => {
    void mesh.start().then(() => mesh.refreshChannels());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const channel = mesh.channels[level] ?? mesh.channels[0] ?? 'geo:local';
  const chat = useMemo(() => mesh.chat.filter((m) => m.channel === channel || m.channel === 'geo:local').sort((a, b) => a.timestamp - b.timestamp), [mesh.chat, channel]);
  const dm = useMemo(() => (privateTo ? mesh.priv.filter((m) => m.from === privateTo) : []), [mesh.priv, privateTo]);

  // posts other gateways uploaded to the server (so people beyond Bluetooth range still see them)
  const [serverBoard, setServerBoard] = useState<PublicMessage[]>([]);
  useEffect(() => {
    if (tab !== 'board' || !cloudConfigured()) return;
    void (async () => {
      try {
        const fix = await getFix({ maxWaitMs: 3000 });
        if (!fix) return;
        const r = await cloud.get<{ posts: { id: string; kind: MsgKind; text: string; nickname: string; ts: number }[] }>(`/v1/board?lat=${fix.lat}&lon=${fix.lon}`);
        setServerBoard(r.posts.map((x) => ({ id: 'srv:' + x.id, channel: 'server', from: 'server', nickname: x.nickname, text: x.text, kind: x.kind, timestamp: x.ts, verified: false, hops: 0 })));
      } catch {
        /* offline: the mesh posts are still shown */
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
        <View style={{ backgroundColor: mine ? p.accent : p.card, paddingVertical: 8, paddingHorizontal: 11, borderRadius: radius.lg, borderBottomRightRadius: mine ? 5 : radius.lg, borderBottomLeftRadius: mine ? radius.lg : 5, gap: 2, borderWidth: mine ? 0 : 1, borderColor: p.border }}>
          <Row style={{ gap: 6 }}>
            <Txt size={11.5} weight="600" color={mine ? p.onAccent : p.muted}>
              {mine ? 'You' : m.nickname}
            </Txt>
            {!mine ? <Icon name={m.verified ? 'check' : 'info'} size={11} color={m.verified ? p.ok : p.muted} /> : null}
            {m.hops > 0 ? (
              <Txt size={10} color={mine ? p.onAccent : p.muted}>
                {m.hops} {t('hops')}
              </Txt>
            ) : null}
          </Row>
          <Txt size={14} color={mine ? p.onAccent : p.text}>
            {m.text}
          </Txt>
        </View>
      </Appear>
    );
  };

  return (
    <Screen back={false} scroll={false} title={t('communityTitle')}>
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
        </Row>
        <Txt size={11} color={p.muted}>
          {mesh.radioAvailable ? t('meshHint') : t('offlineNoMesh')}
        </Txt>
        {tab === 'chat' && !privateTo ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {CHANNEL_LEVELS.map((l, i) => (
              <Chip key={l.name} active={level === i} label={`${t(levelKey[i])} · ${(mesh.channels[i] ?? '').replace('geo:', '').toUpperCase() || '—'}`} onPress={() => setLevel(i)} />
            ))}
          </ScrollView>
        ) : null}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 8 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })} showsVerticalScrollIndicator={false}>
          {tab === 'chat' && !privateTo && (chat.length === 0 ? <Txt size={13} color={p.muted}>{t('nobodyYet')}</Txt> : chat.map(bubble))}

          {tab === 'chat' && privateTo ? (
            <>
              <Btn size="sm" kind="ghost" icon="back" label={t('back')} onPress={() => setPrivateTo(null)} style={{ alignSelf: 'flex-start' }} />
              {dm.map((m) => (
                <View key={m.id} style={{ alignSelf: 'flex-start', backgroundColor: p.card, borderWidth: 1, borderColor: p.border, padding: 10, borderRadius: radius.lg, maxWidth: '88%' }}>
                  <Txt size={14}>{m.text}</Txt>
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
              {board.length === 0 ? <Txt size={13} color={p.muted}>{t('nobodyYet')}</Txt> : null}
              {board.map((m, i) => (
                <Appear key={m.id} index={i}>
                  <Card style={{ gap: 4, padding: 12 }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Badge soft label={(m.kind === 'offer' ? t('offerBoard') : t('needBoard')).toUpperCase()} color={m.kind === 'offer' ? p.ok : p.danger} />
                      <Txt size={11} color={p.muted}>
                        {m.nickname} · {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </Txt>
                    </Row>
                    <Txt size={14}>{m.text}</Txt>
                  </Card>
                </Appear>
              ))}
            </>
          ) : null}

          {tab === 'people' ? (
            mesh.peers.length === 0 ? (
              <Txt size={13} color={p.muted}>{t('nobodyYet')}</Txt>
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
            <TextInput value={text} onChangeText={setText} onSubmitEditing={send} placeholder={t('typeMessage')} placeholderTextColor={p.muted} style={{ flex: 1, height: 40, backgroundColor: p.card, borderWidth: 1, borderColor: p.border, borderRadius: radius.pill, paddingHorizontal: 14, color: p.text, fontSize: 13.5, fontFamily: 'Lexend_400Regular', paddingVertical: 0 }} />
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
  if (sos.length === 0) return <Txt size={13} color={p.muted}>{t('nobodyYet')}</Txt>;
  return (
    <>
      {[...sos].sort((a, b) => b.timestamp - a.timestamp).map((m, i) => {
        const d = here && m.lat ? Math.round(distanceKm(here, m) * 10) / 10 : null;
        return (
          <Appear key={m.id} index={i}>
            <Card style={{ gap: 4, padding: 12, borderColor: p.danger }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Row style={{ gap: 6 }}>
                  <Icon name="siren" size={14} color={p.danger} />
                  <Txt size={14.5} weight="600" color={p.danger}>
                    {m.name}
                  </Txt>
                </Row>
                <Badge soft label={m.verified ? t('verifiedOfficial') : t('unverified')} color={m.verified ? p.ok : p.muted} />
              </Row>
              <Txt size={13.5}>{m.note}</Txt>
              {m.medical ? <Txt size={12} color={p.muted}>{m.medical}</Txt> : null}
              <Txt size={11.5} color={p.muted}>
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
