import React, { useState } from 'react';
import { Modal, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PersonalGuidance } from '../components/PersonalGuidance';
import { Screen } from '../components/Screen';
import { Appear, Btn, Card, Chip, Row, SectionTitle, Txt, useTheme } from '../components/ui';
import { useLang } from '../i18n';
import type { AgeBand, BuildingType, ConditionId, FloorLevel, GuidanceHazard, GuidancePhase, HouseholdMedicine, Person } from '../services/guidance';
import { useHousehold } from '../state/household';
import { radius } from '../theme';

type Pair = readonly [string, string];

const FLOORS: [FloorLevel, Pair][] = [
  ['basement', ['Basement', 'तहख़ाना']],
  ['ground', ['Ground', 'भूतल']],
  ['first', ['First', 'पहली']],
  ['second_up', ['Second or higher', 'दूसरी या ऊपर']],
];
const BUILDINGS: [BuildingType, Pair][] = [
  ['kutcha', ['Kutcha', 'कच्चा']],
  ['pucca', ['Pucca', 'पक्का']],
  ['apartment', ['Apartment', 'अपार्टमेंट']],
];
const AGES: [AgeBand, Pair][] = [
  ['child', ['Child', 'बच्चा']],
  ['adult', ['Adult', 'वयस्क']],
  ['elder', ['Elder', 'बुज़ुर्ग']],
];
const CONDITIONS: [ConditionId, Pair][] = [
  ['heart', ['Heart condition', 'हृदय रोग']],
  ['diabetes', ['Diabetes', 'मधुमेह']],
  ['insulin', ['Uses insulin', 'इंसुलिन लेते हैं']],
  ['asthma', ['Asthma / COPD', 'अस्थमा / सीओपीडी']],
  ['hypertension', ['High blood pressure', 'उच्च रक्तचाप']],
  ['pregnant', ['Pregnant', 'गर्भवती']],
  ['epilepsy', ['Epilepsy', 'मिर्गी']],
  ['mobility', ['Limited mobility', 'चलने में दिक़्क़त']],
  ['oxygen', ['Uses oxygen', 'ऑक्सीजन लेते हैं']],
  ['dialysis', ['Dialysis', 'डायलिसिस']],
  ['sensory', ['Vision / hearing', 'देखने / सुनने में दिक़्क़त']],
];
const PREVIEW_HAZARDS: [GuidanceHazard, Pair][] = [
  ['flood', ['Flood', 'बाढ़']],
  ['cyclone', ['Cyclone', 'चक्रवात']],
  ['earthquake', ['Earthquake', 'भूकंप']],
  ['heatwave', ['Heatwave', 'लू']],
  ['landslide', ['Landslide', 'भूस्खलन']],
  ['fire', ['Fire', 'आग']],
  ['tsunami', ['Tsunami', 'सुनामी']],
  ['lightning', ['Lightning', 'बिजली']],
];
const PREVIEW_PHASES: [GuidancePhase, Pair][] = [
  ['alert', ['Alert', 'अलर्ट']],
  ['prepare', ['Prepare', 'तैयारी']],
  ['recover', ['Recover', 'सँभलना']],
];

const mid = () => Math.random().toString(36).slice(2, 9);
const blank = (): Omit<Person, 'id'> => ({ name: '', age: 'adult', conditions: [], otherCondition: '', medicines: [], languages: [] });

function Chips<K extends string>({ items, value, onPick, hi }: { items: [K, Pair][]; value: K | null; onPick: (k: K | null) => void; hi: boolean }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {items.map(([k, l]) => (
        <Chip key={k} label={hi ? l[1] : l[0]} active={value === k} onPress={() => onPick(value === k ? null : k)} />
      ))}
    </View>
  );
}

