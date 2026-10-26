/**
 * Voice commands shared by the bottom-bar mic (VoiceFab). The old floating dock is retired: its default export
 * renders nothing. The hooks and the toast live here so VoiceFab can use them.
 *
 * Every press ends with feedback within about 2 seconds: a visible state (listening / heard "<text>" / working),
 * then a spoken and written reply. Nothing is silent. See VOICE_TEXT in src/ai/navigate.ts for the wording.
 *
 * Order for every recognised sentence (see interpret() in src/ai/navigate.ts):
 * emergency words -> exact phrases -> keyword router -> on-device model (4 s) -> guesses -> "I did not understand".
 */
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { runAction } from '../ai/actions';
import { type Choice, type Decision, interpret, VOICE_TEXT } from '../ai/navigate';
import { startNeedle } from '../ai/needle';
import { translate } from '../i18n';
import { speak } from '../services/speech';
import { voiceEngine } from '../services/voiceCommands';
import { useVosk, voskLang } from '../services/vosk';
import { VOSK_MODELS } from '../services/voskLogic';
import { useSettings } from '../state/settings';
import { subscribeVoiceNotice, type VoiceNotice } from './MicButton';
import { Press, Txt } from './ui';

const PERSONA_CHAT = '/kid/didi';
const HOLD_MS = 1400;
const UNDO_MS = 4000;
const LISTEN_MS = 12000;
const CONFIRM_MS = 15000;

export interface ToastButton {
  label: string;
  onPress: () => void;
}

export interface Toast {
  text: string;
  /** Buttons under the text: Open settings, Type instead, Ask Didi. */
  buttons?: ToastButton[];
  /** Shows an Undo button (goes back one screen). */
  undo?: boolean;
  /** Typed-command box. `onSubmit` gets the sentence the user typed. */
  typing?: { onSubmit: (text: string) => void };
  /** "Did you mean: X?" card with big Yes / No buttons and up to two other guesses. */
  confirm?: { primary: Choice; alternatives: Choice[]; yesLabel: string; noLabel: string; onChoose: (c: Choice) => void; onDismiss: () => void };
  /** 0..1: shows a progress bar under the text (offline voice download). */
  progress?: number;
  /** Closes the toast (Undo uses it). */
  onDismiss?: () => void;
}

/**
 * Runs a recognised phrase and returns `onText` to feed recognised text, and the current `toast`.
 * Every outcome is spoken and written. Screens open at once with an Undo; anything that sends or calls, or is a
 * guess, asks first.
 */
