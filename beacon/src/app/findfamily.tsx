import React, { useEffect, useMemo, useState } from 'react';
import { Switch, View } from 'react-native';
import Svg, { Circle, Polyline, Text as SvgText } from 'react-native-svg';
import { distanceKm } from '../alerts/sources';
import { FamilyKeyShare } from '../components/FamilyKeyShare';
import { Screen } from '../components/Screen';
import { Appear, Badge, Btn, Card, Row, SectionTitle, Txt, useTheme } from '../components/ui';
import { useLocal } from '../i18n';
import type { T } from '../kb/types';
import { bearingDeg, compassWord, formatDistance, project } from '../maps/osm';
import { isRoutable, routeTo, type RouteResult } from '../maps/route';
import { describe } from '../services/breadcrumbs';
import { type FamilyCrumb, startBreadcrumbs, useFamilyCrumbs } from '../services/breadcrumbService';
import { lastKnownFix, type Fix } from '../services/location';
import { useMap } from '../services/maps';
import { useMesh } from '../services/mesh';
import { setBreadcrumbsOn, useFamilyKey } from '../state/familyKey';

const P_TITLE: T = ['Find family', 'परिवार को ढूँढें'];
const P_INTRO: T = [
  'Phones leave encrypted notes with any phone they meet. Only your family can read them.',
  'फ़ोन अपने आस-पास के किसी भी फ़ोन के पास एन्क्रिप्टेड नोट छोड़ते हैं। उन्हें केवल आपका परिवार पढ़ सकता है।',
];
const P_SWITCH: T = ['Leave notes for my family', 'मेरे परिवार के लिए नोट छोड़ें'];
const P_NEEDKEY: T = [
  'Set up the family key first. Then switch this on.',
  'पहले परिवार की चाबी लगाएँ। फिर इसे चालू करें।',
];
const P_KEY: T = ['Family key', 'परिवार की चाबी'];
const P_FAMILY: T = ['Family', 'परिवार'];
const P_EMPTY: T = [
  'No notes yet. Notes only travel when phones pass each other, so it can take time. Switch it on now, before you need it.',
  'अभी कोई नोट नहीं। नोट तभी आगे बढ़ते हैं जब फ़ोन एक-दूसरे के पास से गुज़रते हैं, इसलिए समय लग सकता है। ज़रूरत पड़ने से पहले इसे अभी चालू करें।',
];
const P_PRIVACY: T = ['Privacy and battery', 'निजता और बैटरी'];
const P_PRIVACY_BODY: T = [
  'When on, this phone seals its last known place with your family key every 10 minutes (every 30 in battery saver) and when the app goes to the background. Other phones carry the sealed note for up to 48 hours but cannot read it. It uses no extra GPS wait and very little battery. A note is only as fresh as the last time the phone was seen, and a dead phone sends nothing new.',
  'चालू होने पर यह फ़ोन अपनी आख़िरी ज्ञात जगह को आपके परिवार की चाबी से सील करके हर 10 मिनट में (बैटरी सेवर में 30) और ऐप बैकग्राउंड में जाने पर भेजता है। दूसरे फ़ोन यह सील नोट 48 घंटे तक ढोते हैं पर पढ़ नहीं सकते। इसमें अतिरिक्त GPS प्रतीक्षा नहीं और बैटरी बहुत कम लगती है। नोट उतना ही ताज़ा है जितनी बार फ़ोन दिखा था, और बंद फ़ोन कुछ नया नहीं भेजता।',
];
const P_ROUTE: T = ['Open route', 'रास्ता खोलें'];
const P_HIDE_ROUTE: T = ['Hide route', 'रास्ता छिपाएँ'];
const P_NEAR: T = ['phones nearby', 'फ़ोन पास में'];
const P_NO_ROUTE: T = ['No road route found in your saved area.', 'आपके सहेजे इलाक़े में सड़क का रास्ता नहीं मिला।'];
const P_STRAIGHT: T = ['in a straight line', 'सीधी रेखा में'];
const P_BY_ROAD: T = ['By road', 'सड़क से'];
const P_WALK: T = ['walk', 'पैदल'];
const P_NO_FIX: T = ['Your own position is not known yet.', 'आपकी अपनी जगह अभी पता नहीं है।'];

const MAP = 220;

