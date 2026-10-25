import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { type DisasterGuide, DISCLAIMER, type Guide, LEVEL_LABEL, getGuide } from '../kb';
import { useLocal, useT } from '../i18n';
import { call112 } from '../services/sos';
import { speak, stopSpeaking } from '../services/speech';
import { useSettings } from '../state/settings';
import { Icon, guideIcon } from './Icon';
import { Appear, Badge, Btn, Card, Chip, IconTile, Row, Txt, useTheme } from './ui';

function useReader(text: () => string, persona: 'asha' | 'veer' | 'didi') {
  const lang = useSettings((s) => s.lang);
  const auto = useSettings((s) => s.readAloud);
  const [on, setOn] = useState(false);
  const toggle = () => {
    if (on) {
      stopSpeaking();
      setOn(false);
    } else {
      setOn(true);
      void speak(text(), lang, persona, () => setOn(false));
    }
  };
  useEffect(() => {
    if (auto) toggle();
    return () => stopSpeaking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { on, toggle };
}

const levelTint = (l: Guide['level']) => (l === 'emergency' ? 'pink' : l === 'urgent' ? 'yellow' : 'green') as 'pink' | 'yellow' | 'green';

export function GuideView({ guide }: { guide: Guide }) {
  const { p } = useTheme();
  const t = useT();
  const L = useLocal();
  const lang = useSettings((s) => s.lang);
  const reader = useReader(() => [L(guide.title), ...guide.steps.map((s, i) => `${i + 1}. ${L(s)}`), ...(guide.avoid ?? []).map((a) => `${t('avoidTitle')}: ${L(a)}`)].join('. '), 'asha');
  const tint = levelTint(guide.level);
  return (
    <View style={{ gap: 12 }}>
      <Appear>
        <Row style={{ gap: 12 }}>
          <IconTile name={guideIcon(guide.id)} tint={tint} size={44} />
          <View style={{ flex: 1, gap: 4 }}>
            <Txt size={20} weight="700">
              {L(guide.title)}
            </Txt>
            <Badge soft label={L(LEVEL_LABEL[guide.level])} color={guide.level === 'emergency' ? p.danger : guide.level === 'urgent' ? p.warn : p.ok} />
          </View>
        </Row>
      </Appear>

      <Appear index={1}>
        <Row style={{ flexWrap: 'wrap', gap: 8 }}>
          <Btn label={t('call112')} icon="phone" kind="danger" size="sm" onPress={() => void call112()} />
          {guide.helpline ? <Btn label={`${L(guide.helpline.label)} ${guide.helpline.number}`} kind="secondary" size="sm" onPress={() => void Linking.openURL(`tel:${guide.helpline!.number}`)} /> : null}
          <Btn label={reader.on ? t('stopReading') : t('readAloud')} icon={reader.on ? 'stop' : 'speaker'} kind="secondary" size="sm" onPress={reader.toggle} />
        </Row>
      </Appear>

      <Appear index={2}>
        <Card style={{ gap: 12 }}>
          {guide.steps.map((s, i) => (
            <Row key={i} style={{ alignItems: 'flex-start', gap: 12 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: p.tint[tint].bg, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                <Txt size={11.5} weight="700" color={p.tint[tint].ink}>
                  {i + 1}
                </Txt>
              </View>
              <Txt size={15} style={{ flex: 1 }}>
                {L(s)}
              </Txt>
            </Row>
          ))}
        </Card>
      </Appear>

      {guide.avoid?.length ? (
        <Appear index={3}>
          <Card tint="pink" style={{ gap: 6 }}>
            <Row style={{ gap: 6 }}>
              <Icon name="close" size={14} color={p.tint.pink.ink} />
              <Txt size={12} weight="700" color={p.tint.pink.ink} style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                {t('avoidTitle')}
              </Txt>
            </Row>
            {guide.avoid.map((a, i) => (
              <Txt key={i} size={14} color={p.dark ? p.text : '#4A1A30'}>
                {L(a)}
              </Txt>
            ))}
          </Card>
        </Appear>
      ) : null}

      {guide.household?.length ? (
        <Appear index={4}>
          <Card tint="green" style={{ gap: 6 }}>
            <Row style={{ gap: 6 }}>
              <Icon name="home" size={14} color={p.tint.green.ink} />
              <Txt size={12} weight="700" color={p.tint.green.ink} style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                {t('householdTitle')}
              </Txt>
            </Row>
            {guide.household.map((a, i) => (
              <Txt key={i} size={14} color={p.dark ? p.text : '#23400A'}>
                {L(a)}
              </Txt>
            ))}
          </Card>
        </Appear>
      ) : null}

      {guide.related?.length ? (
        <View style={{ gap: 8 }}>
          <Txt size={11} weight="600" color={p.muted} style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
            {t('relatedTitle')}
          </Txt>
          <Row style={{ flexWrap: 'wrap', gap: 6 }}>
            {guide.related
              .map(getGuide)
              .filter((g): g is Guide => !!g)
              .map((g) => (
                <Chip key={g.id} icon={guideIcon(g.id)} label={L(g.title)} onPress={() => router.push(`/guide/${g.id}` as never)} />
              ))}
          </Row>
        </View>
      ) : null}

      <Txt size={11} color={p.muted} style={{ paddingTop: 6 }}>
        {DISCLAIMER[lang === 'hi' ? 1 : 0]}
      </Txt>
    </View>
  );
}

export function DisasterView({ d }: { d: DisasterGuide }) {
  const { p } = useTheme();
  const t = useT();
  const L = useLocal();
  const reader = useReader(() => [L(d.title), ...d.before.map(L), ...d.during.map(L), ...d.after.map(L)].join('. '), 'veer');
  const sections: { key: 'before' | 'during' | 'after'; tint: 'blue' | 'pink' | 'green' }[] = [
    { key: 'before', tint: 'blue' },
    { key: 'during', tint: 'pink' },
    { key: 'after', tint: 'green' },
  ];
  return (
    <View style={{ gap: 12 }}>
      <Appear>
        <Row style={{ gap: 12 }}>
          <IconTile name={guideIcon(d.id)} tint="lilac" size={44} />
          <Txt size={22} weight="700" style={{ flex: 1 }}>
            {L(d.title)}
          </Txt>
        </Row>
      </Appear>
      <Row style={{ flexWrap: 'wrap', gap: 8 }}>
        <Btn label={t('call112')} icon="phone" kind="danger" size="sm" onPress={() => void call112()} />
        <Btn label={reader.on ? t('stopReading') : t('readAloud')} icon={reader.on ? 'stop' : 'speaker'} kind="secondary" size="sm" onPress={reader.toggle} />
      </Row>
      {sections.map(({ key, tint }, i) => (
        <Appear key={key} index={i + 1}>
          <Card tint={tint} style={{ gap: 8 }}>
            <Txt size={11.5} weight="700" color={p.tint[tint].ink} style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
              {t(key)}
            </Txt>
            {d[key].map((s, k) => (
              <Row key={k} style={{ alignItems: 'flex-start', gap: 8 }}>
                <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: p.tint[tint].ink, marginTop: 8 }} />
                <Txt size={14.5} style={{ flex: 1 }} color={p.dark ? p.text : '#1D1D22'}>
                  {L(s)}
                </Txt>
              </Row>
            ))}
          </Card>
        </Appear>
      ))}
    </View>
  );
}