export default function HouseholdScreen() {
  const { p } = useTheme();
  const hi = useLang() === 'hi';
  const t = (a: string, b: string) => (hi ? b : a);
  const people = useHousehold((s) => s.people);
  const home = useHousehold((s) => s.home);
  const setHome = useHousehold((s) => s.setHome);
  const addPerson = useHousehold((s) => s.addPerson);
  const updatePerson = useHousehold((s) => s.updatePerson);
  const removePerson = useHousehold((s) => s.removePerson);

  const [editing, setEditing] = useState<{ id: string | null; draft: Omit<Person, 'id'> } | null>(null);
  const [hazard, setHazard] = useState<GuidanceHazard>('flood');
  const [phase, setPhase] = useState<GuidancePhase>('alert');

  const input = { backgroundColor: p.cardAlt, borderRadius: radius.md, paddingHorizontal: 14, height: 42, color: p.text, fontSize: 14, fontFamily: 'Poppins_400Regular', paddingVertical: 0 } as const;
  const yesNo = (v: boolean | null, set: (b: boolean | null) => void) => (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Chip label={t('Yes', 'हाँ')} active={v === true} onPress={() => set(v === true ? null : true)} />
      <Chip label={t('No', 'नहीं')} active={v === false} onPress={() => set(v === false ? null : false)} />
    </View>
  );
  const q = (label: string, body: React.ReactNode) => (
    <View style={{ gap: 6 }}>
      <Txt size={12.5} weight="600" style={{ opacity: 0.75 }}>
        {label}
      </Txt>
      {body}
    </View>
  );

  const save = () => {
    if (!editing) return;
    const d = { ...editing.draft, name: editing.draft.name.trim(), medicines: editing.draft.medicines.filter((m) => m.name.trim()) };
    if (editing.id) updatePerson(editing.id, d);
    else addPerson(d);
    setEditing(null);
  };

  return (
    <Screen title={t('Your household', 'आपका घर-परिवार')}>
      <Appear>
        <Card tint="lilac" style={{ gap: 4 }}>
          <Txt size={14} weight="600" color={p.tint.lilac.ink}>
            {t('A few facts make the advice yours.', 'कुछ जानकारी से सलाह आपके अपने हिसाब की बनती है।')}
          </Txt>
          <Txt size={12} color={p.tint.lilac.ink} style={{ opacity: 0.7 }}>
            {t('Stays on this phone. Nothing is uploaded.', 'यह जानकारी इसी फ़ोन में रहती है। कुछ अपलोड नहीं होता।')}
          </Txt>
        </Card>
      </Appear>

      <SectionTitle>{t('Your home', 'आपका घर')}</SectionTitle>
      <Card style={{ gap: 14 }}>
        {q(t('Which floor do you live on?', 'आप किस मंज़िल पर रहते हैं?'), <Chips items={FLOORS} value={home.floor} onPick={(k) => setHome({ floor: k })} hi={hi} />)}
        {q(t('Type of house', 'घर का प्रकार'), <Chips items={BUILDINGS} value={home.building} onPick={(k) => setHome({ building: k })} hi={hi} />)}
        {q(t('Near a river, coast or low-lying area?', 'नदी, तट या नीचे इलाक़े के पास?'), yesNo(home.nearWater, (b) => setHome({ nearWater: b })))}
        {q(t('Do you have a vehicle?', 'क्या आपके पास वाहन है?'), yesNo(home.hasVehicle, (b) => setHome({ hasVehicle: b })))}
        {q(
          t('Pets', 'पालतू जानवर'),
          <Row style={{ gap: 8 }}>
            <Btn size="sm" kind="secondary" label="-" onPress={() => setHome({ pets: Math.max(0, home.pets - 1) })} />
            <Txt size={15} weight="600" style={{ minWidth: 24, textAlign: 'center' }}>
              {home.pets}
            </Txt>
            <Btn size="sm" kind="secondary" label="+" onPress={() => setHome({ pets: Math.min(20, home.pets + 1) })} />
          </Row>,
        )}
        {q(
          t('Saved shelter name', 'सहेजे आश्रय का नाम'),
          <TextInput
            value={home.shelterName ?? ''}
            onChangeText={(v) => setHome({ shelterName: v.trim() ? v : null })}
            placeholder={t('For example, Government School', 'जैसे, सरकारी स्कूल')}
            placeholderTextColor={p.muted}
            style={input}
          />,
        )}
        {q(
          t('Family meeting point', 'परिवार के मिलने की जगह'),
          <TextInput
            value={home.meetingPoint}
            onChangeText={(v) => setHome({ meetingPoint: v })}
            placeholder={t('For example, the temple gate', 'जैसे, मंदिर का गेट')}
            placeholderTextColor={p.muted}
            style={input}
          />,
        )}
      </Card>

      <SectionTitle right={<Btn size="sm" label={t('Add person', 'सदस्य जोड़ें')} icon="plus" onPress={() => setEditing({ id: null, draft: blank() })} />}>
        {t('People', 'सदस्य')}
      </SectionTitle>
      {people.length === 0 ? (
        <Card tint="yellow" style={{ gap: 6 }}>
          <Txt size={15} weight="700" color={p.tint.yellow.ink}>
            {t('No one added yet', 'अभी कोई नहीं जुड़ा')}
          </Txt>
          <Txt size={12.5} color={p.tint.yellow.ink} style={{ opacity: 0.75 }}>
            {t('Add yourself and the people you look after: children, elders, anyone with a health need.', 'ख़ुद को और जिनकी आप देखभाल करते हैं उन्हें जोड़ें: बच्चे, बुज़ुर्ग, या जिन्हें सेहत की ज़रूरत हो।')}
          </Txt>
        </Card>
      ) : (
        people.map((x) => (
          <Card key={x.id} style={{ gap: 6 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Txt size={15} weight="600">
                  {x.name || t('Unnamed', 'बिना नाम')}
                </Txt>
                <Txt size={11.5} color={p.muted}>
                  {t(AGES.find((a) => a[0] === x.age)![1][0], AGES.find((a) => a[0] === x.age)![1][1])}
                  {x.conditions.length
                    ? ' · ' + x.conditions.map((c) => (hi ? CONDITIONS.find((k) => k[0] === c)?.[1][1] : CONDITIONS.find((k) => k[0] === c)?.[1][0])).join(', ')
                    : ''}
                </Txt>
              </View>
              <Btn size="sm" kind="secondary" label={t('Edit', 'बदलें')} onPress={() => setEditing({ id: x.id, draft: { ...x } })} />
            </Row>
            {x.medicines.length ? (
              <Txt size={11.5} color={p.muted}>
                {x.medicines.map((m) => m.name).join(', ')}
              </Txt>
            ) : null}
          </Card>
        ))
      )}

      <SectionTitle>{t('Personalised guidance preview', 'व्यक्तिगत सलाह का पूर्वावलोकन')}</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {PREVIEW_PHASES.map(([k, l]) => (
          <Chip key={k} label={hi ? l[1] : l[0]} active={phase === k} onPress={() => setPhase(k)} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {PREVIEW_HAZARDS.map(([k, l]) => (
          <Chip key={k} label={hi ? l[1] : l[0]} active={hazard === k} onPress={() => setHazard(k)} />
        ))}
      </View>
      <PersonalGuidance phase={phase} hazard={hazard} severity={phase === 'alert' ? 'warning' : null} />

      <PersonModal
        editing={editing}
        setEditing={setEditing}
        onSave={save}
        onRemove={() => {
          if (editing?.id) removePerson(editing.id);
          setEditing(null);
        }}
        hi={hi}
      />
    </Screen>
  );
}

function PersonModal({
  editing,
  setEditing,
  onSave,
  onRemove,
  hi,
}: {
  editing: { id: string | null; draft: Omit<Person, 'id'> } | null;
  setEditing: (e: { id: string | null; draft: Omit<Person, 'id'> } | null) => void;
  onSave: () => void;
  onRemove: () => void;
  hi: boolean;
}) {
  const { p } = useTheme();
  const insets = useSafeAreaInsets();
  const t = (a: string, b: string) => (hi ? b : a);
  const input = { backgroundColor: p.cardAlt, borderRadius: radius.md, paddingHorizontal: 14, height: 42, color: p.text, fontSize: 14, fontFamily: 'Poppins_400Regular', paddingVertical: 0 } as const;
  const d = editing?.draft;
  const patch = (x: Partial<Omit<Person, 'id'>>) => editing && setEditing({ ...editing, draft: { ...editing.draft, ...x } });
  const setMed = (id: string, x: Partial<HouseholdMedicine>) => d && patch({ medicines: d.medicines.map((m) => (m.id === id ? { ...m, ...x } : m)) });

  return (
    <Modal visible={!!editing} animationType="slide" onRequestClose={() => setEditing(null)}>
      <View style={{ flex: 1, backgroundColor: p.bg, paddingTop: insets.top + 8 }}>
        {d ? (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
            <Txt size={20} weight="700">
              {editing?.id ? t('Edit person', 'सदस्य बदलें') : t('Add person', 'सदस्य जोड़ें')}
            </Txt>
            <TextInput value={d.name} onChangeText={(v) => patch({ name: v })} placeholder={t('Name', 'नाम')} placeholderTextColor={p.muted} style={input} />

            <Txt size={12.5} weight="600" style={{ opacity: 0.75 }}>
              {t('Age', 'आयु वर्ग')}
            </Txt>
            <Chips items={AGES} value={d.age} onPick={(k) => k && patch({ age: k })} hi={hi} />

            <Txt size={12.5} weight="600" style={{ opacity: 0.75 }}>
              {t('Health needs', 'सेहत की ज़रूरतें')}
            </Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {CONDITIONS.map(([k, l]) => (
                <Chip
                  key={k}
                  label={hi ? l[1] : l[0]}
                  active={d.conditions.includes(k)}
                  onPress={() => patch({ conditions: d.conditions.includes(k) ? d.conditions.filter((c) => c !== k) : [...d.conditions, k] })}
                />
              ))}
            </View>
            <TextInput value={d.otherCondition} onChangeText={(v) => patch({ otherCondition: v })} placeholder={t('Other (optional)', 'अन्य (वैकल्पिक)')} placeholderTextColor={p.muted} style={input} />

            <Txt size={12.5} weight="600" style={{ opacity: 0.75 }}>
              {t('Medicines (names only, no doses)', 'दवाइयाँ (सिर्फ़ नाम, मात्रा नहीं)')}
            </Txt>
            {d.medicines.map((m) => (
              <Card key={m.id} style={{ gap: 8 }}>
                <TextInput value={m.name} onChangeText={(v) => setMed(m.id, { name: v })} placeholder={t('Medicine name', 'दवा का नाम')} placeholderTextColor={p.muted} style={input} />
                <Row style={{ flexWrap: 'wrap' }}>
                  <Chip label={t('Must not miss', 'छूटनी नहीं चाहिए')} active={m.critical} onPress={() => setMed(m.id, { critical: !m.critical })} />
                  <TextInput
                    value={m.daysLeft == null ? '' : String(m.daysLeft)}
                    onChangeText={(v) => {
                      const n = parseInt(v.replace(/\D/g, ''), 10);
                      setMed(m.id, { daysLeft: Number.isFinite(n) ? Math.min(n, 999) : null });
                    }}
                    keyboardType="number-pad"
                    placeholder={t('Days of stock', 'कितने दिन का स्टॉक')}
                    placeholderTextColor={p.muted}
                    style={[input, { flex: 1, minWidth: 120 }]}
                  />
                  <Btn size="sm" kind="ghost" label={t('Remove', 'हटाएँ')} onPress={() => patch({ medicines: d.medicines.filter((x) => x.id !== m.id) })} />
                </Row>
              </Card>
            ))}
            <View style={{ alignSelf: 'flex-start' }}>
              <Btn size="sm" kind="secondary" icon="plus" label={t('Add medicine', 'दवा जोड़ें')} onPress={() => patch({ medicines: [...d.medicines, { id: mid(), name: '', critical: false, daysLeft: null }] })} />
            </View>

            <Txt size={12.5} weight="600" style={{ opacity: 0.75 }}>
              {t('Languages spoken', 'बोली जाने वाली भाषाएँ')}
            </Txt>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[
                ['Hindi', 'हिन्दी'],
                ['English', 'English'],
              ].map(([k, l]) => (
                <Chip
                  key={k}
                  label={hi ? l : k}
                  active={d.languages.includes(k)}
                  onPress={() => patch({ languages: d.languages.includes(k) ? d.languages.filter((x) => x !== k) : [...d.languages, k] })}
                />
              ))}
            </View>

            <Row style={{ marginTop: 6 }}>
              <Btn label={t('Save', 'सहेजें')} onPress={onSave} style={{ flex: 1 }} />
              <Btn kind="secondary" label={t('Cancel', 'रद्द करें')} onPress={() => setEditing(null)} />
            </Row>
            {editing?.id ? <Btn kind="danger" size="sm" label={t('Remove this person', 'इस सदस्य को हटाएँ')} onPress={onRemove} /> : null}
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  );
}
