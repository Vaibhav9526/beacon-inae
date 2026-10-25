import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLang } from '../i18n';
import {
  type GuidanceHazard,
  type GuidancePhase,
  type Urgency,
  isHouseholdEmpty,
  personalGuidance,
} from '../services/guidance';
import { useHousehold } from '../state/household';
import { Btn, Card, Row, Txt, type TintName, useTheme } from './ui';

const HAZARDS: GuidanceHazard[] = ['earthquake', 'flood', 'cyclone', 'landslide', 'heatwave', 'lightning', 'tsunami', 'fire'];
const VISIBLE = 7;

const URG: Record<Urgency, { tint: TintName; en: string; hi: string }> = {
  now: { tint: 'pink', en: 'Now', hi: 'अभी' },
  soon: { tint: 'yellow', en: 'Soon', hi: 'जल्द' },
  prepare: { tint: 'blue', en: 'Prepare', hi: 'तैयारी' },
};

/** Accepts any hazard id string (such as from hazardIdFor) and ignores ones the engine does not know. */
function asHazard(h: string | null | undefined): GuidanceHazard | null {
  return h && (HAZARDS as string[]).includes(h) ? (h as GuidanceHazard) : null;
}

/**
 * "What should I do now, for MY household". Reads the household store and shows personalised, offline steps.
 * Mount in Home: <PersonalGuidance phase={phase} hazard={hazardIdFor(lead.title)} severity={lead.severity} />
 */
export function PersonalGuidance({
  phase,
  hazard,
  severity = null,
}: {
  phase: GuidancePhase;
  hazard: string | null;
  severity?: 'info' | 'watch' | 'warning' | 'severe' | null;
}) {
  const { p } = useTheme();
  const hi = useLang() === 'hi';
  const people = useHousehold((s) => s.people);
  const home = useHousehold((s) => s.home);
  const [all, setAll] = useState(false);

  const household = useMemo(() => ({ people, home }), [people, home]);
  const empty = isHouseholdEmpty(household);
  const g = useMemo(
    () =>
      personalGuidance({
        phase,
        hazard: asHazard(hazard),
        severity: severity === 'info' ? null : severity,
        household,
        hourOfDay: new Date().getHours(),
      }),
    [phase, hazard, severity, household],
  );

  const tint = phase === 'alert' ? 'pink' : phase === 'recover' ? 'green' : 'lilac';
  const ink = p.tint[tint].ink;
  const steps = all || g.steps.length <= VISIBLE + 1 ? g.steps : [...g.steps.slice(0, VISIBLE), g.steps[g.steps.length - 1]];
  const hidden = g.steps.length - steps.length;
  const pack = hi ? g.packListHi : g.packList;

  return (
    <Card tint={tint} style={{ gap: 12, padding: 16 }}>
      <Txt size={11} weight="600" color={ink} style={{ opacity: 0.6, letterSpacing: 0.4 }}>
        {hi ? 'आपके घर के लिए' : 'FOR YOUR HOUSEHOLD'}
      </Txt>
      <Txt size={18} weight="700" color={ink}>
        {hi ? g.headlineHi : g.headline}
      </Txt>

      {empty ? (
        <View style={{ backgroundColor: 'rgba(255,255,255,0.55)', borderRadius: 14, padding: 12, gap: 8 }}>
          <Txt size={12.5} color={ink} style={{ opacity: 0.8 }}>
            {hi
              ? 'अपने घर की जानकारी जोड़ें ताकि सलाह आपके परिवार के हिसाब से हो। यह फ़ोन में ही रहती है।'
              : 'Add your household so this advice fits your family. It stays on this phone.'}
          </Txt>
          <View style={{ alignSelf: 'flex-start' }}>
            <Btn size="sm" label={hi ? 'अपना घर सेट करें' : 'Set up your household'} onPress={() => router.push('/household' as never)} />
          </View>
        </View>
      ) : null}

      <View style={{ gap: 12 }}>
        {steps.map((s, i) => {
          const u = URG[s.urgency];
          const uInk = p.tint[u.tint].ink;
          return (
            <Row key={s.id} style={{ alignItems: 'flex-start', gap: 10 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.6)', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                <Txt size={11.5} weight="700" color={ink}>
                  {all || hidden === 0 || i < VISIBLE ? i + 1 : g.steps.length}
                </Txt>
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Row style={{ gap: 6, flexWrap: 'wrap' }}>
                  <View style={{ backgroundColor: p.tint[u.tint].bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 }}>
                    <Txt size={10.5} weight="600" color={uInk}>
                      {hi ? u.hi : u.en}
                    </Txt>
                  </View>
                  {s.who ? (
                    <Txt size={11} weight="600" color={ink} style={{ opacity: 0.65 }}>
                      {s.who}
                    </Txt>
                  ) : null}
                </Row>
                <Txt size={14} weight="500" color={ink}>
                  {hi ? s.text.hi : s.text.en}
                </Txt>
                {s.why ? (
                  <Txt size={11} color={p.muted}>
                    {hi ? s.why.hi : s.why.en}
                  </Txt>
                ) : null}
              </View>
            </Row>
          );
        })}
      </View>

      {g.steps.length > VISIBLE + 1 ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <Btn
            size="sm"
            kind="ghost"
            label={all ? (hi ? 'कम दिखाएँ' : 'Show less') : hi ? `सब देखें (${hidden})` : `See all (${hidden} more)`}
            onPress={() => setAll((v) => !v)}
          />
        </View>
      ) : null}

      {pack.length ? (
        <View style={{ gap: 6 }}>
          <Txt size={12} weight="600" color={ink} style={{ opacity: 0.7 }}>
            {hi ? 'गो-बैग में रखें' : 'Pack for your household'}
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {pack.map((x) => (
              <View key={x} style={{ backgroundColor: 'rgba(255,255,255,0.55)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Txt size={11.5} weight="500" color={ink}>
                  {x}
                </Txt>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </Card>
  );
}
