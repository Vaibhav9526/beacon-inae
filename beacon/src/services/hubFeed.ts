// What the phone knows from the desktop hub: feed items, family members, group chat and asks.
// The reducers are pure (tested in __tests__/hubFeed.test.ts). The store wraps them; hub.ts feeds it and persists it.

import { create } from 'zustand';
import type { FeedItem, GroupMessage, WireMember, WireMessage } from './wire';

export const MAX_FEED_ITEMS = 100;
export const MAX_CHAT = 200;
export const MAX_ASKS = 30;
export const MAX_NOTIFIED = 300;

export interface AskEntry {
  text: string;
  answer?: string;
  ok?: boolean;
  at: number;
}

export interface HubFeedData {
  /** newest first, at most 100, unique by id */
  items: FeedItem[];
  members: WireMember[];
  /** the member this phone is, from the hub's `members` message; null until known */
  you: WireMember | null;
  /** oldest first, at most 200, unique by id */
  messages: GroupMessage[];
  asks: Record<string, AskEntry>;
  /** ids of feed items already turned into a notification, newest last */
  notified: string[];
}

export const EMPTY_FEED: HubFeedData = { items: [], members: [], you: null, messages: [], asks: {}, notified: [] };

/** Newest first, unique by id (the incoming copy wins), capped at MAX_FEED_ITEMS. */
export function mergeItems(prev: FeedItem[], incoming: FeedItem[]): FeedItem[] {
  const byId = new Map<string, FeedItem>();
  for (const it of prev) byId.set(it.id, it);
  for (const it of incoming) if (it && typeof it.id === 'string') byId.set(it.id, it);
  return [...byId.values()].sort((a, b) => b.at - a.at).slice(0, MAX_FEED_ITEMS);
}

/** Appends a chat message unless its id is already known. Keeps the newest MAX_CHAT, oldest first. */
export function mergeChat(prev: GroupMessage[], msg: GroupMessage): GroupMessage[] {
  if (prev.some((m) => m.id === msg.id)) return prev;
  return [...prev, msg].sort((a, b) => a.at - b.at).slice(-MAX_CHAT);
}

/** Records a question we sent. It has no answer yet. */
export function setAsk(asks: Record<string, AskEntry>, id: string, text: string, at: number): Record<string, AskEntry> {
  const next = { ...asks, [id]: { text, at } };
  return pruneAsks(next);
}

/** Records the desktop's answer. An answer for an unknown id is kept too (the text of the question may be missing). */
export function setAnswer(asks: Record<string, AskEntry>, id: string, text: string, ok: boolean, at: number): Record<string, AskEntry> {
  const prev = asks[id];
  const next = { ...asks, [id]: { text: prev?.text ?? '', answer: text, ok, at } };
  return pruneAsks(next);
}

function pruneAsks(asks: Record<string, AskEntry>): Record<string, AskEntry> {
  const keys = Object.keys(asks);
  if (keys.length <= MAX_ASKS) return asks;
  const keep = keys.sort((a, b) => asks[b].at - asks[a].at).slice(0, MAX_ASKS);
  const out: Record<string, AskEntry> = {};
  for (const k of keep) out[k] = asks[k];
  return out;
}

/** Asks still waiting for an answer, newest first. */
export function pendingAsks(asks: Record<string, AskEntry>): Array<[string, AskEntry]> {
  return askList(asks).filter(([, a]) => a.answer === undefined);
}

/** All asks, newest first. */
export function askList(asks: Record<string, AskEntry>): Array<[string, AskEntry]> {
  return Object.entries(asks).sort((a, b) => b[1].at - a[1].at);
}

/** Feed items that should notify: tagged 'notify', not seen before. */
export function freshNotifications(prevIds: Set<string>, incoming: FeedItem[], notified: string[]): FeedItem[] {
  const done = new Set(notified);
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (const it of incoming) {
    if (prevIds.has(it.id) || done.has(it.id) || seen.has(it.id)) continue;
    if (!it.tags?.includes('notify')) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

/**
 * Applies one decoded wire message to the data. Returns the new data and the feed items that should be
 * shown as notifications now. Pure: `now` is passed in.
 */
export function reduceWire(d: HubFeedData, msg: WireMessage, now: number): { data: HubFeedData; notify: FeedItem[] } {
  switch (msg.t) {
    case 'feed': {
      const incoming = Array.isArray(msg.items) ? msg.items.filter((i): i is FeedItem => !!i && typeof i.id === 'string') : [];
      const prevIds = new Set(d.items.map((i) => i.id));
      const notify = freshNotifications(prevIds, incoming, d.notified);
      const notified = notify.length ? [...d.notified, ...notify.map((i) => i.id)].slice(-MAX_NOTIFIED) : d.notified;
      return { data: { ...d, items: mergeItems(d.items, incoming), notified }, notify };
    }
    case 'members': {
      const members = Array.isArray(msg.members) ? msg.members : [];
      const you = msg.you ? (members.find((m) => m.id === msg.you) ?? null) : null;
      return { data: { ...d, members, you }, notify: [] };
    }
    case 'chat':
      if (!msg.msg || typeof msg.msg.id !== 'string') return { data: d, notify: [] };
      return { data: { ...d, messages: mergeChat(d.messages, msg.msg) }, notify: [] };
    case 'answer':
      return { data: { ...d, asks: setAnswer(d.asks, msg.id, msg.text, msg.ok, now) }, notify: [] };
    default:
      // ask, hello, safe, sos: these travel phone -> hub; nothing to store from them
      return { data: d, notify: [] };
  }
}

interface FeedState extends HubFeedData {
  /** Applies a decoded message. Returns the feed items to notify about (the caller schedules them). */
  ingest: (msg: WireMessage, now?: number) => FeedItem[];
  /** Records a question we just sent. */
  ask: (id: string, text: string, now?: number) => void;
  /** Adds a chat message we sent, so it shows before the hub echoes it. */
  addChat: (msg: GroupMessage) => void;
  /** Loads data saved on a previous run. */
  hydrate: (d: Partial<HubFeedData>) => void;
  reset: () => void;
}

const dataOf = (s: HubFeedData): HubFeedData => ({ items: s.items, members: s.members, you: s.you, messages: s.messages, asks: s.asks, notified: s.notified });

export const useHubFeed = create<FeedState>()((set, get) => ({
  ...EMPTY_FEED,
  ingest: (msg, now = Date.now()) => {
    const { data, notify } = reduceWire(dataOf(get()), msg, now);
    set(data);
    return notify;
  },
  ask: (id, text, now = Date.now()) => set({ asks: setAsk(get().asks, id, text, now) }),
  addChat: (msg) => set({ messages: mergeChat(get().messages, msg) }),
  hydrate: (d) =>
    set({
      items: Array.isArray(d.items) ? d.items.slice(0, MAX_FEED_ITEMS) : [],
      members: Array.isArray(d.members) ? d.members : [],
      you: d.you ?? null,
      messages: Array.isArray(d.messages) ? d.messages.slice(-MAX_CHAT) : [],
      asks: d.asks && typeof d.asks === 'object' ? pruneAsks(d.asks) : {},
      notified: Array.isArray(d.notified) ? d.notified.slice(-MAX_NOTIFIED) : [],
    }),
  reset: () => set({ ...EMPTY_FEED }),
}));
