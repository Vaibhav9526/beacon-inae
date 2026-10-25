import React, { useState } from 'react';
import { TextInput, View } from 'react-native';
import { askList, useHubFeed } from '../services/hubFeed';
import { sendToHub } from '../services/hub';
import { Btn, Card, Chip, Txt, useTheme } from './ui';

const SUGGESTIONS = ["Summarise today's flood news", 'What is the wind forecast?', 'Any alerts near me?'];

const newId = () => Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-6);

/** Sends a question to the desktop's agents and shows the answer when it comes back. */
export function AskDesktop() {
  const { p } = useTheme();
  const asks = useHubFeed((s) => s.asks);
  const ask = useHubFeed((s) => s.ask);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (q: string) => {
    const t = q.trim();
    if (!t || busy) return;
    const id = newId();
    setBusy(true);
    setErr('');
    ask(id, t);
    setText('');
    try {
      await sendToHub({ t: 'ask', id, text: t });
    } catch {
      setErr('Not sent. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const rows = askList(asks);

  return (
    <View style={{ gap: 12 }}>
      <Card style={{ gap: 10 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Ask the desktop"
          placeholderTextColor={p.muted}
          multiline
          style={{ minHeight: 56, color: p.text, fontSize: 15, lineHeight: 22 }}
          accessibilityLabel="Question for the desktop"
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {SUGGESTIONS.map((s) => (
            <Chip key={s} label={s} onPress={() => void send(s)} />
          ))}
        </View>
        <Btn label={busy ? 'Sending' : 'Send'} icon="send" disabled={!text.trim() || busy} onPress={() => void send(text)} />
        <Txt size={12} color={p.muted}>
          The desktop may ask for approval before it answers. पहले मंज़ूरी, फिर जवाब।
        </Txt>
        {err ? (
          <Txt size={12} color={p.danger}>
            {err}
          </Txt>
        ) : null}
      </Card>

      {rows.length === 0 ? (
        <Txt size={13} color={p.muted}>
          No questions yet.
        </Txt>
      ) : (
        rows.map(([id, a]) => (
          <View key={id} style={{ gap: 8 }}>
            <View style={{ alignSelf: 'flex-end', maxWidth: '82%', backgroundColor: p.brand, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 }}>
              <Txt size={14} color="#0A0A0C">
                {a.text}
              </Txt>
            </View>
            <View style={{ alignSelf: 'flex-start', maxWidth: '86%', backgroundColor: p.card, borderWidth: 1, borderColor: p.border, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 }}>
              {a.answer === undefined ? (
                <Txt size={13} color={p.muted}>
                  Waiting for the desktop
                </Txt>
              ) : (
                <Txt size={14} color={a.ok ? p.text : p.muted}>
                  {a.answer || (a.ok ? 'No answer.' : 'The desktop did not answer.')}
                </Txt>
              )}
            </View>
          </View>
        ))
      )}
    </View>
  );
}
