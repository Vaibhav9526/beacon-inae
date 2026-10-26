import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useChatSafety } from '../state/chatSafety';
import { useSettings } from '../state/settings';
import { cloud, CloudError, cloudConfigured } from './cloud';
import {
  type GlobalMsg,
  POLL_MS,
  canSend,
  cursorOf,
  errorText,
  filterMuted,
  isOffline,
  mergeMessages,
  replaceLocal,
  setStatus,
  deviceTagOf,
} from './globalChatCore';
import { deviceId } from './identity';

export * from './globalChatCore';

interface ListResp {
  messages: GlobalMsg[];
}

let localN = 0;

/**
 * Live view of one global chat room. Polls every 6 s while mounted and the app is in the foreground,
 * keeps the last 200 messages in memory, and handles sending with a local echo.
 */
export function useGlobalChat(room: string) {
  const [all, setAll] = useState<GlobalMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [notice, setNotice] = useState<{ en: string; hi: string } | null>(null);
  const [myTag, setMyTag] = useState('');
  const muted = useChatSafety((s) => s.muted);
  const nick = useSettings((s) => s.nickname);
  const msgs = useRef<GlobalMsg[]>([]);
  const alive = useRef(true);

  const apply = useCallback((next: GlobalMsg[]) => {
    msgs.current = next;
    if (alive.current) setAll(next);
  }, []);

  useEffect(() => {
    void deviceId().then((d) => alive.current && setMyTag(deviceTagOf(d))).catch(() => {});
  }, []);

  useEffect(() => {
    alive.current = true;
    msgs.current = [];
    setAll([]);
    setLoading(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;

    const poll = async () => {
      if (busy || !alive.current) return;
      busy = true;
      try {
        if (!cloudConfigured()) {
          setOffline(true);
          return;
        }
        const since = cursorOf(msgs.current);
        const r = await cloud.get<ListResp>(`/v1/chat/${room}?since=${since}&limit=60`);
        if (!alive.current) return;
        setOffline(false);
        setNotice((n) => (n && n.en.startsWith('Could not load') ? null : n));
        if (r.messages.length) apply(mergeMessages(msgs.current, r.messages));
      } catch (e) {
        if (!alive.current) return;
        if (isOffline(e)) setOffline(true);
        else if (e instanceof CloudError && e.status === 429) {
          /* polling too often: the next tick is already 6 s away */
        } else setNotice({ en: 'Could not load messages. Retrying.', hi: 'संदेश नहीं मिले। फिर कोशिश हो रही है।' });
      } finally {
        busy = false;
        if (alive.current) setLoading(false);
      }
    };

    const loop = () => {
      if (!alive.current) return;
      timer = setTimeout(async () => {
        if (AppState.currentState === 'active') await poll();
        loop();
      }, POLL_MS);
    };
    void poll();
    loop();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void poll();
    });
    return () => {
      alive.current = false;
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [room, apply]);

  const post = useCallback(
    async (localId: string, text: string) => {
      try {
        const r = await cloud.post<{ message?: GlobalMsg; dropped?: boolean }>(`/v1/chat/${room}`, { text, nick: nick || 'Guest' });
        setOffline(false);
        if (r.message) apply(replaceLocal(msgs.current, localId, r.message));
        else apply(setStatus(msgs.current, localId, 'sent'));
        setNotice(null);
      } catch (e) {
        const status = e instanceof CloudError ? e.status : isOffline(e) ? 0 : -1;
        if (status === 0 || isOffline(e)) setOffline(true);
        const t = errorText(status, e instanceof CloudError ? e.message : '');
        setNotice(t);
        apply(setStatus(msgs.current, localId, 'failed', t.en));
      }
    },
    [room, nick, apply],
  );

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!canSend(text)) return false;
      const id = `local-${Date.now()}-${localN++}`;
      apply(mergeMessages(msgs.current, [{ id, room, ts: Date.now(), nick: nick || 'Guest', text, device: myTag, flags: [], status: 'sending' }]));
      void post(id, text);
      return true;
    },
    [room, nick, myTag, apply, post],
  );

  const retry = useCallback(
    (id: string) => {
      const m = msgs.current.find((x) => x.id === id);
      if (!m) return;
      apply(setStatus(msgs.current, id, 'sending'));
      void post(id, m.text);
    },
    [apply, post],
  );

  const discard = useCallback((id: string) => apply(msgs.current.filter((m) => m.id !== id)), [apply]);

  const report = useCallback(
    async (m: GlobalMsg) => {
      try {
        await cloud.post('/v1/chat/report', { room, id: m.id, reason: 'reported by user' });
        setNotice({ en: 'Thanks. We will review it.', hi: 'धन्यवाद। हम इसे देखेंगे।' });
        return true;
      } catch (e) {
        setNotice(errorText(isOffline(e) ? 0 : e instanceof CloudError ? e.status : -1, e instanceof CloudError ? e.message : ''));
        return false;
      }
    },
    [room],
  );

  const messages = useMemo(() => filterMuted(all, muted), [all, muted]);
  return { messages, myTag, loading, offline, notice, clearNotice: () => setNotice(null), send, retry, discard, report };
}