function MiniMap({ me, them, route }: { me: Fix | null; them: FamilyCrumb; route: RouteResult | null }) {
  const { p } = useTheme();
  const target = { lat: them.crumb.lat, lon: them.crumb.lon };
  const center = me ? { lat: (me.lat + target.lat) / 2, lon: (me.lon + target.lon) / 2 } : target;
  const km = me ? Math.max(0.05, distanceKm(me, target)) : 0.5;
  const scale = (MAP / 2 - 28) / (km / 2 + 0.0001);
  const at = project(target, center, scale, MAP);
  const you = me ? project(me, center, scale, MAP) : null;
  const pts = route?.points.map((q) => project(q, center, scale, MAP)).map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');
  return (
    <Svg width="100%" height={MAP} viewBox={`0 0 ${MAP} ${MAP}`} accessibilityLabel="Mini map">
      <Circle cx={MAP / 2} cy={MAP / 2} r={MAP / 2 - 2} fill={p.cardAlt} />
      {pts ? <Polyline points={pts} fill="none" stroke={p.tint.blue.ink} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" opacity={0.6} /> : null}
      {you ? (
        <>
          <Circle cx={you.x} cy={you.y} r={7} fill={p.tint.blue.ink} />
          <SvgText x={you.x} y={you.y - 12} fontSize={10} fill={p.text} textAnchor="middle">You</SvgText>
        </>
      ) : null}
      <Circle cx={at.x} cy={at.y} r={9} fill={p.tint.pink.ink} />
      <SvgText x={at.x} y={at.y - 14} fontSize={10} fill={p.text} textAnchor="middle">{them.who}</SvgText>
    </Svg>
  );
}

function Person({ f, me, now }: { f: FamilyCrumb; me: Fix | null; now: number }) {
  const { p } = useTheme();
  const L = useLocal();
  const area = useMap((s) => s.area);
  const [open, setOpen] = useState(false);
  const target = { lat: f.crumb.lat, lon: f.crumb.lon };
  const straightM = me ? distanceKm(me, target) * 1000 : null;
  const word = me ? compassWord(bearingDeg(me, target)) : null;
  const canRoute = !!(me && area && isRoutable(area));
  const route = useMemo(() => (open && canRoute && me && area ? routeTo(area, me, target, 'walk') : null), [open, canRoute, me, area, f.crumb.lat, f.crumb.lon]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = describe(f.crumb, now);
  return (
    <Card tint="blue" style={{ gap: 8 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt size={17} weight="700">{f.who}</Txt>
        {f.crumb.batt != null ? <Badge soft label={`${f.crumb.batt}%`} color={f.crumb.batt < 15 ? p.danger : p.tint.blue.ink} /> : null}
      </Row>
      <Txt size={13} style={{ opacity: 0.8 }}>{d.when}</Txt>
      {f.crumb.note ? <Txt size={13}>{f.crumb.note}</Txt> : null}
      <Txt size={12} style={{ opacity: 0.65 }}>{d.where}{f.crumb.acc != null ? `  (±${Math.round(f.crumb.acc)} m)` : ''}</Txt>
      <MiniMap me={me} them={f} route={route} />
      <Txt size={13} weight="600">
        {straightM != null && word ? `${formatDistance(straightM)} ${word}, ${L(P_STRAIGHT)}` : L(P_NO_FIX)}
      </Txt>
      {canRoute ? (
        <>
          <View style={{ alignSelf: 'flex-start' }}>
            <Btn size="sm" icon="navigate" label={L(open ? P_HIDE_ROUTE : P_ROUTE)} onPress={() => setOpen((v) => !v)} />
          </View>
          {open ? (
            <Txt size={13}>
              {route ? `${L(P_BY_ROAD)} ${formatDistance(route.distanceM)}, ${route.minutes} min ${L(P_WALK)}` : L(P_NO_ROUTE)}
            </Txt>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

export default function FindFamily() {
  const { p } = useTheme();
  const L = useLocal();
  const key = useFamilyKey((s) => s.key);
  const on = useFamilyKey((s) => s.breadcrumbsOn);
  const neighbours = useMesh((s) => s.neighbours);
  const crumbs = useFamilyCrumbs();
  const [me, setMe] = useState<Fix | null>(null);
  const [setup, setSetup] = useState(false);
  const [wantOn, setWantOn] = useState(false);
  const now = Date.now();

  useEffect(() => {
    void useMap.getState().load();
    void lastKnownFix().then(setMe);
  }, []);

  // the person asked to switch on before a key existed: finish once the key is there
  useEffect(() => {
    if (wantOn && key) {
      setWantOn(false);
      void setBreadcrumbsOn(true).then(startBreadcrumbs);
    }
  }, [wantOn, key]);

  const toggle = async (v: boolean) => {
    if (!v) return setBreadcrumbsOn(false);
    if (!key) {
      setWantOn(true);
      setSetup(true);
      return;
    }
    await setBreadcrumbsOn(true);
    startBreadcrumbs();
  };

  return (
    <Screen title={L(P_TITLE)}>
      <Appear>
        <Card tint="lilac" style={{ gap: 10 }}>
          <Txt size={14}>{L(P_INTRO)}</Txt>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt size={14} weight="600" style={{ flex: 1 }}>{L(P_SWITCH)}</Txt>
            <Switch value={on} onValueChange={toggle} accessibilityLabel={L(P_SWITCH)} />
          </Row>
          {!key ? <Txt size={12.5} style={{ opacity: 0.75 }}>{L(P_NEEDKEY)}</Txt> : null}
          <Txt size={12} style={{ opacity: 0.6 }}>{neighbours} {L(P_NEAR)}</Txt>
        </Card>
      </Appear>

      <SectionTitle right={<Btn size="sm" kind="ghost" icon="lock" label={L(P_KEY)} onPress={() => setSetup((v) => !v)} />}>
        {L(P_FAMILY)}
      </SectionTitle>
      {setup || !key ? (
        <Card style={{ gap: 8 }}>
          <FamilyKeyShare />
        </Card>
      ) : null}

      {crumbs.length === 0 ? (
        <Card tint="yellow">
          <Txt size={13}>{L(P_EMPTY)}</Txt>
        </Card>
      ) : (
        crumbs.map((f, i) => (
          <Appear key={f.who} index={i}>
            <Person f={f} me={me} now={now} />
          </Appear>
        ))
      )}

      <Card style={{ gap: 6 }}>
        <Txt size={14} weight="600" color={p.text}>{L(P_PRIVACY)}</Txt>
        <Txt size={12.5} style={{ opacity: 0.75 }}>{L(P_PRIVACY_BODY)}</Txt>
      </Card>
    </Screen>
  );
}
