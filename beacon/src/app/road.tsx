import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Diamond, ROAD_COLOR, ROAD_LABEL, RoadReportSheet, agePair, compassPair, trustLabel } from '../components/RoadReportSheet';
import { Screen } from '../components/Screen';
import { Appear, Btn, Card, Press, Row, SectionTitle, Txt, useTheme } from '../components/ui';
import { useLang } from '../i18n';
import type { T } from '../kb/types';
import { bearingDeg, compassWord, formatDistance } from '../maps/osm';
import { type Fix, getFix, lastKnownFix } from '../services/location';
import { useMesh } from '../services/mesh';
import { activeObstacles, levelOf, trustOf } from '../services/roadStatus';

const TITLE: T = ['Road status', 'सड़क की स्थिति'];
const INTRO: T = [
  'People nearby mark roads blocked, flooded or damaged. Phones close to the spot confirm it, and map routes avoid reported roads.',
  'आस-पास के लोग सड़कों को बंद, पानी भरी या टूटी बताते हैं। जगह के पास के फ़ोन इसकी पुष्टि करते हैं और नक्शे के रास्ते उन सड़कों से बचते हैं।',
];
const EMPTY: T = ['No road reports yet. If you see a problem, tell the phones around you.', 'अभी कोई सड़क रिपोर्ट नहीं। कोई समस्या दिखे तो आस-पास के फ़ोनों को बताएँ।'];

export default function Road() {
  const { p } = useTheme();
  const lang = useLang();
  const hi = lang === 'hi';
  const roads = useMesh((s) => s.roads);
  const neighbours = useMesh((s) => s.neighbours);
  const [open, setOpen] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    (async () => {
      const f = (await lastKnownFix()) ?? (await getFix({ maxWaitMs: 5000 }));
      if (!alive || !f) return;
      setFix(f);
      useMesh.getState().setPosition(f.lat, f.lon);
    })().catch(() => {});
    const h = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, []);

  const rows = useMemo(() => {
    const live = new Set(activeObstacles(roads, now).map((o) => o.id));
    return roads
      .filter((ev) => live.has(ev.report.id) || (ev.report.status === 'clear' && trustOf(ev, now).weight > 0.15))
      .map((ev) => {
        const r = ev.report;
        const d = fix ? Math.round(Math.hypot((r.lat - fix.lat) * 111320, (r.lon - fix.lon) * 111320 * Math.cos((fix.lat * Math.PI) / 180))) : null;
        return { ev, d, compass: fix ? compassWord(bearingDeg(fix, r)) : null };
      })
      .sort((a, b) => (a.d != null && b.d != null ? a.d - b.d : b.ev.report.seenAt - a.ev.report.seenAt));
  }, [roads, now, fix]);

  const pair = (t: T) => (
    <>
      <Txt size={12.5}>{t[0]}</Txt>
      <Txt size={11.5} style={{ opacity: 0.75 }}>
        {t[1]}
      </Txt>
    </>
  );

  return (
    <Screen title={hi ? TITLE[1] : TITLE[0]}>
      <Appear>
        <Card tint="blue" style={{ gap: 10 }}>
          {pair(INTRO)}
          <View style={{ alignSelf: 'flex-start' }}>
            <Btn icon="alert" label="Report a road problem · सड़क की समस्या बताएँ" onPress={() => setOpen(true)} />
          </View>
          <Txt size={11.5} style={{ opacity: 0.7 }}>
            {neighbours > 0 ? `${neighbours} phone${neighbours === 1 ? '' : 's'} in range · ${neighbours} फ़ोन पास में` : 'No phones in range right now · अभी कोई फ़ोन पास में नहीं'}
          </Txt>
        </Card>
      </Appear>

      <SectionTitle>Reports around you · आपके आस-पास की रिपोर्ट</SectionTitle>
      {rows.length === 0 ? (
        <Card style={{ gap: 2 }}>
          <Txt size={13} color={p.muted}>
            {EMPTY[0]}
          </Txt>
          <Txt size={12} color={p.muted}>
            {EMPTY[1]}
          </Txt>
        </Card>
      ) : null}
      {rows.map(({ ev, d, compass }, i) => {
        const r = ev.report;
        const col = ROAD_COLOR[r.status];
        const level = levelOf(ev);
        const trust = trustLabel(ev.attesters, ev.verified);
        const age = agePair(now - r.seenAt);
        const cp = compass ? compassPair(compass) : null;
        return (
          <Appear key={r.id} index={i}>
            <Card style={{ gap: 8 }}>
              <Row style={{ gap: 12, alignItems: 'flex-start' }}>
                <Diamond color={col} size={22} dashed={level === 'low' && r.status !== 'clear'} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt size={15} weight="700">
                    {`${ROAD_LABEL[r.status][0]} · ${ROAD_LABEL[r.status][1]}`}
                  </Txt>
                  {r.note ? <Txt size={13}>{r.note}</Txt> : null}
                  <Txt size={11.5} color={p.muted}>
                    {`${age[0]} · ${age[1]}`}
                  </Txt>
                  {d != null && cp ? (
                    <Txt size={11.5} color={p.muted}>
                      {`${formatDistance(d)} ${cp[0]} · ${formatDistance(d)} ${cp[1]}`}
                    </Txt>
                  ) : null}
                </View>
              </Row>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ backgroundColor: level === 'low' ? p.cardAlt : '#2E9B5F22', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, flexShrink: 1 }}>
                  <Txt size={11.5} weight="600" color={level === 'low' ? p.muted : '#2E9B5F'}>
                    {`${trust[0]} · ${trust[1]}`}
                  </Txt>
                </View>
                <Press accessibilityRole="link" onPress={() => router.push({ pathname: '/map', params: { lat: String(r.lat), lon: String(r.lon) } } as never)} style={{ paddingHorizontal: 10, height: 30, justifyContent: 'center' }}>
                  <Txt size={12} weight="600" color={p.accent}>
                    Show on map · नक्शे पर देखें
                  </Txt>
                </Press>
              </Row>
            </Card>
          </Appear>
        );
      })}

      <Txt size={10.5} color={p.muted}>
        Reports are not checked by anyone official. Confirmation counts phones near the spot. · रिपोर्ट किसी सरकारी स्रोत से जाँची नहीं गई हैं। पुष्टि का मतलब जगह के पास के फ़ोन हैं।
      </Txt>

      <RoadReportSheet visible={open} onClose={() => setOpen(false)} />
    </Screen>
  );
}