export function useVoiceCommands() {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // holdMs 0 keeps the toast until the user closes it (typed box)
  const show = (t: Toast, holdMs: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setToast(t);
    if (holdMs > 0) timer.current = setTimeout(() => setToast(null), holdMs + 320);
  };

  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setToast(null);
  };

  const lang = () => useSettings.getState().lang;

  /** Written and spoken at once. */
  const reply = (text: string, extra: Partial<Toast> = {}, holdMs = HOLD_MS) => {
    void speak(text, lang(), 'veer');
    show({ text, ...extra }, holdMs);
  };

  const typeButton = (): ToastButton => ({ label: VOICE_TEXT.typeInstead(lang()), onPress: () => openTyping() });

  const openTyping = () => {
    show(
      {
        text: VOICE_TEXT.typeHint(lang()),
        typing: {
          onSubmit: (t) => {
            hide();
            void onText(t);
          },
        },
        onDismiss: hide,
      },
      0,
    );
  };

  useEffect(() => {
    // load the on-device model in the background so the first spoken command is not waiting for it
    if (voiceEngine()) void startNeedle();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // notices from the mic (listening, mic off, no recogniser, nothing heard)
  const handleNotice = useRef<(n: VoiceNotice) => void>(() => {});
  handleNotice.current = (n: VoiceNotice) => {
    if (n.kind === 'download') {
      showDownloadCard();
    } else if (n.kind === 'listening') {
      show({ text: n.text }, LISTEN_MS);
    } else if (n.kind === 'mic') {
      reply(n.text, { buttons: [{ label: VOICE_TEXT.openSettings(lang()), onPress: () => void Linking.openSettings().catch(() => {}) }, typeButton()] }, CONFIRM_MS);
    } else {
      reply(n.text, { buttons: [typeButton()] }, CONFIRM_MS);
    }
  };
  useEffect(() => subscribeVoiceNotice((n) => handleNotice.current(n)), []);

  // ---- offline voice download card: offer, progress bar, result ----
  const dlCard = useRef(false);
  const showDownloadCard = () => {
    const l = lang();
    dlCard.current = true;
    const text = translate('offlineVoiceCard', l).replace('{mb}', String(VOSK_MODELS[voskLang()].mb));
    show({ text, buttons: [{ label: translate('offlineVoiceDownload', l), onPress: () => void useVosk.getState().download() }] }, CONFIRM_MS);
  };
  useEffect(
    () =>
      useVosk.subscribe((st, prev) => {
        if (!dlCard.current || (st.dl.status === prev.dl.status && st.dl.pct === prev.dl.pct)) return;
        const l = lang();
        const d = st.dl;
        if (d.status === 'downloading') {
          show({ text: `${translate('offlineVoiceDownloading', l)} ${d.pct}%`, progress: d.pct / 100, buttons: [{ label: translate('offlineVoiceCancel', l), onPress: () => useVosk.getState().cancel() }] }, 0);
        } else if (d.status === 'ready') {
          dlCard.current = false;
          reply(translate('offlineVoiceDone', l), {}, 3500);
        } else if (d.status === 'error') {
          dlCard.current = false;
          show({ text: `${translate('offlineVoiceFailed', l)}: ${d.error ?? ''}`, buttons: [{ label: translate('offlineVoiceRetry', l), onPress: () => { dlCard.current = true; void useVosk.getState().download(); } }] }, CONFIRM_MS);
        } else if (d.status === 'missing') {
          dlCard.current = false;
          hide();
        }
      }),
    [],
  );

  /** Yes on the card (or one of the alternatives): this is the explicit tap that sending or calling needs. */
  const choose = async (c: Choice) => {
    hide();
    const l = lang();
    try {
      await runAction(c.action);
    } catch {
      reply(VOICE_TEXT.error(l), { buttons: [typeButton()] }, CONFIRM_MS);
      return;
    }
    if (c.action.type === 'sos' || c.action.type === 'safe' || c.action.type === 'call112') reply(VOICE_TEXT.done(l));
  };

  /** Recognised (or typed) text -> the action it means. Always ends in a spoken and written reply. */
  const onText = async (raw: string) => {
    const l = lang();
    const text = (raw ?? '').trim();
    if (!text) return reply(VOICE_TEXT.notHeard(l), { buttons: [typeButton()] }, CONFIRM_MS);
    show({ text: VOICE_TEXT.heard(text, l) }, LISTEN_MS);

    let d: Decision;
    console.log('[voice] heard', JSON.stringify(text));
    try {
      d = await interpret(text, voiceEngine(), { lang: l });
    } catch (e) {
      console.log('[voice] interpret failed', String(e));
      return reply(VOICE_TEXT.error(l), { buttons: [typeButton()] }, CONFIRM_MS);
    }
    console.log('[voice] decision', d.kind, d.kind === 'run' ? d.route ?? d.action?.type : '');

    try {
      if (d.kind === 'emergency') {
        // guide first, then the 112 prompt
        router.navigate(`/guide/${d.guideId}` as never);
        void speak(d.say, l, 'veer');
        show(
          {
            text: d.callQuestion,
            confirm: {
              primary: { action: { type: 'call112' }, label: d.callQuestion },
              alternatives: [],
              yesLabel: l === 'hi' ? '112 कॉल करें' : 'Call 112',
              noLabel: l === 'hi' ? 'अभी नहीं' : 'Not now',
              onChoose: choose,
              onDismiss: hide,
            },
          },
          CONFIRM_MS,
        );
        return;
      }

      if (d.kind === 'run') {
        if (d.route) router.navigate(d.route as never);
        else if (d.action) await runAction(d.action);
        reply(d.label, { undo: d.undo, onDismiss: hide }, d.undo ? UNDO_MS : HOLD_MS);
        return;
      }

      if (d.kind === 'confirm') {
        void speak(d.question, l, 'veer');
        show(
          {
            text: d.question,
            confirm: { primary: d.primary, alternatives: d.alternatives, yesLabel: l === 'hi' ? 'हाँ' : 'Yes', noLabel: l === 'hi' ? 'नहीं' : 'No', onChoose: choose, onDismiss: hide },
          },
          CONFIRM_MS,
        );
        return;
      }

      // nothing understood: say what was heard and the three examples, and offer typing or Didi
      reply(
        VOICE_TEXT.heardUnknown(text, l),
        {
          buttons: [
            typeButton(),
            { label: VOICE_TEXT.askDidi(l), onPress: () => router.navigate(PERSONA_CHAT as never) },
          ],
        },
        CONFIRM_MS,
      );
    } catch (e) {
      console.log('[voice] reply failed', String(e));
      reply(VOICE_TEXT.error(l), { buttons: [typeButton()] }, CONFIRM_MS);
    }
  };

  return { onText, toast, choose, dismiss: hide };
}

/** Back one screen, if there is one. */
function undo() {
  try {
    if (router.canGoBack()) router.back();
  } catch {
    /* nothing to go back to */
  }
}

/** The typed-command box: same result as speaking the command. */
function TypeBox({ label, onSubmit, onClose }: { label: string; onSubmit: (text: string) => void; onClose?: () => void }) {
  const [value, setValue] = useState('');
  const send = () => {
    const t = value.trim();
    if (t) onSubmit(t);
  };
  return (
    <View style={styles.card}>
      <Txt size={15} weight="700" color="#fff" style={{ textAlign: 'center' }}>
        {label}
      </Txt>
      <TextInput
        value={value}
        onChangeText={setValue}
        onSubmitEditing={send}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="send"
        placeholder="open weather"
        placeholderTextColor="#8A8A93"
        accessibilityLabel="Type a voice command"
        style={styles.input}
      />
      <View style={styles.row}>
        <Press accessibilityRole="button" accessibilityLabel="Send command" onPress={send} style={[styles.big, styles.yes]}>
          <Txt size={17} weight="800" color="#0A0A0C">
            Send
          </Txt>
        </Press>
        {onClose ? (
          <Press accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={[styles.big, styles.no]}>
            <Txt size={17} weight="700" color="#fff">
              Close
            </Txt>
          </Press>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Small dark label that fades in above the bar, or the confirm card. Positioned by its parent.
 */
export function VoiceToast({ toast }: { toast: Toast | null }) {
  if (!toast) return null;
  const c = toast.confirm;
  if (c) {
    return (
      <Animated.View key={toast.text} entering={FadeIn.duration(120)} exiting={FadeOut.duration(300)} pointerEvents="auto" style={styles.toastWrap}>
        <View style={styles.card}>
          <Txt size={16} weight="700" color="#fff" style={{ textAlign: 'center' }}>
            {toast.text}
          </Txt>
          <View style={styles.row}>
            <Press accessibilityRole="button" accessibilityLabel={c.yesLabel} onPress={() => c.onChoose(c.primary)} style={[styles.big, styles.yes]}>
              <Txt size={18} weight="800" color="#0A0A0C">
                {c.yesLabel}
              </Txt>
            </Press>
            <Press accessibilityRole="button" accessibilityLabel={c.noLabel} onPress={() => c.onDismiss()} style={[styles.big, styles.no]}>
              <Txt size={18} weight="700" color="#fff">
                {c.noLabel}
              </Txt>
            </Press>
          </View>
          {c.alternatives.map((alt, i) => (
            <Press key={i} accessibilityRole="button" accessibilityLabel={alt.label} onPress={() => c.onChoose(alt)} style={styles.alt}>
              <Txt size={14} weight="600" color="#fff">
                {alt.label}
              </Txt>
            </Press>
          ))}
        </View>
      </Animated.View>
    );
  }
  if (toast.typing) {
    return (
      <Animated.View key="typing" entering={FadeIn.duration(120)} exiting={FadeOut.duration(300)} pointerEvents="auto" style={styles.toastWrap}>
        <TypeBox label={toast.text} onSubmit={toast.typing.onSubmit} onClose={toast.onDismiss} />
      </Animated.View>
    );
  }
  const buttons = toast.buttons ?? [];
  return (
    <Animated.View
      key={toast.progress !== undefined ? 'progress' : toast.text}
      entering={FadeIn.duration(120)}
      exiting={FadeOut.duration(300)}
      pointerEvents={buttons.length || toast.undo ? 'auto' : 'none'}
      style={styles.toastWrap}>
      <View style={[styles.toast, toast.undo ? styles.toastRow : null]}>
        <View style={styles.toastText}>
          <Txt size={13} weight="600" color="#fff">
            {toast.text}
          </Txt>
          {toast.progress !== undefined ? (
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${Math.round(Math.min(1, Math.max(0, toast.progress)) * 100)}%` }]} />
            </View>
          ) : null}
          {buttons.length ? (
            <View style={styles.btnRow}>
              {buttons.map((b, i) => (
                <Press key={i} accessibilityRole="button" accessibilityLabel={b.label} onPress={b.onPress} style={styles.btn}>
                  <Txt size={13} weight="800" color="#FFC928">
                    {b.label}
                  </Txt>
                </Press>
              ))}
            </View>
          ) : null}
        </View>
        {toast.undo ? (
          <Press
            accessibilityRole="button"
            accessibilityLabel="Undo"
            onPress={() => {
              undo();
              toast.onDismiss?.();
            }}
            style={styles.undo}>
            <Txt size={13} weight="800" color="#FFC928">
              Undo
            </Txt>
          </Press>
        ) : null}
      </View>
    </Animated.View>
  );
}

/** Retired: the voice control now lives in the bottom bar (VoiceFab). Kept so the old mount in the root layout is harmless. */
export function VoiceDock(_props: { hidden?: boolean }) {
  return null;
}

export default VoiceDock;

const styles = StyleSheet.create({
  toastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 98,
    alignItems: 'center',
  },
  toast: {
    backgroundColor: '#17171B',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: 300,
  },
  bar: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: '#FFC928' },
  toastText: { flexShrink: 1, gap: 8 },
  toastRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btn: { minHeight: 36, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: '#3A3A42', justifyContent: 'center' },
  undo: { paddingHorizontal: 8, paddingVertical: 6, minHeight: 32, justifyContent: 'center' },
  card: {
    backgroundColor: '#17171B',
    borderRadius: 20,
    padding: 16,
    gap: 12,
    width: 300,
    maxWidth: '92%',
  },
  input: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3A3A42',
    color: '#fff',
    paddingHorizontal: 12,
    fontSize: 16,
    backgroundColor: '#0E0E12',
  },
  row: { flexDirection: 'row', gap: 10 },
  big: { flex: 1, minHeight: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  yes: { backgroundColor: '#FFC928' },
  no: { backgroundColor: '#2B2B31' },
  alt: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: '#3A3A42', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
});
