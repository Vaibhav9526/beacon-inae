import React, { useState } from 'react';
import { TextInput, View } from 'react-native';
import { getFix } from '../services/location';
import { sendSosNow } from '../services/sos';
import { sendToHub } from '../services/hub';
import { useHubFeed } from '../services/hubFeed';
import { useSettings } from '../state/settings';
import type { GroupMessage } from '../services/wire';
import { Btn, Row, Txt, useTheme } from './ui';

const newId = () => Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-6);

/** Group chat for the family, plus "I am safe" and SOS. Messages go through the hub, which fans them out to every phone. */
export function FamilyChat() {
  const { p } = useTheme();
  const messages = useHubFeed((s) => s.messages);
  const you = useHubFeed((s) => s.you);
  const addChat = useHubFeed((s) => s.addChat);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const nickname = useSettings((s) => s.nickname) || useSettings((s) => s.kidName) || 'Me';
  const myId = you?.id ?? 'phone';
  const name = you?.name || nickname;

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    const msg: GroupMessage = { id: newId(), from: myId, fromName: name, text, at: Date.now(), kind: 'text' };
    addChat(msg);
    setDraft('');
    setNote('');
    try {
      await sendToHub({ t: 'chat', msg });
    } catch {
      setNote('Not sent yet. It will show as sent once the hub is reachable.');
    }
  };

  const safe = async () => {
    setBusy(true);
    setNote('');
    try {
      await sendToHub({ t: 'safe', name });
      setNote('Sent. Your family can see you are safe.');
    } catch {
      setNote('Could not tell the family. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  const sos = async () => {
    setBusy(true);
    setNote('');
    try {
      const fix = await getFix({ maxWaitMs: 4000 });
      // the app's normal SOS first: Bluetooth mesh, server and responders
      await sendSosNow();
      await sendToHub({ t: 'sos', name, lat: fix?.lat, lon: fix?.lon, note: 'Need help' });
      setNote('SOS sent to your family and the nearby phones.');
    } catch {
      setNote('SOS sent on the phone network. The hub could not be reached.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <Row style={{ gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Btn label="I am safe" kind="secondary" icon="check" onPress={safe} disabled={busy} />
        </View>
        <View style={{ flex: 1 }}>
          <Btn label="SOS" kind="danger" icon="siren" onPress={sos} disabled={busy} />
        </View>
      </Row>
      {note ? (
        <Txt size={12} color={p.muted}>
          {note}
        </Txt>
      ) : null}

      <View style={{ gap: 10 }}>
        {messages.length === 0 ? (
          <Txt size={13} color={p.muted}>
            No messages yet. सबसे पहले लिखें। Say hello to the family.
          </Txt>
        ) : (
          messages.map((m) => {
            const mine = m.from === myId;
            const tag = m.kind === 'sos' ? 'SOS' : m.kind === 'safe' ? 'Safe' : null;
            return (
              <View key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', gap: 3 }}>
                {!mine ? (
                  <Txt size={11} color={p.muted}>
                    {m.fromName}
                  </Txt>
                ) : null}
                <View
                  style={{
                    backgroundColor: mine ? p.brand : p.card,
                    borderWidth: mine ? 0 : 1,
                    borderColor: p.border,
                    borderRadius: 18,
                    paddingHorizontal: 14,
                    paddingVertical: 9,
                    gap: 4,
                  }}
                >
                  {tag ? (
                    <Txt size={11} weight="700" color={m.kind === 'sos' ? p.danger : p.text}>
                      {tag}
                    </Txt>
                  ) : null}
                  <Txt size={14} color={mine ? '#0A0A0C' : p.text}>
                    {m.text}
                  </Txt>
                </View>
              </View>
            );
          })
        )}
      </View>

      <Row style={{ gap: 8, alignItems: 'flex-end' }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Write to the family"
          placeholderTextColor={p.muted}
          multiline
          accessibilityLabel="Family message"
          style={{ flex: 1, minHeight: 42, maxHeight: 120, color: p.text, fontSize: 15, borderWidth: 1, borderColor: p.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10 }}
        />
        <Btn label="Send" size="sm" icon="send" disabled={!draft.trim()} onPress={send} />
      </Row>
    </View>
  );
}
