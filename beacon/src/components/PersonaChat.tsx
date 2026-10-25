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
import { Flower } from './Deco';
import { Icon } from './Icon';
import { MicButton } from './MicButton';
import { PixelAvatar, cast } from './PixelAvatar';
import { useKeyboardOpen } from './TabBar';
import { Btn, Card, Chip, Press, Row, Txt, type TintName, useTheme } from './ui';

/** Bottom clearance that Screen reserves on tab routes (bar 64 + 16 margin + 24 breathing room, plus the safe area). */
const TAB_CLEARANCE = 56;

interface Msg {
  id: number;
  from: 'me' | 'bot';
  text?: string;
  reply?: Reply;
}

let seq = 1;

export function PersonaChat({ persona, onPhoto, incoming, bottomInset = 0 }: { persona: PersonaKey; onPhoto?: () => void; incoming?: { n: number; text: string }; bottomInset?: number }) {
  const { p } = useTheme();
  const t = useT();
  const L = useLocal();
  const lang = useSettings((s) => s.lang);
  const readAloud = useSettings((s) => s.readAloud);
  const def = PERSONAS[persona];
  // each persona has its own vivid tint: the header card and the persona's replies share it
  const ptint: TintName = persona === 'didi' ? 'yellow' : persona === 'asha' ? 'green' : 'peach';
  const pt = p.tint[ptint];
  const [msgs, setMsgs] = useState<Msg[]>([{ id: 0, from: 'bot', text: L(def.greeting) }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [needleReady, setNeedleReady] = useState(false);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const insets = useSafeAreaInsets();
  const kbOpen = useKeyboardOpen();

  useEffect(() => {
    if (needleSupported) void startNeedle().then((s) => setNeedleReady(s.state === 'ready'));
  }, []);
  useEffect(() => () => stopSpeaking(), []);
  useEffect(() => {
    setMsgs([{ id: 0, from: 'bot', text: L(def.greeting) }]);
  }, [persona, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput('');
    setBusy(true);
    setMsgs((m) => [...m, { id: seq++, from: 'me', text: q }]);
    let r: Reply;
    try {
      r = await makeReply(persona, q, lang, needleReady ? needleEngine : null);
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

  // text arriving from outside (a voice transcript, or a photo description) is asked like a typed question
  useEffect(() => {
    if (incoming?.text) void ask(incoming.text);
  }, [incoming?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderBlock = (b: Block, i: number) => {
    switch (b.type) {
      case 'text':
        return (
          <Txt key={i} size={14.5} color={pt.ink}>
            {b.text}
          </Txt>
        );
      case 'warn':
        return (
          <Row key={i} style={{ gap: 6, alignItems: 'flex-start' }}>
            <View style={{ marginTop: 3 }}>
              <Icon name="alert" size={13} color={pt.ink} />
            </View>
            <Txt size={13} weight="600" color={pt.ink} style={{ flex: 1 }}>
              {b.text}
            </Txt>
          </Row>
        );
      case 'steps':
        return (
          <View key={i} style={{ gap: 6 }}>
            <Txt size={14} weight="700" color={pt.ink}>
              {b.title}
            </Txt>
            {b.steps.map((s, k) => (
              <Row key={k} style={{ alignItems: 'flex-start', gap: 8 }}>
                <Txt size={13} weight="700" color={pt.ink} style={{ width: 16, opacity: 0.7 }}>
                  {k + 1}
                </Txt>
                <Txt size={13.5} color={pt.ink} style={{ flex: 1 }}>
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
            {b.items.map((c, k) => (
              <Chip key={k} label={c.label} onPress={() => void ask(c.query)} />
            ))}
          </Row>
        );
    }
  };

  return (
    // This chat always sits on a tab route, where Screen reserves the bar clearance below it. While the keyboard is
    // open the bar is hidden, so a negative margin pulls the composer down into that reserved space.
    <KeyboardAvoidingView style={{ flex: 1, marginBottom: kbOpen ? -(TAB_CLEARANCE + insets.bottom) : 0 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={80}>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })} showsVerticalScrollIndicator={false}>
        <Card tint={ptint} style={{ overflow: 'hidden', minHeight: 104, justifyContent: 'center', padding: 16 }}>
          <Row style={{ gap: 12, paddingRight: 84 }}>
            <PixelAvatar spec={cast(persona)} size={48} bg="rgba(255,255,255,0.6)" animated />
            <View style={{ flex: 1 }}>
              <Txt size={17} weight="700" color={pt.ink}>
                {L(def.name)}
              </Txt>
              <Txt size={12} color={pt.ink} style={{ opacity: 0.8 }}>
                {L(def.role)} · {needleReady ? t('aiOnDevice') : t('aiKeywords')}
              </Txt>
            </View>
          </Row>
          <View pointerEvents="none" style={{ position: 'absolute', right: -12, top: -14, transform: [{ rotate: '12deg' }] }}>
            <Flower size={84} />
          </View>
        </Card>
        {msgs.map((m) => (
          <Animated.View
            entering={FadeInDown.duration(220)}
            key={m.id}
            style={{ alignSelf: m.from === 'me' ? 'flex-end' : 'flex-start', maxWidth: '90%', backgroundColor: m.from === 'me' ? p.cardAlt : pt.bg, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 24, borderBottomRightRadius: m.from === 'me' ? 6 : 24, borderBottomLeftRadius: m.from === 'me' ? 24 : 6, gap: 8 }}>
            {m.text ? (
              <Txt size={14.5} color={m.from === 'me' ? p.text : pt.ink}>
                {m.text}
              </Txt>
            ) : null}
            {m.reply?.blocks.map(renderBlock)}
            {m.reply && !readAloud ? (
              <Press accessibilityLabel={t('readAloud')} onPress={() => void speak(m.reply!.speech, lang, persona)} style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Icon name="speaker" size={13} color={pt.ink} />
                <Txt size={11.5} weight="600" color={pt.ink}>
                  {t('readAloud')}
                </Txt>
              </Press>
            ) : null}
          </Animated.View>
        ))}
        {msgs.length === 1 ? (
          <Row style={{ flexWrap: 'wrap', gap: 6 }}>
            {def.starters.map((s, i) => (
              <Chip key={i} label={L(s)} onPress={() => void ask(L(s))} />
            ))}
          </Row>
        ) : null}
        {busy ? (
          <Txt size={13} color={p.muted}>
            …
          </Txt>
        ) : null}
      </ScrollView>
      <Row style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10 + bottomInset, gap: 8, backgroundColor: p.bg }}>
        {onPhoto ? (
          <Press accessibilityLabel={t('takePhoto')} onPress={onPhoto} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: p.cardAlt, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="camera" size={17} />
          </Press>
        ) : null}
        <MicButton onText={(x) => void ask(x)} />
        <TextInput value={input} onChangeText={setInput} onSubmitEditing={() => void ask(input)} placeholder={t('aidPlaceholder')} placeholderTextColor={p.muted} returnKeyType="send" style={{ flex: 1, height: 44, backgroundColor: p.card, borderRadius: radius.pill, paddingHorizontal: 18, color: p.text, fontSize: 13.5, fontFamily: 'Poppins_400Regular', paddingVertical: 0 }} />
        <Press accessibilityLabel={t('send')} onPress={() => void ask(input)} disabled={busy || !input.trim()} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center', opacity: busy || !input.trim() ? 0.4 : 1 }}>
          <Icon name="send" size={16} color={p.onAccent} />
        </Press>
      </Row>
    </KeyboardAvoidingView>
  );
}
