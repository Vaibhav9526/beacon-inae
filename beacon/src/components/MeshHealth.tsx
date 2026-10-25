import React, { useEffect, useState } from 'react';
import { View, type ViewStyle } from 'react-native';
import { useMesh } from '../services/mesh';
import type { PeerInfo } from '../mesh/node';
import { Flower, Wave } from './Deco';
import { peerBars, relayedToday, seenAgo, transportLabel, waitingToRelay } from './meshHealthState';
import { Appear, Badge, Btn, Card, Row, SectionTitle, Txt, useTheme } from './ui';

/**
 * Bento of tiles about the Bluetooth mesh: phones nearby, what passed through today, what is held for later,
 * the radio state, the peers with their signal and an explainer. Reads the mesh store only; it invents nothing.
 */
export function MeshHealth() {
  const mesh = useMesh();
  const { p } = useTheme();
  // clock tick so "seen 12 seconds ago" stays honest without re-rendering every keystroke
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(h);
  }, []);

  const peers = mesh.peers;
  const direct = peers.filter((x) => x.direct).length;
  const relayed = relayedToday([...mesh.chat, ...mesh.board, ...mesh.sos], now);
  const held = waitingToRelay(peers);

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Stat tile="blue" title="Phones nearby" value={peers.length} sub={`${direct} in Bluetooth range`} />
        <Stat tile="green" title="Relayed today" value={relayed} sub="hopped through phones" />
      </View>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Stat tile="lilac" title="Waiting to send" value={held} sub="held for out-of-range peers" />
        <Stat tile="yellow" title="Direct links" value={mesh.neighbours} sub="separate radios to you" />
      </View>

      <Transport />

      <SectionTitle>Phones</SectionTitle>
      {peers.length === 0 ? (
        <EmptyPeers running={mesh.running} statusLabel={transportLabel(mesh.status, mesh.radioAvailable)} />
      ) : (
        peers.map((peer, i) => <PeerRow key={peer.id} peer={peer} now={now} index={i} />)
      )}

      <HowItWorks />
    </View>
  );
}

function Stat({ tile, title, value, sub }: { tile: 'blue' | 'green' | 'lilac' | 'yellow'; title: string; value: number; sub: string }) {
  const { p } = useTheme();
  const t = p.tint[tile];
  return (
    <Card tint={tile} style={{ flex: 1, gap: 2, minHeight: 112, justifyContent: 'center', padding: 14 }}>
      <Txt size={12.5} weight="600">
        {title}
      </Txt>
      <Txt size={42} weight="700">
        {value}
      </Txt>
      <Txt size={11.5} style={{ opacity: 0.75 }}>
        {sub}
      </Txt>
    </Card>
  );
}

function Transport() {
  const mesh = useMesh();
  const { p } = useTheme();
  const ok = mesh.running && mesh.radioAvailable && mesh.status === 'running';
  const tint = ok ? 'green' : 'yellow';
  return (
    <Card tint={tint} style={{ gap: 6, padding: 14 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt size={14.5} weight="600">
          Transport
        </Txt>
        <Badge soft label={mesh.status.toUpperCase()} color={p.tint[tint].ink} />
      </Row>
      <Txt size={12.5}>{transportLabel(mesh.status, mesh.radioAvailable)}</Txt>
      {mesh.status === 'no-permission' ? (
        <Txt size={12}>Allow the Bluetooth and location permissions for Beacon, then reopen this screen.</Txt>
      ) : null}
      {mesh.status === 'bluetooth-off' ? (
        <Txt size={12}>Turn Bluetooth on and the mesh picks up again on its own.</Txt>
      ) : null}
      <Btn
        size="sm"
        kind="ghost"
        icon="refresh"
        label="Refresh channels"
        haptic={false}
        onPress={() => void mesh.refreshChannels().catch(() => {})}
        style={{ alignSelf: 'flex-start', marginTop: 2 }}
      />
    </Card>
  );
}

function SignalBars({ bars, style }: { bars: number; style?: ViewStyle }) {
  const { p } = useTheme();
  return (
    <Row style={[{ gap: 2, alignItems: 'flex-end', height: 13 }, style]}>
      {[5, 8, 11].map((h, i) => (
        <View key={h} style={{ width: 4, height: h, borderRadius: 2, backgroundColor: i < bars ? p.accent : p.border }} />
      ))}
    </Row>
  );
}

function PeerRow({ peer, now, index }: { peer: PeerInfo; now: number; index: number }) {
  const { p } = useTheme();
  return (
    <Appear index={index}>
      <Card style={{ padding: 12, gap: 4 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row style={{ gap: 10 }}>
            <SignalBars bars={peerBars(peer, now)} />
            <View>
              <Txt size={14.5} weight="500">
                {peer.nickname || peer.id.slice(0, 6)}
              </Txt>
              <Txt size={11.5} color={p.muted}>
                {seenAgo(peer.lastSeen, now)} · {peer.direct ? 'direct link' : 'via other phones'}
              </Txt>
            </View>
          </Row>
          <Badge soft label={peer.direct ? 'DIRECT' : 'RELAYED'} color={peer.direct ? p.tint.green.ink : p.tint.yellow.ink} />
        </Row>
      </Card>
    </Appear>
  );
}

function EmptyPeers({ running, statusLabel }: { running: boolean; statusLabel: string }) {
  const { p } = useTheme();
  return (
    <Card tint="yellow" style={{ overflow: 'hidden', minHeight: 116, justifyContent: 'center', paddingRight: 96, gap: 4 }}>
      <Txt size={15} weight="700" color={p.tint.yellow.ink}>
        {running ? 'No phones nearby yet' : 'The mesh has not started yet'}
      </Txt>
      <Txt size={12} color={p.tint.yellow.ink}>
        {running
          ? 'Keep Beacon open on both phones. Another Beacon nearby appears here the moment a Bluetooth link forms.'
          : statusLabel}
      </Txt>
      <View pointerEvents="none" style={{ position: 'absolute', right: -12, top: -14, transform: [{ rotate: '12deg' }] }}>
        <Flower size={84} />
      </View>
    </Card>
  );
}

function HowItWorks() {
  const { p } = useTheme();
  return (
    <Card tint="blue" style={{ overflow: 'hidden', minHeight: 128, justifyContent: 'center', paddingRight: 100, gap: 5 }}>
      <Txt size={15} weight="700">
        How the mesh works
      </Txt>
      <Txt size={12.5}>Every phone in this list is a small relay: messages hop from phone to phone over Bluetooth.</Txt>
      <Txt size={12.5}>No internet or tower is needed, and messages can be carried further by other phones coming and going.</Txt>
      <Txt size={12.5}>Only short signed packets travel: chat, SOS, safe notes and official alerts. Nothing else leaves your phone.</Txt>
      <View pointerEvents="none" style={{ position: 'absolute', right: -10, bottom: -18, transform: [{ rotate: '-10deg' }] }}>
        <Wave size={104} />
      </View>
    </Card>
  );
}
