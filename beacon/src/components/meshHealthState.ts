import type { PeerInfo } from '../mesh/node';
import type { MeshState } from '../services/mesh';

// Pure helpers for the Mesh health screen: no React, no modules with native code, so node tests can import them.

/** A peer stays "just seen" for the same minute the node uses to treat peers as fresh. */
const FRESH_MS = 60_000;

/** Human "last seen": seen 12 seconds ago, seen 5 minutes ago, seen 2 hours ago, seen 3 days ago. */
export function seenAgo(lastSeen: number, now: number): string {
  const s = Math.max(0, Math.round((now - lastSeen) / 1000));
  if (s < 60) return s === 1 ? 'seen 1 second ago' : `seen ${s} seconds ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return m === 1 ? 'seen 1 minute ago' : `seen ${m} minutes ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? 'seen 1 hour ago' : `seen ${h} hours ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'seen yesterday' : `seen ${d} days ago`;
}

/** Plain-words state of the radio, from the mesh store's status. */
export function transportLabel(status: MeshState['status'], radioAvailable: boolean): string {
  if (!radioAvailable) return 'No radio in this build: chat still works over the in-memory link';
  switch (status) {
    case 'running':
      return 'Bluetooth on';
    case 'starting':
      return 'Starting the Bluetooth radio';
    case 'no-permission':
      return 'Bluetooth permission missing';
    case 'bluetooth-off':
      return 'Bluetooth is turned off';
    case 'unsupported':
      return 'No radio here (emulator or Expo Go)';
    case 'error':
      return 'The mesh could not start';
    case 'idle':
      return 'Not started yet';
  }
}

/** Signal bar count: a direct link is strong, one passing through other phones is weak, staleness takes a bar. */
export function peerBars(peer: PeerInfo, now: number): number {
  const fresh = now - peer.lastSeen < FRESH_MS;
  return peer.direct ? (fresh ? 3 : 2) : fresh ? 1 : 0;
}

/** Messages that reached us today after hopping through other phones: the only relay count the store exposes. */
export function relayedToday(messages: { hops: number; timestamp: number }[], now: number): number {
  const start = new Date(now).setHours(0, 0, 0, 0);
  return messages.filter((m) => m.hops > 0 && m.timestamp >= start).length;
}

/** Peers we cannot reach directly: outgoing messages for them wait in the messenger's queue until another phone can forward. */
export function waitingToRelay(peers: PeerInfo[]): number {
  return peers.filter((x) => !x.direct).length;
}
