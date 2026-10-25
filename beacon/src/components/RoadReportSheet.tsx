import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { Lang } from '../kb/types';
import type { T } from '../kb/types';
import type { RoadStatus } from '../mesh/appTypes';
import { type Fix, getFix } from '../services/location';
import { useMesh } from '../services/mesh';
import type { TrustLevel } from '../services/roadStatus';
import { fonts, radius } from '../theme';
import { Icon, type IconName } from './Icon';
import { Btn, Card, Press, Row, Txt, useTheme } from './ui';

// ---- shared look of road reports (the sheet, the /road list and the map markers use these) ----
export const ROAD_COLOR: Record<RoadStatus, string> = { blocked: '#D14B4B', flooded: '#2F7FB5', damaged: '#C2571A', crowded: '#7B7B86', clear: '#2E9B5F' };
export const ROAD_ICON: Record<RoadStatus, IconName> = { blocked: 'close', flooded: 'flood', damaged: 'alert', crowded: 'family', clear: 'check' };
export const ROAD_LABEL: Record<RoadStatus, T> = {
  blocked: ['Blocked', 'बंद'],
  flooded: ['Flooded', 'पानी भरा'],
  damaged: ['Damaged', 'टूटी सड़क'],
  crowded: ['Crowded', 'भीड़'],
  clear: ['Clear now', 'अब साफ़'],
};
export const ROAD_NOUN: Record<RoadStatus, T> = {
  blocked: ['blocked road', 'बंद सड़क'],
  flooded: ['flood', 'बाढ़'],
  damaged: ['damaged road', 'टूटी सड़क'],
  crowded: ['crowd', 'भीड़'],
  clear: ['clear road', 'साफ़ सड़क'],
};
const STATUSES: RoadStatus[] = ['blocked', 'flooded', 'damaged', 'crowded', 'clear'];
export const TRUST_TEXT: Record<TrustLevel, T> = {
  low: ['Not confirmed yet', 'अभी पुष्टि नहीं हुई'],
  medium: ['Confirmed by 1 phone', '1 फ़ोन ने पुष्टि की'],
  high: ['Confirmed by phones nearby', 'आस-पास के फ़ोनों ने पुष्टि की'],
};

/** "Confirmed by 3 phones" or "Not confirmed yet", with Hindi. */
export function trustLabel(attesters: number, verified: boolean): T {
  if (attesters >= 1) return [`Confirmed by ${attesters} phone${attesters === 1 ? '' : 's'}`, `${attesters} फ़ोन ने पुष्टि की`];
  if (verified) return ['Confirmed', 'पुष्टि हो चुकी'];
  return TRUST_TEXT.low;
}

const EN_DIR: Record<string, string> = { N: 'north', NE: 'north-east', E: 'east', SE: 'south-east', S: 'south', SW: 'south-west', W: 'west', NW: 'north-west' };
const HI_DIR: Record<string, string> = { N: 'उत्तर', NE: 'उत्तर-पूर्व', E: 'पूर्व', SE: 'दक्षिण-पूर्व', S: 'दक्षिण', SW: 'दक्षिण-पश्चिम', W: 'पश्चिम', NW: 'उत्तर-पश्चिम' };
export const compassPair = (word: string): T => [EN_DIR[word] ?? word, HI_DIR[word] ?? word];

/** "12 min ago" / "3 h ago" with Hindi. */
export function agePair(ms: number): T {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return ['just now', 'अभी'];
  if (m < 60) return [`${m} min ago`, `${m} मिनट पहले`];
  const h = Math.round(m / 60);
  return [`${h} h ago`, `${h} घंटे पहले`];
}
export const pick = (t: T, lang: Lang) => (lang === 'hi' ? t[1] : t[0]);

/** A small map diamond; dashed and faint when the report is not confirmed. */
export function Diamond({ color, size = 14, dashed }: { color: string; size?: number; dashed?: boolean }) {
  const c = size / 2;
  return (
    <Svg width={size} height={size}>
      <Path d={`M${c} 1.5L${size - 1.5} ${c}L${c} ${size - 1.5}L1.5 ${c}Z`} fill={color} fillOpacity={dashed ? 0.45 : 1} stroke={dashed ? color : '#FFFFFF'} strokeWidth={dashed ? 1.4 : 1.2} strokeDasharray={dashed ? '2.5 2' : undefined} />
    </Svg>
  );
}

