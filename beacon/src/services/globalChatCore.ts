import { sha256 } from '@noble/hashes/sha2.js';
import { toHex, utf8 } from '../mesh/bytes';
import { encodeGeohash } from '../mesh/geohash';

/** Pure helpers for the global (internet) chat. No react-native imports so they run under node tests. */

export const MAX_TEXT = 300;
export const KEEP_MESSAGES = 200;
export const POLL_MS = 6000;

export type SendStatus = 'sending' | 'failed' | 'sent';

export interface GlobalMsg {
  id: string;
  room: string;
  ts: number;
  nick: string;
  text: string;
  /** 8-hex tag of the sender, a hash of their device id */
  device: string;
  flags: string[];
  /** only set on messages this phone sent; server messages have no status */
  status?: SendStatus;
  /** human text for a failed send */
  error?: string;
}

export const RULES_TEXT = {
  en: 'Be kind. Never share your address, phone number or location. For emergencies call 112: this chat cannot send help.',
  hi: 'दयालु रहें। अपना पता, फ़ोन नंबर या लोकेशन कभी साझा न करें। आपातकाल में 112 पर कॉल करें: यह चैट मदद नहीं भेज सकती।',
};

export const OFFLINE_TEXT = {
  en: 'Global chat needs internet. The Bluetooth chat works without it.',
  hi: 'ग्लोबल चैट के लिए इंटरनेट चाहिए। ब्लूटूथ चैट इसके बिना भी चलती है।',
};

/** The short tag the server shows for a device: first 8 hex of sha256 of the device id string. */
export const deviceTagOf = (deviceId: string) => toHex(sha256(utf8(deviceId))).slice(0, 8);

/** 'region-<2 char geohash>' for a position. */
export const roomForCoords = (lat: number, lon: number) => `region-${encodeGeohash(lat, lon, 2)}`;

/** Server-confirmed messages are ordered by ts; local ones (sending or failed) keep their order at the end. */
export function mergeMessages(existing: GlobalMsg[], incoming: GlobalMsg[], cap = KEEP_MESSAGES): GlobalMsg[] {
  const byId = new Map<string, GlobalMsg>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  const all = [...byId.values()];
  const pending = all.filter((m) => m.status === 'sending' || m.status === 'failed').sort((a, b) => a.ts - b.ts);
  const done = all.filter((m) => !(m.status === 'sending' || m.status === 'failed')).sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  return [...done, ...pending].slice(-cap);
}

export const filterMuted = (msgs: GlobalMsg[], muted: readonly string[]) => {
  if (muted.length === 0) return msgs;
  const set = new Set(muted);
  return msgs.filter((m) => !set.has(m.device));
};

export function setStatus(msgs: GlobalMsg[], id: string, status: SendStatus, error?: string): GlobalMsg[] {
  return msgs.map((m) => (m.id === id ? { ...m, status, error } : m));
}

/** Swap a local echo for the message the server stored. */
export function replaceLocal(msgs: GlobalMsg[], localId: string, real: GlobalMsg): GlobalMsg[] {
  return mergeMessages(
    msgs.filter((m) => m.id !== localId),
    [real],
  );
}

/** The cursor for the next poll: newest ts among server-confirmed messages. */
export const cursorOf = (msgs: GlobalMsg[]) => msgs.reduce((c, m) => (m.status ? c : Math.max(c, m.ts)), 0);

export const canSend = (text: string) => {
  const t = text.trim();
  return t.length > 0 && t.length <= MAX_TEXT;
};

/** Friendly sentence for a failed request. */
export function errorText(status: number, fallback = ''): { en: string; hi: string } {
  if (status === 429) return { en: 'You are sending too fast', hi: 'आप बहुत तेज़ भेज रहे हैं' };
  if (status === 403) return { en: 'You are blocked from this chat', hi: 'आपको इस चैट से रोका गया है' };
  if (status === 0) return OFFLINE_TEXT;
  if (status === 413) return { en: 'That message is too long', hi: 'यह संदेश बहुत लंबा है' };
  return { en: fallback || 'Could not send. Try again.', hi: 'भेज नहीं सके। फिर कोशिश करें।' };
}

/** A fetch that never reached the server (no network, timeout, no server set). */
export const isOffline = (e: unknown) => {
  const s = (e as { status?: unknown })?.status;
  return s === 0 || e instanceof TypeError || (e as { name?: string })?.name === 'AbortError';
};
