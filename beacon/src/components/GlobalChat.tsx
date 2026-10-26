import React, { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { radius } from '../theme';
import { lastKnownFix } from '../services/location';
import { type GlobalMsg, MAX_TEXT, OFFLINE_TEXT, RULES_TEXT, roomForCoords, useGlobalChat } from '../services/globalChat';
import { useChatSafety } from '../state/chatSafety';
import { Icon } from './Icon';
import { SkeletonList } from './Skeleton';
import { useKeyboardOpen } from './TabBar';
import { Appear, Press, Row, Txt, useTheme } from './ui';

const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const pair = (t: { en: string; hi: string }) => `${t.en} / ${t.hi}`;

/**
 * Internet chat with every Beacon user (separate from the Bluetooth mesh chat).
 * Self-contained: fills the space it is given. Mount it in the Community screen's chat area.
 */
export default function GlobalChat() {
  const { p } = useTheme();
  const kbOpen = useKeyboardOpen();
  const [scope, setScope] = useState<'global' | 'region'>('global');
  const [regionRoom, setRegionRoom] = useState<string | null>(null);
  const [text, setText] = useState('');
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const mutedCount = useChatSafety((s) => s.muted.length);
  const clearMuted = useChatSafety((s) => s.clear);
  const mute = useChatSafety((s) => s.mute);

  useEffect(() => {
    void lastKnownFix()
      .then((f) => f && setRegionRoom(roomForCoords(f.lat, f.lon)))
      .catch(() => {});
  }, []);

  const room = scope === 'region' && regionRoom ? regionRoom : 'global';
  const chat = useGlobalChat(room);

  const ask = (m: GlobalMsg) => {
    if (m.status) {
      if (m.status === 'failed') {
        Alert.alert('Not sent / भेजा नहीं गया', m.error ?? '', [
          { text: 'Try again / फिर कोशिश', onPress: () => chat.retry(m.id) },
          { text: 'Delete / हटाएं', style: 'destructive', onPress: () => chat.discard(m.id) },
          { text: 'Cancel / रद्द', style: 'cancel' },
        ]);
      }
      return;
    }
    if (m.device === chat.myTag) return;
    Alert.alert(`${m.nick} #${m.device}`, undefined, [
      {
        text: 'Report / रिपोर्ट करें',
        onPress: () => void chat.report(m).then((ok) => ok && Alert.alert('Thanks / धन्यवाद', 'We will review this message. / हम इस संदेश की समीक्षा करेंगे।')),
      },
      { text: 'Mute this person / म्यूट करें', onPress: () => mute(m.device) },
      { text: 'Cancel / रद्द', style: 'cancel' },
    ]);
  };

  const send = () => {
    if (chat.send(text)) {
      setText('');
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  const list = chat.messages;
  const bubble = (m: GlobalMsg, grouped: boolean) => {
    const mine = !!m.status || (!!chat.myTag && m.device === chat.myTag);
    return (
      <Appear key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '78%', marginTop: grouped ? 0 : 8 }}>
        {!mine && !grouped ? (
          <Row style={{ gap: 5, paddingHorizontal: 4, marginBottom: 3 }}>
            <Txt size={11.5} color={p.muted}>
              {m.nick}
            </Txt>
            <Txt size={10.5} color={p.muted} style={{ opacity: 0.7 }}>
              #{m.device}
            </Txt>
          </Row>
        ) : null}
        <Press
          accessibilityRole="button"
          accessibilityHint="Long press for options / विकल्पों के लिए देर तक दबाएं"
          delayLongPress={350}
          onLongPress={() => ask(m)}
          onPress={m.status === 'failed' ? () => ask(m) : undefined}
          haptic={false}
          style={{ backgroundColor: mine ? p.brand : p.card, borderWidth: mine ? 0 : 1, borderColor: m.status === 'failed' ? p.tint.pink.ink : p.border, borderRadius: 18, paddingVertical: 8, paddingHorizontal: 12, gap: 2 }}>
          <Txt size={14} color={mine ? p.onBrand : p.text}>
            {m.text}
          </Txt>
          <Txt size={10} color={mine ? p.onBrand : p.muted} style={{ alignSelf: 'flex-end', opacity: 0.75 }}>
            {m.status === 'sending' ? 'Sending… / भेज रहे हैं' : m.status === 'failed' ? 'Not sent, tap to retry / भेजा नहीं गया' : clock(m.ts)}
          </Txt>
        </Press>
      </Appear>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        <View style={{ backgroundColor: p.tint.yellow.bg, borderRadius: 16, padding: 12, gap: 4 }}>
          <Row style={{ gap: 8, alignItems: 'flex-start' }}>
            <Icon name="shield" size={14} color={p.tint.yellow.ink} />
            <View style={{ flex: 1, gap: 3 }}>
              <Txt size={12} color={p.tint.yellow.ink}>
                {RULES_TEXT.en}
              </Txt>
              <Txt size={12} color={p.tint.yellow.ink} style={{ opacity: 0.85 }}>
                {RULES_TEXT.hi}
              </Txt>
            </View>
          </Row>
        </View>
        <Row style={{ gap: 6, alignItems: 'center' }}>
          {(['global', 'region'] as const).map((k) => {
            const active = scope === k;
            const disabled = k === 'region' && !regionRoom;
            return (
              <Press
                key={k}
                accessibilityRole="button"
                accessibilityState={{ selected: active, disabled }}
                disabled={disabled}
                onPress={() => setScope(k)}
                style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1, borderColor: active ? p.text : p.border, backgroundColor: active ? p.cardAlt : 'transparent', opacity: disabled ? 0.45 : 1 }}>
                <Txt size={12} weight={active ? '600' : '400'} color={active ? p.text : p.muted}>
                  {k === 'global' ? 'Global / वैश्विक' : `My region / मेरा क्षेत्र${regionRoom ? ` · ${regionRoom.slice(7).toUpperCase()}` : ''}`}
                </Txt>
              </Press>
            );
          })}
          {mutedCount > 0 ? (
            <Press accessibilityRole="button" onPress={clearMuted} style={{ marginLeft: 'auto', paddingVertical: 5 }}>
              <Txt size={11.5} color={p.muted}>
                Unmute {mutedCount} / अनम्यूट करें
              </Txt>
            </Press>
          ) : null}
        </Row>
        {scope === 'region' && !regionRoom ? (
          <Txt size={11.5} color={p.muted}>
            Turn on location once to find your region. / अपना क्षेत्र जानने के लिए एक बार लोकेशन चालू करें।
          </Txt>
        ) : null}
        {chat.offline ? (
          <View style={{ backgroundColor: p.tint.blue.bg, borderRadius: 14, padding: 10, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Icon name="wifiOff" size={14} color={p.tint.blue.ink} />
            <Txt size={12} color={p.tint.blue.ink} style={{ flex: 1 }}>
              {pair(OFFLINE_TEXT)}
            </Txt>
          </View>
        ) : null}
        {chat.notice && !chat.offline ? (
          <Press onPress={chat.clearNotice} style={{ backgroundColor: p.tint.peach.bg, borderRadius: 14, padding: 10 }}>
            <Txt size={12} color={p.tint.peach.ink}>
              {pair(chat.notice)}
            </Txt>
          </Press>
        ) : null}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
        <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, gap: 8 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {chat.loading && list.length === 0 && !chat.offline ? <SkeletonList n={4} /> : null}
          {!chat.loading && list.length === 0 ? (
            <View style={{ paddingVertical: 36, alignItems: 'center' }}>
              <Txt size={14} color={p.muted} style={{ textAlign: 'center' }}>
                No messages yet. Say hello. / अभी कोई संदेश नहीं। नमस्ते कहें।
              </Txt>
            </View>
          ) : null}
          {list.map((m, i) => bubble(m, list[i - 1]?.device === m.device && !list[i - 1]?.status === !m.status))}
        </ScrollView>

        <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: kbOpen ? 8 : 12, gap: 4 }}>
          <Row style={{ gap: 8 }}>
            <TextInput
              value={text}
              onChangeText={(v) => setText(v.slice(0, MAX_TEXT))}
              onSubmitEditing={send}
              maxLength={MAX_TEXT}
              placeholder="Message everyone / सबको संदेश भेजें"
              placeholderTextColor={p.muted}
              style={{ flex: 1, height: 42, backgroundColor: p.card, borderWidth: 1, borderColor: p.border, borderRadius: 21, paddingHorizontal: 16, color: p.text, fontSize: 14, fontFamily: 'Poppins_400Regular', paddingVertical: 0 }}
            />
            <Press accessibilityLabel="Send / भेजें" onPress={send} disabled={!text.trim()} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center', opacity: text.trim() ? 1 : 0.4 }}>
              <Icon name="send" size={16} color={p.onAccent} />
            </Press>
          </Row>
          <Txt size={10.5} color={text.length >= MAX_TEXT - 20 ? p.tint.pink.ink : p.muted} style={{ alignSelf: 'flex-end', paddingRight: 6 }}>
            {text.length}/{MAX_TEXT}
          </Txt>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
