import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { DISCLAIMER, getGuide } from '../kb';
import { type Severity, type TriageChoiceId, TRIAGE_CHOICES, getTriageChoice } from '../kb/triage';
import { useLang, useT } from '../i18n';
import { call112 } from '../services/sos';
import { triageQuestions, triageResult } from '../services/triage';
import { analysePhoto } from '../services/vision';
import { radius } from '../theme';
import { Icon } from './Icon';
import { GuideView } from './GuideView';
import { Btn, Card, Row, Txt, useTheme } from './ui';

type Tint = 'pink' | 'yellow' | 'blue' | 'green' | 'lilac' | 'peach';
const CHOICE_TINT: Record<TriageChoiceId, Tint> = {
  bleeding: 'pink',
  burn: 'yellow',
  swelling: 'lilac',
  cut: 'peach',
  bite: 'green',
  rash: 'pink',
  fracture: 'blue',
  eye: 'lilac',
  breathing: 'pink',
  unsure: 'blue',
};
const WATCH_FOR: [string, string] = [
  'Get help if the bleeding, swelling or pain gets worse, or if fever, pus, red streaks or numbness appear.',
  'हालत बिगड़े, सूजन या दर्द बढ़े, या बुखार, मवाद, लाल धारियाँ या सुन्नपन आए तो मदद लें।',
];

interface Props {
  /** The photo just taken. Without one (camera failed or web) the guided check still works. */
  uri?: string;
  onClose: () => void;
  /** Short English line to post into the chat after the person is done. */
  onSummary?: (text: string) => void;
}