const hex8 = () => Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

const MSG_SENT: T = [
  'Sent to phones nearby. It may take a few minutes to spread. More phones near you will confirm it.',
  'आस-पास के फ़ोनों को भेज दिया। फैलने में कुछ मिनट लग सकते हैं। आपके पास के और फ़ोन इसकी पुष्टि करेंगे।',
];
const MSG_ALONE: T = [
  'No phones nearby yet: it will spread when one comes within range.',
  'अभी आस-पास कोई फ़ोन नहीं: कोई फ़ोन पास आते ही यह फैल जाएगा।',
];
const MSG_NO_FIX: T = [
  'Could not find your location. Go outside or turn on location, then try again.',
  'आपकी लोकेशन नहीं मिली। बाहर जाएँ या लोकेशन चालू करें, फिर दोबारा कोशिश करें।',
];
const MSG_OFF: T = ['The Bluetooth mesh is off, so this cannot be sent. Turn it on in Community.', 'ब्लूटूथ मेश बंद है, इसलिए भेज नहीं सकते। कम्युनिटी में इसे चालू करें।'];

/** Bottom sheet for reporting what you see on a road. Sends over the mesh; nearby phones then attest it. */
export function RoadReportSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { p } = useTheme();
  const neighbours = useMesh((s) => s.neighbours);
  const [status, setStatus] = useState<RoadStatus | null>(null);
  const [note, setNote] = useState('');
  const [fix, setFix] = useState<Fix | null>(null);
  const [locating, setLocating] = useState(false);
  const [noFix, setNoFix] = useState(false);
  const [sent, setSent] = useState<{ id: string; alone: boolean } | null>(null);
  const [problem, setProblem] = useState<T | null>(null);

  const locate = useCallback(async () => {
    setLocating(true);
    setNoFix(false);
    const f = await getFix({ maxWaitMs: 6000 }).catch(() => null);
    setLocating(false);
    if (f) {
      setFix(f);
      useMesh.getState().setPosition(f.lat, f.lon);
    } else setNoFix(true);
  }, []);

  useEffect(() => {
    if (!visible) return;
    setSent(null);
    setProblem(null);
    setStatus(null);
    setNote('');
    void locate();
  }, [visible, locate]);

  const send = () => {
    if (!status || !fix) return;
    const mesh = useMesh.getState();
    if (!mesh.running) {
      setProblem(MSG_OFF);
      return;
    }
    const id = hex8();
    const trimmed = note.trim().slice(0, 120);
    const out: unknown = mesh.sendRoad({ id, status, lat: fix.lat, lon: fix.lon, ...(trimmed ? { note: trimmed } : {}), seenAt: Date.now() });
    if (out === null) {
      setProblem(MSG_OFF);
      return;
    }
    setProblem(null);
    setSent({ id: typeof out === 'string' ? out : id, alone: useMesh.getState().neighbours === 0 });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Press accessibilityLabel="Close" haptic={false} onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(20,20,30,0.45)' } as never}>
          <View style={{ flex: 1 }} />
        </Press>
        <View style={{ maxHeight: '88%', backgroundColor: p.sheet, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, overflow: 'hidden' }}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Txt size={20} weight="700">
                  Report a road problem
                </Txt>
                <Txt size={12.5} color={p.muted}>
                  सड़क की समस्या बताएँ
                </Txt>
              </View>
              <Press accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: p.cardAlt, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={16} color={p.text} />
              </Press>
            </Row>

            {sent ? (
              <Card tint="green" style={{ gap: 6 }}>
                <Row>
                  <Icon name="check" size={18} color={p.tint.green.ink} />
                  <Txt size={14} weight="700">
                    Sent · भेज दिया
                  </Txt>
                </Row>
                <Txt size={13}>{MSG_SENT[0]}</Txt>
                <Txt size={12} style={{ opacity: 0.8 }}>
                  {MSG_SENT[1]}
                </Txt>
                {sent.alone ? (
                  <View style={{ marginTop: 4, gap: 2 }}>
                    <Txt size={13} weight="600">
                      {MSG_ALONE[0]}
                    </Txt>
                    <Txt size={12} style={{ opacity: 0.8 }}>
                      {MSG_ALONE[1]}
                    </Txt>
                  </View>
                ) : null}
                <View style={{ alignSelf: 'flex-start', marginTop: 6 }}>
                  <Btn size="sm" label="Done · हो गया" onPress={onClose} />
                </View>
              </Card>
            ) : (
              <>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {STATUSES.map((st) => {
                    const on = status === st;
                    const col = ROAD_COLOR[st];
                    return (
                      <Press
                        key={st}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={`${ROAD_LABEL[st][0]} ${ROAD_LABEL[st][1]}`}
                        onPress={() => setStatus(st)}
                        style={{ width: '47.5%', minHeight: 84, borderRadius: 24, padding: 12, gap: 6, backgroundColor: on ? col : col + '1F', borderWidth: on ? 0 : 1, borderColor: col + '55', justifyContent: 'center' }}>
                        <Icon name={ROAD_ICON[st]} size={22} color={on ? '#FFFFFF' : col} />
                        <View>
                          <Txt size={14} weight="700" color={on ? '#FFFFFF' : p.text}>
                            {ROAD_LABEL[st][0]}
                          </Txt>
                          <Txt size={11.5} color={on ? '#FFFFFF' : p.muted}>
                            {ROAD_LABEL[st][1]}
                          </Txt>
                        </View>
                      </Press>
                    );
                  })}
                </View>

                <View>
                  <TextInput
                    value={note}
                    onChangeText={(v) => setNote(v.slice(0, 120))}
                    maxLength={120}
                    placeholder="Short note (optional) · छोटा नोट (वैकल्पिक)"
                    placeholderTextColor={p.muted}
                    multiline
                    style={{ minHeight: 56, borderRadius: 20, borderWidth: 1, borderColor: p.border, backgroundColor: p.card, color: p.text, paddingHorizontal: 14, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 14, textAlignVertical: 'top' }}
                  />
                  <Txt size={11} color={p.muted} style={{ alignSelf: 'flex-end', marginTop: 2 }}>
                    {note.length}/120
                  </Txt>
                </View>

                <Card style={{ gap: 8 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Row style={{ flex: 1, gap: 8 }}>
                      <Icon name="pin" size={16} color={fix ? '#2E9B5F' : p.muted} />
                      <Txt size={12.5} weight="600" style={{ flex: 1 }}>
                        {fix ? `Location ready · ${fix.lat.toFixed(4)}, ${fix.lon.toFixed(4)}` : locating ? 'Finding you... · लोकेशन ढूँढ रहे हैं' : 'No location yet · लोकेशन नहीं मिली'}
                      </Txt>
                    </Row>
                    <Btn size="sm" kind="secondary" icon="navigate" label={fix ? 'Refresh · ताज़ा' : 'Use my location · मेरी लोकेशन'} onPress={() => void locate()} disabled={locating} />
                  </Row>
                  {noFix ? (
                    <View style={{ gap: 2 }}>
                      <Txt size={12.5} color={p.danger} weight="600">
                        {MSG_NO_FIX[0]}
                      </Txt>
                      <Txt size={12} color={p.danger}>
                        {MSG_NO_FIX[1]}
                      </Txt>
                    </View>
                  ) : null}
                </Card>

                {neighbours === 0 ? (
                  <Card tint="yellow" style={{ gap: 2 }}>
                    <Txt size={12.5} weight="600">
                      {MSG_ALONE[0]}
                    </Txt>
                    <Txt size={12} style={{ opacity: 0.8 }}>
                      {MSG_ALONE[1]}
                    </Txt>
                  </Card>
                ) : null}

                {problem ? (
                  <View style={{ gap: 2 }}>
                    <Txt size={12.5} color={p.danger} weight="600">
                      {problem[0]}
                    </Txt>
                    <Txt size={12} color={p.danger}>
                      {problem[1]}
                    </Txt>
                  </View>
                ) : null}

                <Btn size="lg" icon="send" label={status ? 'Send · भेजें' : 'Pick what you see · चुनें'} disabled={!status || !fix} onPress={send} />
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
