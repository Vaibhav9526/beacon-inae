import React, { useState } from 'react';
import { View } from 'react-native';
import { useLang } from '../i18n';
import { type Phase, usePhase } from '../state/phase';
import { Appear, Press, Row, Txt, useTheme } from './ui';

const LABEL: Record<Phase, { en: string; hi: string; tint: 'lilac' | 'pink' | 'green' }> = {
  prepare: { en: 'Prepare', hi: 'तैयारी', tint: 'lilac' },
  alert: { en: 'Alert', hi: 'चेतावनी', tint: 'pink' },
  recover: { en: 'Recover', hi: 'सुधार', tint: 'green' },
};

/**
 * A small pill that says which phase the app is in and why. Tap to pick a phase by hand (or go back to automatic),
 * for the times the phone cannot know: a drill, a disaster elsewhere that a family member is in, or an all-clear.
 */
export function PhaseChip() {
  const { p } = useTheme();
  const lang = useLang();
  const ph = usePhase();
  const [open, setOpen] = useState(false);
  const cur = LABEL[ph.phase];
  const hi = lang === 'hi';

  return (
    <View style={{ gap: 8 }}>
      <Press accessibilityRole="button" accessibilityLabel={hi ? 'चरण बदलें' : 'Change phase'} onPress={() => setOpen((o) => !o)} style={{ alignSelf: 'flex-start' }}>
        <Row style={{ gap: 8, backgroundColor: p.tint[cur.tint].bg, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.tint[cur.tint].ink }} />
          <Txt size={12.5} weight="600" color={p.tint[cur.tint].ink}>
            {hi ? cur.hi : cur.en}
            {ph.override ? (hi ? ' · हाथ से' : ' · manual') : ''}
          </Txt>
        </Row>
      </Press>
      {open ? (
        <Appear>
          <Row style={{ gap: 8, flexWrap: 'wrap' }}>
            {(['prepare', 'alert', 'recover'] as Phase[]).map((k) => (
              <Press
                key={k}
                accessibilityRole="button"
                onPress={() => {
                  ph.setOverride(k);
                  setOpen(false);
                }}
                style={{ borderRadius: 999, borderWidth: 1, borderColor: ph.override === k ? p.accent : p.border, paddingHorizontal: 12, paddingVertical: 6 }}>
                <Txt size={12} weight={ph.override === k ? '600' : '400'}>
                  {hi ? LABEL[k].hi : LABEL[k].en}
                </Txt>
              </Press>
            ))}
            <Press
              accessibilityRole="button"
              onPress={() => {
                ph.setOverride(null);
                setOpen(false);
              }}
              style={{ borderRadius: 999, borderWidth: 1, borderColor: !ph.override ? p.accent : p.border, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Txt size={12} weight={!ph.override ? '600' : '400'}>
                {hi ? 'अपने आप' : 'Automatic'}
              </Txt>
            </Press>
          </Row>
          <Txt size={11.5} color={p.muted} style={{ marginTop: 6 }}>
            {ph.reasons[0]}
          </Txt>
        </Appear>
      ) : null}
    </View>
  );
}
