import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { runAction } from '../ai/actions';
import { needleEngine, needleSupported, startNeedle } from '../ai/needle';
import { type Block, PERSONAS, type PersonaKey, type Reply, reply as makeReply } from '../ai/persona';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocal, useT } from '../i18n';
import { speak, stopSpeaking } from '../services/speech';
import { useSettings } from '../state/settings';
import { radius } from '../theme';
import { Icon } from './Icon';
import { MicButton } from './MicButton';
import { useKeyboardOpen } from './TabBar';
import { Btn, Press, Row, Txt, useTheme } from './ui';

/** Bottom clearance that Screen reserves on tab routes (bar 64 + 16 margin + 24 breathing room, plus the safe area). */
const TAB_CLEARANCE = 56;

interface Msg {
  id: number;
  from: 'me' | 'bot';
  text?: string;
  reply?: Reply;
}

let seq = 1;

export function PersonaChat({ persona, onPhoto, incoming, bottomInset = 0, topPad = 16 }: { persona: PersonaKey; onPhoto?: () => void; incoming?: { n: number; text: string; note?: boolean }; bottomInset?: number; topPad?: number }) {
  const { p } = useTheme();
  const t = useT();
  const L = useLocal();
  const lang = useSettings((s) => s.lang);
  const readAloud = useSettings((s) => s.readAloud);
  const def = PERSONAS[persona];
  const [msgs, setMsgs] = useState<Msg[]>([{ id: 0, from: 'bot', text: L(def.greeting) }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [needleReady, setNeedleReady] = useState(false);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  // true once the person has sent something: only then does the list follow new content to the end
  const hasSent = useRef(false);
  const insets = useSafeAreaInsets();
  const kbOpen = useKeyboardOpen();

  useEffect(() => {
    if (needleSupported) void startNeedle().then((s) => setNeedleReady(s.state === 'ready'));
  }, []);
  useEffect(() => () => stopSpeaking(), []);
  useEffect(() => {
    hasSent.current = false;
    setMsgs([{ id: 0, from: 'bot', text: L(def.greeting) }]);
  }, [persona, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const ask = async (text: string, guideId?: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput('');
    setBusy(true);
    hasSent.current = true;
    setMsgs((m) => [...m, { id: seq++, from: 'me', text: q }]);
    let r: Reply;
    try {
      r = await makeReply(persona, q, lang, needleReady ? needleEngine : null, guideId);
    } catch {
      // never leave the chat stuck on "…"
      setBusy(false);
      return;
    }
    setMsgs((m) => [...m, { id: seq++, from: 'bot', reply: r }]);
    setBusy(false);
    if (readAloud) void speak(r.speech, lang, persona);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 80);
  };

  // text arriving from outside (a voice transcript) is asked like a typed question; a note is only shown
  useEffect(() => {
    if (!incoming?.text) return;
    if (incoming.note) {
      setMsgs((m) => [...m, { id: seq++, from: 'bot', text: incoming.text }]);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 80);
      return;
    }
    void ask(incoming.text);
  }, [incoming?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const pill = (label: string, onPress: () => void, key?: React.Key) => (
    <Press key={key} onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: p.border, backgroundColor: p.card }}>
      <Txt size={13} color={p.text}>
        {label}
      </Txt>
    </Press>
  );

  const renderBlock = (b: Block, i: number) => {
    switch (b.type) {
      case 'text':
        return (
          <Txt key={i} size={14.5} color={p.text}>
            {b.text}
          </Txt>
        );
      case 'warn':
        return (
          <Row key={i} style={{ gap: 6, alignItems: 'flex-start' }}>
            <View style={{ marginTop: 3 }}>
              <Icon name="alert" size={13} color={p.warn} />
            </View>
            <Txt size={13} weight="600" color={p.text} style={{ flex: 1 }}>
              {b.text}
            </Txt>
          </Row>
        );
      case 'steps':
        return (
          <View key={i} style={{ gap: 6 }}>
            <Txt size={14} weight="700" color={p.text}>
              {b.title}
            </Txt>
            {b.steps.map((s, k) => (
              <Row key={k} style={{ alignItems: 'flex-start', gap: 8 }}>
                <Txt size={13} weight="700" color={p.muted} style={{ width: 16 }}>
                  {k + 1}
                </Txt>
                <Txt size={13.5} color={p.text} style={{ flex: 1 }}>
                  {s}
                </Txt>
              </Row>
            ))}
          </View>
        );
      case 'guide':
      case 'disaster':
        return <Btn key={i} size="sm" kind="secondary" label={t('browseGuides')} icon="aid" onPress={() => router.push(`/${b.type === 'guide' ? 'guide' : 'disaster'}/${b.id}` as never)} />;
      case 'action':
        return <Btn key={i} size="sm" kind={b.action.type === 'sos' ? 'danger' : 'primary'} label={b.label} onPress={() => void runAction(b.action)} />;
      case 'chips':
        return (
          <Row key={i} style={{ flexWrap: 'wrap', gap: 6 }}>
            {b.items.map((c, k) => pill(c.label, () => void ask(c.query, c.guideId), k))}
          </Row>
        );
    }
  };

  return (
    // This chat always sits on a tab route, where Screen reserves the bar clearance below it. While the keyboard is
    // open the bar is hidden, so a negative margin pulls the composer down into that reserved space.
    <KeyboardAvoidingView style={{ flex: 1, marginBottom: kbOpen ? -(TAB_CLEARANCE + insets.bottom) : 0 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={80}>
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, paddingTop: topPad, gap: 10 }}
        // never on first render, and never while the person is still reading the top: only follow after they have sent
        onContentSizeChange={() => {
          if (hasSent.current) scroll.current?.scrollToEnd({ animated: true });
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* the persona's one-line role and status, muted: the picker pills above (or this line alone) say who is talking */}
        <Txt size={12} color={p.muted}>
          {L(def.role)} · {needleReady ? t('aiOnDevice') : t('aiKeywords')}
        </Txt>
        {msgs.map((m) => (
          <Animated.View
            entering={FadeInDown.duration(220)}
            key={m.id}
            style={{ alignSelf: m.from === 'me' ? 'flex-end' : 'flex-start', maxWidth: '78%', backgroundColor: m.from === 'me' ? p.brand : p.card, borderWidth: m.from === 'me' ? 0 : 1, borderColor: p.border, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 18, gap: 8 }}>
            {m.text ? (
              <Txt size={14.5} color={m.from === 'me' ? p.onBrand : p.text}>
                {m.text}
              </Txt>
            ) : null}
            {m.reply?.blocks.map(renderBlock)}
            {m.reply && !readAloud ? (
              <Press accessibilityLabel={t('readAloud')} onPress={() => void speak(m.reply!.speech, lang, persona)} style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Icon name="speaker" size={13} color={p.muted} />
                <Txt size={11.5} weight="600" color={p.muted}>
                  {t('readAloud')}
                </Txt>
              </Press>
            ) : null}
          </Animated.View>
        ))}
        {msgs.length === 1 ? <Row style={{ flexWrap: 'wrap', gap: 6 }}>{def.starters.map((s, i) => pill(L(s), () => void ask(L(s)), i))}</Row> : null}
        {busy ? (
          <Txt size={13} color={p.muted}>
            …
          </Txt>
        ) : null}
      </ScrollView>
      <Row style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10 + bottomInset, gap: 8 }}>
        {onPhoto ? (
          <Press accessibilityLabel={t('takePhoto')} onPress={onPhoto} style={{ width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: p.border, backgroundColor: p.card, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="camera" size={17} color={p.text} />
          </Press>
        ) : null}
        <MicButton onText={(x) => void ask(x)} />
        <TextInput value={input} onChangeText={setInput} onSubmitEditing={() => void ask(input)} placeholder={t('aidPlaceholder')} placeholderTextColor={p.muted} returnKeyType="send" style={{ flex: 1, height: 42, backgroundColor: p.card, borderWidth: 1, borderColor: p.border, borderRadius: 21, paddingHorizontal: 16, color: p.text, fontSize: 14, fontFamily: 'Poppins_400Regular', paddingVertical: 0 }} />
        <Press accessibilityLabel={t('send')} onPress={() => void ask(input)} disabled={busy || !input.trim()} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center', opacity: busy || !input.trim() ? 0.4 : 1 }}>
          <Icon name="send" size={16} color={p.onAccent} />
        </Press>
      </Row>
    </KeyboardAvoidingView>
  );
}
