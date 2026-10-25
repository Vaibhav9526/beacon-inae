import React, { useState } from 'react';
import { Linking, TextInput, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Appear, Btn, Card, Chip, Row, SectionTitle, Txt, useTheme } from '../components/ui';
import { useT } from '../i18n';
import { useSettings } from '../state/settings';
import { radius } from '../theme';

const GROUPS = ['A+', 'A−', 'B+', 'B−', 'AB+', 'AB−', 'O+', 'O−'];

export default function Medical() {
  const { p } = useTheme();
  const t = useT();
  const m = useSettings((s) => s.medical);
  const contacts = useSettings((s) => s.contacts);
  const set = useSettings((s) => s.set);
  const [cname, setCname] = useState('');
  const [cphone, setCphone] = useState('');
  const upd = (k: keyof typeof m, v: string) => set({ medical: { ...m, [k]: v } });
  const input = { backgroundColor: p.cardAlt, borderRadius: radius.md, paddingHorizontal: 14, height: 42, color: p.text, fontSize: 14, fontFamily: 'Lexend_400Regular', paddingVertical: 0 } as const;

  return (
    <Screen title={t('medicalId')}>
      <Txt size={12} color={p.muted}>
        {t('medicalIdHint')}
      </Txt>
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
        <Card key={i} style={{ padding: 12 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View>
              <Txt size={14.5} weight="500">
                {c.name}
              </Txt>
              <Txt size={12} color={p.muted}>
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
    </Screen>
  );
}
