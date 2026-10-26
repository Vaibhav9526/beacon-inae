/**
 * Voice commands shared by the bottom-bar mic (VoiceFab). The old floating dock is retired: its default export
 * renders nothing. The hooks and the toast live here so VoiceFab can use them.
 *
 * Order for every recognised sentence (see interpret() in src/ai/navigate.ts):
 * emergency words -> exact phrases -> on-device model (4 s) -> keyword guesses -> "Ask Didi instead?".
 */
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { runAction } from '../ai/actions';
import { type Choice, interpret } from '../ai/navigate';
import { startNeedle } from '../ai/needle';
import { speak } from '../services/speech';
import { voiceEngine } from '../services/voiceCommands';
import { useSettings } from '../state/settings';
import { Press, Txt } from './ui';

const PERSONA_CHAT = '/kid/didi';
const HOLD_MS = 1400;
const UNDO_MS = 4000;
const DIDI_HOLD_MS = 4000;
const CONFIRM_MS = 15000;

export interface Toast {
  text: string;
  /** Tapping the toast opens the persona chat. Used for the "Ask Didi instead?" chip. */
  toPersona?: boolean;
  /** Shows an Undo button (goes back one screen). */
  undo?: boolean;
  /** "Did you mean: X?" card with big Yes / No buttons and up to two other guesses. */
  confirm?: { primary: Choice; alternatives: Choice[]; yesLabel: string; noLabel: string; onChoose: (c: Choice) => void; onDismiss: () => void };
  /** Closes the toast (Undo uses it). */
  onDismiss?: () => void;
}

/**
 * Runs a recognised phrase and returns `onText` to feed recognised text, and the current `toast`.
 * Screens open at once with an Undo; anything that sends or calls, or is a guess, asks first.
 */
export function useVoiceCommands() {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((t: Toast, holdMs: number) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(t);
    timer.current = setTimeout(() => setToast(null), holdMs + 320);
  }, []);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }, []);

  useEffect(() => {
    // load the on-device model in the background so the first spoken command is not waiting for it
    if (voiceEngine()) void startNeedle();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  /** Yes on the card (or one of the alternatives): this is the explicit tap that sending or calling needs. */
  const choose = useCallback(
    async (c: Choice) => {
      hide();
      const lang = useSettings.getState().lang;
      await runAction(c.action);
      if (c.action.type === 'sos' || c.action.type === 'safe' || c.action.type === 'call112') {
        show({ text: lang === 'hi' ? 'हो गया' : 'Done' }, HOLD_MS);
      }
    },
    [hide, show],
  );

  const onText = useCallback(
    async (text: string) => {
      const lang = useSettings.getState().lang;
      let d;
      try {
        d = await interpret(text, voiceEngine(), { lang });
      } catch {
        d = { kind: 'chip' } as const;
      }

      if (d.kind === 'emergency') {
        // guide first, then the 112 prompt
        router.navigate(`/guide/${d.guideId}` as never);
        void speak(d.say, lang, 'veer');
        show(
          {
            text: d.callQuestion,
            confirm: {
              primary: { action: { type: 'call112' }, label: d.callQuestion },
              alternatives: [],
              yesLabel: lang === 'hi' ? '112 कॉल करें' : 'Call 112',
              noLabel: lang === 'hi' ? 'अभी नहीं' : 'Not now',
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
        void speak(d.label, lang, 'veer');
        show({ text: d.label, undo: d.undo, onDismiss: hide }, d.undo ? UNDO_MS : HOLD_MS);
        return;
      }

      if (d.kind === 'confirm') {
        void speak(d.question, lang, 'veer');
        show(
          {
            text: d.question,
            confirm: { primary: d.primary, alternatives: d.alternatives, yesLabel: lang === 'hi' ? 'हाँ' : 'Yes', noLabel: lang === 'hi' ? 'नहीं' : 'No', onChoose: choose, onDismiss: hide },
          },
          CONFIRM_MS,
        );
        return;
      }

      show({ text: lang === 'hi' ? 'दीदी से पूछें?' : 'Ask Didi instead?', toPersona: true }, DIDI_HOLD_MS);
    },
    [show, choose, hide],
  );

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
  const label = (
    <Txt size={13} weight="600" color="#fff">
      {toast.text}
    </Txt>
  );
  const interactive = toast.toPersona || toast.undo;
  return (
    <Animated.View key={toast.text + String(toast.toPersona)} entering={FadeIn.duration(120)} exiting={FadeOut.duration(300)} pointerEvents={interactive ? 'auto' : 'none'} style={styles.toastWrap}>
      {toast.toPersona ? (
        <Press accessibilityRole="button" accessibilityLabel="Ask Didi instead" onPress={() => router.navigate(PERSONA_CHAT as never)} style={styles.toast}>
          {label}
        </Press>
      ) : toast.undo ? (
        <View style={[styles.toast, styles.toastRow]}>
          {label}
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
        </View>
      ) : (
        <View style={styles.toast}>{label}</View>
      )}
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
    maxWidth: 280,
  },
  toastRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  undo: { paddingHorizontal: 8, paddingVertical: 6, minHeight: 32, justifyContent: 'center' },
  card: {
    backgroundColor: '#17171B',
    borderRadius: 20,
    padding: 16,
    gap: 12,
    width: 300,
    maxWidth: '92%',
  },
  row: { flexDirection: 'row', gap: 10 },
  big: { flex: 1, minHeight: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  yes: { backgroundColor: '#FFC928' },
  no: { backgroundColor: '#2B2B31' },
  alt: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: '#3A3A42', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
});
