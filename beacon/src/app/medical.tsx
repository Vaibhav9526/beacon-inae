import React, { useMemo, useState } from 'react';
import { Linking, Modal, ScrollView, Share, TextInput, View } from 'react-native';
import { Cross } from '../components/Deco';
import { Icon } from '../components/Icon';
import { MedicalQr } from '../components/MedicalQr';
import { Screen } from '../components/Screen';
import { Appear, Btn, Card, Chip, Press, Row, SectionTitle, Txt, useTheme } from '../components/ui';
import { useLang, useT } from '../i18n';
import { buildCardText } from '../services/medicalCard';
import { useSettings } from '../state/settings';
import { radius } from '../theme';

const GROUPS = ['A+', 'A−', 'B+', 'B−', 'AB+', 'AB−', 'O+', 'O−'];

export default function Medical() {
  const { p } = useTheme();
  const t = useT();
  const lang = useLang();
  const hi = lang === 'hi';
  const m = useSettings((s) => s.medical);
  const contacts = useSettings((s) => s.contacts);
  const set = useSettings((s) => s.set);
  const [cname, setCname] = useState('');
  const [cphone, setCphone] = useState('');
  const [showing, setShowing] = useState(false);
  const upd = (k: keyof typeof m, v: string) => set({ medical: { ...m, [k]: v } });
  const input = { backgroundColor: p.cardAlt, borderRadius: radius.md, paddingHorizontal: 14, height: 42, color: p.text, fontSize: 14, fontFamily: 'Poppins_400Regular', paddingVertical: 0 } as const;

  const profile = useMemo(() => ({ ...m, contacts }), [m, contacts]);
  const cardText = useMemo(() => buildCardText(profile, lang), [profile, lang]);
  const hasDetails =
    [m.fullName, m.bloodGroup, m.allergies, m.conditions, m.medicines, m.notes].some((v) => v.trim().length > 0) ||
    contacts.some((c) => c.phone.trim().length > 0);
  const callableContacts = contacts.filter((c) => c.phone.trim().length > 0);
  const name = m.fullName.trim() || (hi ? 'मेडिकल कार्ड' : 'Medical card');

  const shareText = async () => {
    try {
      await Share.share({ message: cardText, title: hi ? 'मेडिकल कार्ड' : 'Medical card' });
    } catch {
      // dismissed
    }
  };

  return (
    <Screen title={t('medicalId')}>
      <Appear>
        <Card tint="pink" style={{ gap: 12 }}>
          <View style={{ gap: 3 }}>
            <Txt size={24} weight="700" color={p.tint.pink.ink}>
              {hi ? 'मेडिकल कार्ड' : 'Medical card'}
            </Txt>
            <Txt size={12.5} color={p.tint.pink.ink} style={{ opacity: 0.82 }}>
              {hasDetails
                ? hi
                  ? 'किसी भी फ़ोन के कैमरे से स्कैन करें। इंटरनेट या ऐप की ज़रूरत नहीं।'
                  : 'Scan with any phone camera. No internet or app needed.'
                : hi
                  ? 'अपनी जानकारी भरें'
                  : 'Fill in your details'}
            </Txt>
          </View>

          {hasDetails ? (
            <>
              <Row style={{ gap: 12 }}>
                <View style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 6 }}>
                  <MedicalQr text={cardText} size={92} />
                </View>
                <Btn
                  label={hi ? 'बचावकर्मी को दिखाएँ' : 'Show to responder'}
                  icon="eye"
                  style={{ flex: 1 }}
                  onPress={() => setShowing(true)}
                />
              </Row>
              <Btn
                label={hi ? 'टेक्स्ट साझा करें' : 'Share text'}
                icon="send"
                kind="secondary"
                onPress={() => void shareText()}
              />
            </>
          ) : (
            <Row style={{ gap: 14, alignItems: 'center' }}>
              <Cross size={64} />
              <Txt size={13} color={p.tint.pink.ink} style={{ flex: 1 }}>
                {hi
                  ? 'नाम, रक्त समूह और एलर्जी भरें। फिर QR कार्ड यहाँ दिखेगा।'
                  : 'Add your name, blood group and allergies. The QR card then appears here.'}
              </Txt>
            </Row>
          )}
        </Card>
      </Appear>

      <Card tint="pink" style={{ overflow: 'hidden', minHeight: 110, justifyContent: 'center', paddingRight: 92 }}>
        <Txt size={14} weight="600" color={p.tint.pink.ink}>
          {t('medicalIdHint')}
        </Txt>
        <View pointerEvents="none" style={{ position: 'absolute', right: -12, top: -14, transform: [{ rotate: '12deg' }] }}>
          <Cross size={88} />
        </View>
      </Card>
      <Appear>
        <Card style={{ gap: 10 }}>
          <TextInput value={m.fullName} onChangeText={(v) => upd('fullName', v)} placeholder={t('yourName')} placeholderTextColor={p.muted} style={input} />
          <Txt size={12} color={p.muted}>
            {t('bloodGroup')}
          </Txt>
          <Row style={{ flexWrap: 'wrap', gap: 6 }}>
            {GROUPS.map((g) => (
              <Chip key={g} label={g} active={m.bloodGroup === g} onPress={() => upd('bloodGroup', m.bloodGroup === g ? '' : g)} />
            ))}
          </Row>
          <TextInput value={m.allergies} onChangeText={(v) => upd('allergies', v)} placeholder={t('allergies')} placeholderTextColor={p.muted} style={input} />
          <TextInput value={m.conditions} onChangeText={(v) => upd('conditions', v)} placeholder={t('conditions')} placeholderTextColor={p.muted} style={input} />
          <TextInput value={m.medicines} onChangeText={(v) => upd('medicines', v)} placeholder={t('medicines')} placeholderTextColor={p.muted} style={input} />
          <TextInput value={m.notes} onChangeText={(v) => upd('notes', v)} placeholder={t('notes')} placeholderTextColor={p.muted} style={[input, { height: 70, paddingTop: 10, textAlignVertical: 'top' }]} multiline />
        </Card>
      </Appear>

      <SectionTitle>{t('emergencyContacts')}</SectionTitle>
      {contacts.map((c, i) => (
        <Card key={i} tint={(['pink', 'yellow', 'blue', 'green', 'lilac', 'peach'] as const)[i % 6]} style={{ padding: 14 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View>
              <Txt size={15} weight="700" color="#0A0A0C">
                {c.name}
              </Txt>
              <Txt size={12} color="#0A0A0C">
                {c.phone}
              </Txt>
            </View>
            <Row style={{ gap: 6 }}>
              <Btn size="sm" icon="phone" label="" onPress={() => void Linking.openURL(`tel:${c.phone}`)} />
              <Btn size="sm" kind="ghost" icon="close" label="" onPress={() => set({ contacts: contacts.filter((_, k) => k !== i) })} />
            </Row>
          </Row>
        </Card>
      ))}
      <Card style={{ gap: 8 }}>
        <TextInput value={cname} onChangeText={setCname} placeholder={t('yourName')} placeholderTextColor={p.muted} style={input} />
        <TextInput value={cphone} onChangeText={setCphone} placeholder={t('phone')} placeholderTextColor={p.muted} keyboardType="phone-pad" style={input} />
        <Btn
          label={t('addContact')}
          icon="plus"
          disabled={!cname.trim() || !cphone.trim()}
          onPress={() => {
            set({ contacts: [...contacts, { name: cname.trim(), phone: cphone.trim() }] });
            setCname('');
            setCphone('');
          }}
        />
      </Card>

      <Modal visible={showing} animationType="fade" statusBarTranslucent onRequestClose={() => setShowing(false)}>
        <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
          <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 36, paddingBottom: 120, gap: 16 }} showsVerticalScrollIndicator={false}>
            <Txt size={40} weight="700" color="#0A0A0C" style={{ lineHeight: 44 }}>
              {name}
            </Txt>

            {m.bloodGroup.trim() ? (
              <View style={{ alignSelf: 'flex-start', backgroundColor: '#E0284F', borderRadius: radius.pill, paddingHorizontal: 24, paddingVertical: 6 }}>
                <Txt size={38} weight="700" color="#FFFFFF">
                  {m.bloodGroup}
                </Txt>
              </View>
            ) : null}

            {m.allergies.trim() ? (
              <View style={{ gap: 2 }}>
                <Txt size={13} weight="600" color="#6F6B80">
                  {hi ? 'एलर्जी' : 'Allergies'}
                </Txt>
                <Txt size={26} weight="700" color="#0A0A0C">
                  {m.allergies}
                </Txt>
              </View>
            ) : null}

            {m.conditions.trim() ? (
              <View style={{ gap: 2 }}>
                <Txt size={13} weight="600" color="#6F6B80">
                  {hi ? 'बीमारियाँ' : 'Conditions'}
                </Txt>
                <Txt size={26} weight="700" color="#0A0A0C">
                  {m.conditions}
                </Txt>
              </View>
            ) : null}

            {m.medicines.trim() ? (
              <View style={{ gap: 2 }}>
                <Txt size={13} weight="600" color="#6F6B80">
                  {hi ? 'दवाइयाँ' : 'Medicines'}
                </Txt>
                <Txt size={20} weight="600" color="#0A0A0C">
                  {m.medicines}
                </Txt>
              </View>
            ) : null}

            {callableContacts.length ? (
              <View style={{ gap: 8 }}>
                <Txt size={13} weight="600" color="#6F6B80">
                  {hi ? 'आपातकालीन संपर्क' : 'Emergency contacts'}
                </Txt>
                {callableContacts.map((c, i) => (
                  <Press
                    key={`${c.phone}-${i}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${hi ? 'कॉल करें' : 'Call'} ${c.name || c.phone}`}
                    onPress={() => void Linking.openURL(`tel:${c.phone}`)}
                    style={{ minHeight: 62, borderRadius: 18, backgroundColor: '#F4F0FE', paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#0A0A0C', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="phone" size={18} color="#FFFFFF" />
                    </View>
                    <View style={{ flex: 1 }}>
                      {c.name.trim() ? (
                        <Txt size={18} weight="700" color="#0A0A0C">
                          {c.name}
                        </Txt>
                      ) : null}
                      <Txt size={18} weight="600" color="#0A0A0C">
                        {c.phone}
                      </Txt>
                    </View>
                  </Press>
                ))}
              </View>
            ) : null}

            <View style={{ alignItems: 'center', gap: 6, marginTop: 4 }}>
              <View style={{ backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5DFF5', borderRadius: 18, padding: 8 }}>
                <MedicalQr text={cardText} size={190} />
              </View>
              <Txt size={12} color="#6F6B80">
                {hi ? 'किसी भी फ़ोन के कैमरे से स्कैन करें' : 'Scan with any phone camera'}
              </Txt>
            </View>
          </ScrollView>

          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, alignItems: 'center', backgroundColor: '#FFFFFF' }}>
            <Btn label={hi ? 'बंद करें' : 'Close'} icon="close" kind="secondary" style={{ minWidth: 180 }} onPress={() => setShowing(false)} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