export function PhotoTriage({ uri, onClose, onSummary }: Props) {
  const { p } = useTheme();
  const t = useT();
  const lang = useLang();
  const idx = lang === 'hi' ? 1 : 0;
  const tr = (en: string, hi: string) => (lang === 'hi' ? hi : en);

  const [visionRunning, setVisionRunning] = useState(!!uri);
  const [desc, setDesc] = useState<string | null>(null);
  // the model's suggestion only: it is never the choice until the person taps that chip
  const [suggested, setSuggested] = useState<TriageChoiceId | null>(null);
  const [choice, setChoice] = useState<TriageChoiceId | null>(null);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [showResult, setShowResult] = useState(false);

  // Vision is optional. Any failure or the 15 s timeout just leaves the guided check on its own, with no error.
  useEffect(() => {
    if (!uri) return;
    let alive = true;
    void analysePhoto(uri).then((r) => {
      if (!alive) return;
      setVisionRunning(false);
      if (!r) return;
      setDesc(r.description);
      setSuggested(r.choice);
    });
    return () => {
      alive = false;
    };
  }, [uri]);

  const result = useMemo(() => (choice && showResult ? triageResult(choice, answers, lang) : null), [choice, answers, showResult, lang]);
  const questions = useMemo(() => (choice ? triageQuestions(choice, lang) : []), [choice, lang]);

  const pick = (id: TriageChoiceId) => {
    if (id !== choice) setAnswers({});
    setChoice(id);
    setShowResult(false);
  };

  const reset = () => {
    setShowResult(false);
    setAnswers({});
    setChoice(null);
  };

  const done = () => {
    if (result && choice) {
      const c = getTriageChoice(choice);
      const guide = result.guideIds[0] ? getGuide(result.guideIds[0]) : undefined;
      // the guided check never looked at the photo, so the note says it was built from the person's answers
      onSummary?.(`Guided check from my answers (not the photo): ${c?.label[0] ?? choice}${guide ? `, ${guide.title[0]}` : ''}. Result: ${SEVERITY_EN[result.severity]}.`);
    }
    onClose();
  };

  const SEVERITY_EN: Record<Severity, string> = { emergency: 'call 112 now', urgent: 'see a doctor today', home: 'treat at home' };
  const severityStyle: Record<Severity, { bg: string; ink: string; title: string }> = {
    emergency: { bg: p.danger, ink: '#fff', title: tr('Emergency: call 112 now', 'आपात: अभी 112 पर कॉल करें') },
    urgent: { bg: p.tint.yellow.bg, ink: p.tint.yellow.ink, title: tr('See a doctor today', 'आज डॉक्टर को दिखाएँ') },
    home: { bg: p.tint.green.bg, ink: p.tint.green.ink, title: tr('Treat at home, and watch for these signs', 'घर पर देखभाल करें, और ये लक्षण देखें') },
  };

  return (
    <View style={{ flex: 1, backgroundColor: p.sheet }}>
      <Row style={{ justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
        <Txt size={16} weight="600">
          {tr('Photo check', 'फ़ोटो जाँच')}
        </Txt>
        <Btn size="sm" kind="ghost" label={t('cancel')} onPress={onClose} />
      </Row>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        {uri ? <Image source={{ uri }} accessibilityLabel={tr('Photo you took', 'आपकी ली हुई फ़ोटो')} style={{ width: '100%', height: 220, borderRadius: radius.lg, backgroundColor: p.cardAlt }} resizeMode="cover" /> : null}

        {uri ? (
          <Card style={{ gap: 4 }}>
            {visionRunning ? (
              <Txt size={13} color={p.muted}>
                {t('describingPhoto')}
              </Txt>
            ) : desc ? (
              <>
                <Txt size={14}>
                  {tr('Possible: ', 'संभावित: ')}
                  {desc}
                </Txt>
                <Txt size={12} color={p.muted}>
                  {tr('The smart description can be wrong. Choose what you see below.', 'स्मार्ट विवरण गलत हो सकता है। नीचे चुनें आपको क्या दिख रहा है।')}
                </Txt>
              </>
            ) : (
              <Txt size={13} color={p.muted}>
                {tr('The smart description is not available. Tell us what you see below.', 'स्मार्ट विवरण उपलब्ध नहीं है। नीचे बताएँ आपको क्या दिख रहा है।')}
              </Txt>
            )}
          </Card>
        ) : (
          <Txt size={13} color={p.muted}>
            {tr('No photo. Tell us what you see below.', 'फ़ोटो नहीं है। नीचे बताएँ आपको क्या दिख रहा है।')}
          </Txt>
        )}

        {!showResult ? (
          <>
            <Txt size={18} weight="700">
              {tr('What do you see?', 'आपको क्या दिख रहा है?')}
            </Txt>
            <Row style={{ flexWrap: 'wrap', gap: 8 }}>
              {TRIAGE_CHOICES.map((c) => {
                const active = choice === c.id;
                const isSuggestion = suggested === c.id && !active;
                const tint = p.tint[CHOICE_TINT[c.id]];
                return (
                  <Pressable
                    key={c.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => pick(c.id)}
                    style={{ minHeight: 40, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: tint.bg, borderWidth: active ? 2 : 1, borderColor: active ? tint.ink : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 6 }}
                  >
                    <Txt size={14}>{c.emoji}</Txt>
                    <Txt size={13} weight="500" color={tint.ink}>
                      {c.label[idx]}
                    </Txt>
                    {isSuggestion ? (
                      <Txt size={11} weight="600" color={tint.ink}>
                        {tr('suggested', 'सुझाव')}
                      </Txt>
                    ) : null}
                  </Pressable>
                );
              })}
            </Row>
            {suggested && !choice ? (
              <Txt size={12} color={p.muted}>
                {tr('Suggested by the smart description. Tap it to confirm, or tap what fits.', 'स्मार्ट विवरण से सुझाव। पक्का करने के लिए उसे दबाएँ, या जो सही हो वह दबाएँ।')}
              </Txt>
            ) : null}

            {choice && questions.length ? (
              <Card style={{ gap: 12 }}>
                {questions.map((q) => (
                  <View key={q.id} style={{ gap: 8 }}>
                    <Txt size={14.5} weight="500">
                      {q.text}
                    </Txt>
                    <Row style={{ gap: 8 }}>
                      {[true, false].map((v) => {
                        const on = answers[q.id] === v;
                        return (
                          <Pressable
                            key={String(v)}
                            accessibilityRole="button"
                            accessibilityState={{ selected: on }}
                            onPress={() => setAnswers((a) => ({ ...a, [q.id]: v }))}
                            style={{ height: 36, minWidth: 84, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: on ? p.accent : p.cardAlt, alignItems: 'center', justifyContent: 'center' }}
                          >
                            <Txt size={13.5} weight="600" color={on ? p.onAccent : p.text}>
                              {v ? tr('Yes', 'हाँ') : tr('No', 'नहीं')}
                            </Txt>
                          </Pressable>
                        );
                      })}
                    </Row>
                  </View>
                ))}
              </Card>
            ) : null}

            <Btn label={tr('Show what to do', 'क्या करें, देखें')} disabled={!choice} onPress={() => setShowResult(true)} size="lg" />
          </>
        ) : result ? (
          <>
            <Txt size={13} weight="600" color={p.text}>
              {tr('This check does not look at your photo. It uses your answers.', 'यह जाँच आपकी फ़ोटो को नहीं देखती। यह आपके जवाबों से चलती है।')}
            </Txt>
            <View style={{ backgroundColor: severityStyle[result.severity].bg, borderRadius: radius.xl, padding: 16, gap: 12 }}>
              <Txt size={18} weight="700" color={severityStyle[result.severity].ink}>
                {severityStyle[result.severity].title}
              </Txt>
              {result.severity === 'home' ? (
                <Txt size={13.5} color={severityStyle[result.severity].ink}>
                  {tr(WATCH_FOR[0], WATCH_FOR[1])}
                </Txt>
              ) : null}
              {result.severity === 'emergency' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('call112')}
                  onPress={() => void call112()}
                  style={{ height: 64, borderRadius: radius.pill, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}
                >
                  <Icon name="phone" size={22} color={p.danger} />
                  <Txt size={20} weight="700" color={p.danger}>
                    Call 112
                  </Txt>
                </Pressable>
              ) : null}
            </View>

            {result.reasons.length ? (
              <Card style={{ gap: 6 }}>
                <Txt size={11.5} weight="600" color={p.muted} style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  {tr('Why', 'क्यों')}
                </Txt>
                {result.reasons.map((r, i) => (
                  <Txt key={i} size={14}>
                    • {r}
                  </Txt>
                ))}
              </Card>
            ) : null}

            {result.guideIds.length ? (
              result.guideIds.map((id) => {
                const g = getGuide(id);
                return g ? <GuideView key={id} guide={g} /> : null;
              })
            ) : (
              <Txt size={13.5} color={p.muted}>
                {tr('No specific steps for this. Browse the guides, or ask a doctor or nurse.', 'इसके लिए अलग कदम नहीं हैं। गाइड देखें, या डॉक्टर या नर्स से पूछें।')}
              </Txt>
            )}

            <Row style={{ gap: 8, flexWrap: 'wrap' }}>
              <Btn label={tr('Check something else', 'कुछ और जाँचें')} kind="secondary" size="sm" onPress={reset} />
              <Btn label={tr('Done', 'हो गया')} kind="ghost" size="sm" onPress={done} />
            </Row>
          </>
        ) : null}

        <Txt size={11} color={p.muted} style={{ paddingTop: 6 }}>
          {DISCLAIMER[idx]}
        </Txt>
      </ScrollView>
    </View>
  );
}

