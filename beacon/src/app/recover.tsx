import { router } from 'expo-router';
import React, { useState } from 'react';
import { Linking, Share, TextInput, View } from 'react-native';
import { Flower, Shield, Sun } from '../components/Deco';
import { Screen } from '../components/Screen';
import { Appear, Btn, Card, Chip, Press, Txt, useTheme } from '../components/ui';
import { HELPLINES, RECOVERY_GROUPS, groupProgress } from '../kb/recovery';
import { sendSafeNow } from '../services/sos';
import { type PersonStatus, toPfif } from '../services/pfif';
import { useRecovery } from '../state/recovery';
import { useSettings } from '../state/settings';
import { pick } from '../kb/types';
import { radius } from '../theme';

const STATUS_LABEL: Record<PersonStatus, [string, string]> = {
  safe: ['Safe', 'सुरक्षित'],
  looking: ['Looking', 'खोज जारी'],
  found: ['Found', 'मिल गए'],
  unknown: ['Unknown', 'अज्ञात'],
};

export default function Recover() {
  const { p } = useTheme();
  const lang = useSettings((s) => s.lang);
  const myName = useSettings((s) => s.nickname || s.kidName);
  const people = useRecovery((s) => s.people);
  const done = useRecovery((s) => s.done);
  const markSafe = useRecovery((s) => s.markSafe);
  const lookingFor = useRecovery((s) => s.lookingFor);
  const setFound = useRecovery((s) => s.setFound);
  const removePerson = useRecovery((s) => s.removePerson);
  const toggleItem = useRecovery((s) => s.toggleItem);

  const [lookName, setLookName] = useState('');
  const [lookNote, setLookNote] = useState('');
  const [sendNote, setSendNote] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ [RECOVERY_GROUPS[0].id]: true });

  const tx = (en: string, hi: string) => pick([en, hi] as const, lang);
  const me = people.find((x) => x.id === 'self');
  const others = people.filter((x) => x.id !== 'self');
  const count = (st: PersonStatus) => people.filter((x) => x.status === st).length;
  const progress = groupProgress(done);

  const input = {
    backgroundColor: p.cardAlt,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    height: 42,
    color: p.text,
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    paddingVertical: 0,
  } as const;

  const onSafe = async () => {
    markSafe(myName || 'Me', sendNote);
    try {
      await sendSafeNow(sendNote);
    } catch {
      // saved on this phone already; it goes out when a signal or mesh neighbour is available
    }
  };

  const onAdd = () => {
    const name = lookName.trim();
    if (!name) return;
    lookingFor(name, lookNote);
    setLookName('');
    setLookNote('');
  };

  const onExport = () => {
    const xml = toPfif(people, Date.now());
    Share.share({ title: tx('Beacon missing-person list', 'बीकन लापता व्यक्ति सूची'), message: xml }).catch(() => {});
  };

  return (
    <Screen title={tx('Recover', 'पुनर्वास')}>
      {/* hero */}
      <Appear>
        <Card tint="lilac" style={{ overflow: 'hidden', minHeight: 150, justifyContent: 'center', paddingRight: 110 }}>
          <Txt size={26} weight="700" color={p.tint.lilac.ink}>
            {tx('You are not alone', 'आप अकेले नहीं हैं')}
          </Txt>
          <Txt size={14} weight="500" style={{ marginTop: 6 }}>
            {tx(
              `${count('safe')} safe, ${count('looking')} looking, ${count('found')} found`,
              `${count('safe')} सुरक्षित, ${count('looking')} की खोज जारी, ${count('found')} मिले`,
            )}
          </Txt>
          <View pointerEvents="none" style={{ position: 'absolute', right: -10, top: -10, transform: [{ rotate: '8deg' }] }}>
            <Flower size={110} />
          </View>
        </Card>
      </Appear>

      {/* check-in board */}
      <Txt size={18} weight="700" style={{ marginTop: 22, marginBottom: 10 }}>
        {tx('Check-in board', 'चेक-इन बोर्ड')}
      </Txt>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Appear index={1} style={{ flex: 1 }}>
          <Card tint="green" style={{ flex: 1, minHeight: 190, justifyContent: 'space-between' }}>
            <View>
              <Txt size={13} weight="600">{tx('Me', 'मैं')}</Txt>
              <Txt size={17} weight="700" style={{ marginTop: 4 }}>
                {me ? tx('Marked safe', 'सुरक्षित दर्ज') : tx('Not yet marked', 'अभी दर्ज नहीं')}
              </Txt>
            </View>
            <TextInput
              value={sendNote}
              onChangeText={setSendNote}
              placeholder={tx('Short note (optional)', 'छोटा नोट (ज़रूरी नहीं)')}
              placeholderTextColor={p.muted}
              style={[input, { marginTop: 10, backgroundColor: 'rgba(255,255,255,0.55)' }]}
            />
            <Btn label={tx('I am safe', 'मैं सुरक्षित हूँ')} onPress={onSafe} size="md" style={{ marginTop: 10 }} />
          </Card>
        </Appear>

        <Appear index={2} style={{ flex: 1 }}>
          <Card tint="yellow" style={{ flex: 1, minHeight: 190, justifyContent: 'space-between' }}>
            <View>
              <Txt size={13} weight="600">{tx('Damage', 'नुकसान')}</Txt>
              <Txt size={17} weight="700" style={{ marginTop: 4 }}>
                {tx('Show what happened to your home', 'घर पर क्या हुआ, दिखाएँ')}
              </Txt>
            </View>
            <View style={{ position: 'absolute', right: -6, bottom: 46 }} pointerEvents="none">
              <Sun size={58} />
            </View>
            <Btn
              label={tx('Report damage', 'नुकसान बताएँ')}
              icon="camera"
              kind="primary"
              onPress={() => router.push('/report/new')}
              style={{ marginTop: 10 }}
            />
          </Card>
        </Appear>
      </View>

      {/* people I am looking for */}
      <Appear index={3}>
        <Card style={{ marginTop: 10 }}>
          <Txt size={16} weight="700">{tx('People I am looking for', 'जिन्हें मैं खोज रहा/रही हूँ')}</Txt>
          <View style={{ gap: 8, marginTop: 10 }}>
            <TextInput
              value={lookName}
              onChangeText={setLookName}
              placeholder={tx('Name', 'नाम')}
              placeholderTextColor={p.muted}
              style={input}
            />
            <TextInput
              value={lookNote}
              onChangeText={setLookNote}
              placeholder={tx('Where last seen, clothes, age', 'आख़िरी बार कहाँ देखा, कपड़े, उम्र')}
              placeholderTextColor={p.muted}
              style={input}
            />
            <Btn label={tx('Add to list', 'सूची में जोड़ें')} icon="pin" kind="secondary" onPress={onAdd} disabled={!lookName.trim()} />
          </View>

          {others.length === 0 ? (
            <Txt size={13} color={p.muted} style={{ marginTop: 12 }}>
              {tx('No one on the list yet.', 'अभी सूची में कोई नहीं है।')}
            </Txt>
          ) : (
            others.map((x) => (
              <View key={x.id} style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: p.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <Txt size={15} weight="600" style={{ flex: 1 }}>{x.fullName}</Txt>
                  <Chip label={pick(STATUS_LABEL[x.status], lang)} />
                </View>
                {x.note ? <Txt size={13} color={p.muted} style={{ marginTop: 2 }}>{x.note}</Txt> : null}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  {x.status === 'looking' ? (
                    <Btn label={tx('Found', 'मिल गए')} size="sm" kind="secondary" onPress={() => setFound(x.id)} />
                  ) : null}
                  <Btn label={tx('Remove', 'हटाएँ')} size="sm" kind="ghost" onPress={() => removePerson(x.id)} />
                </View>
              </View>
            ))
          )}
        </Card>
      </Appear>

      <Btn
        label={tx('Export for Person Finder', 'Person Finder के लिए निर्यात करें')}
        icon="family"
        kind="secondary"
        size="lg"
        onPress={onExport}
        style={{ marginTop: 12 }}
      />
      <Txt size={12} color={p.muted} style={{ marginTop: 6 }}>
        {tx(
          'Shares a PFIF 1.4 file you can send to Google Person Finder or any PFIF-aware tool.',
          'PFIF 1.4 फ़ाइल साझा करता है, जिसे Google Person Finder या किसी PFIF टूल में भेजा जा सकता है।',
        )}
      </Txt>

      {/* checklist */}
      <Txt size={18} weight="700" style={{ marginTop: 26, marginBottom: 10 }}>
        {tx('Recovery checklist', 'पुनर्वास चेकलिस्ट')}
      </Txt>
      <View style={{ gap: 10 }}>
        {RECOVERY_GROUPS.map((g, gi) => {
          const pr = progress.find((x) => x.id === g.id);
          const ink = p.tint[g.tint].ink;
          const isOpen = !!open[g.id];
          return (
            <Appear key={g.id} index={gi}>
              <Card tint={g.tint} style={{ padding: 0, overflow: 'hidden' }}>
                <Press
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                  onPress={() => setOpen((o) => ({ ...o, [g.id]: !isOpen }))}
                  style={{ padding: 14, gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Txt size={16} weight="700" color={ink}>{pick(g.title, lang)}</Txt>
                    <Txt size={13} weight="600" color={ink}>
                      {pr ? `${pr.done}/${pr.total}` : ''}
                    </Txt>
                  </View>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(0,0,0,0.15)', overflow: 'hidden' }}>
                    <View style={{ height: 6, width: `${Math.round((pr?.fraction ?? 0) * 100)}%`, backgroundColor: ink, borderRadius: 3 }} />
                  </View>
                </Press>
                {isOpen ? (
                  <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 12 }}>
                    {g.items.map((it) => {
                      const on = done.includes(it.id);
                      return (
                        <Press
                          key={it.id}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: on }}
                          onPress={() => toggleItem(it.id)}
                          style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                          <View
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: 7,
                              borderWidth: 2,
                              borderColor: ink,
                              backgroundColor: on ? ink : 'transparent',
                              marginTop: 1,
                            }}
                          />
                          <Txt size={14} color={ink} style={{ flex: 1, textDecorationLine: on ? 'line-through' : 'none' }}>
                            {pick(it.text, lang)}
                          </Txt>
                        </Press>
                      );
                    })}
                  </View>
                ) : null}
              </Card>
            </Appear>
          );
        })}
      </View>

      {/* helplines */}
      <Appear index={6}>
        <Card tint="blue" style={{ marginTop: 22, overflow: 'hidden', paddingRight: 96 }}>
          <View pointerEvents="none" style={{ position: 'absolute', right: -8, top: -10, transform: [{ rotate: '-10deg' }] }}>
            <Shield size={92} />
          </View>
          <Txt size={16} weight="700">{tx('Helplines', 'हेल्पलाइन')}</Txt>
          <View style={{ gap: 12, marginTop: 10 }}>
            {HELPLINES.map((h) => (
              <View key={h.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Txt size={15} weight="700">
                    {pick(h.label, lang)} · {h.number}
                  </Txt>
                  <Txt size={12.5}>{pick(h.note, lang)}</Txt>
                </View>
                <Btn
                  label={tx('Call', 'कॉल')}
                  icon="phone"
                  size="sm"
                  accessibilityLabel={`${tx('Call', 'कॉल')} ${h.number}`}
                  onPress={() => Linking.openURL(`tel:${h.number}`)}
                />
              </View>
            ))}
          </View>
        </Card>
      </Appear>
    </Screen>
  );
}
