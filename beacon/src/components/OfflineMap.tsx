import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { PanResponder, ScrollView, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { distanceKm } from '../alerts/sources';
import { useLocal, useT } from '../i18n';
import { type Nearby, type Place, type PlaceKind, bearingDeg, compassWord, formatDistance, nearest, project } from '../maps/osm';
import { type Leg, type Mode, type RouteOption, type RoadRoute, firstBearingDeg, isRoutable, routeTo, routesTo, turnHints } from '../maps/route';
import { type Fix, getFix, watchFix } from '../services/location';
import { useMap } from '../services/maps';
import { useMesh } from '../services/mesh';
import { type Obstacle, activeObstacles } from '../services/roadStatus';
import { radius } from '../theme';
import { Flower } from './Deco';
import { Icon, type IconName } from './Icon';
import { Diamond, ROAD_COLOR, ROAD_LABEL, ROAD_NOUN, RoadReportSheet } from './RoadReportSheet';
import { Skeleton, SkeletonList } from './Skeleton';
import { Appear, Btn, Card, Chip, Press, Row, Txt, useTheme } from './ui';

export const PLACE_ICON: Record<PlaceKind, IconName> = { shelter: 'tent', hospital: 'hospital', water: 'water', police: 'shield', pharmacy: 'pill', fire: 'fire', school: 'learn' };
const PLACE_LABEL: Record<PlaceKind, 'shelter' | 'hospital' | 'water' | 'police' | 'pharmacy' | 'fire'> = { shelter: 'shelter', hospital: 'hospital', water: 'water', police: 'police', pharmacy: 'pharmacy', fire: 'fire', school: 'shelter' };
const FILTERS: PlaceKind[] = ['shelter', 'hospital', 'water', 'police', 'pharmacy'];
const PIN: Record<PlaceKind, string> = { shelter: '#2E9B5F', hospital: '#D14B4B', water: '#2F7FB5', police: '#5B3FA8', pharmacy: '#B97D12', fire: '#C2571A', school: '#7B7B86' };

/** sticker tint for each kind of place in the nearest list */
const PLACE_TINT: Record<PlaceKind, 'green' | 'pink' | 'blue' | 'lilac' | 'yellow' | 'peach'> = { shelter: 'green', hospital: 'pink', water: 'blue', police: 'lilac', pharmacy: 'yellow', fire: 'peach', school: 'lilac' };

const ROAD_STYLE = [
  { w: 3.6, c: '#E9B44C' },
  { w: 3, c: '#F3D58A' },
  { w: 2.1, c: '#FFFFFF' },
  { w: 1.4, c: '#FFFFFF' },
];

const EN_DIR: Record<string, string> = { N: 'north', NE: 'north-east', E: 'east', SE: 'south-east', S: 'south', SW: 'south-west', W: 'west', NW: 'north-west' };
const HI_DIR: Record<string, string> = { N: 'उत्तर', NE: 'उत्तर-पूर्व', E: 'पूर्व', SE: 'दक्षिण-पूर्व', S: 'दक्षिण', SW: 'दक्षिण-पश्चिम', W: 'पश्चिम', NW: 'उत्तर-पश्चिम' };
const HI_TURN: Record<'left' | 'right' | 'around', string> = { right: 'दाएँ मुड़ें', left: 'बाएँ मुड़ें', around: 'वापस मुड़ें' };

/** "Go north for 300 m, then turn right" with its Hindi pair. */
function legLines(leg: Leg): { en: string; hi: string } {
  const d = formatDistance(leg.meters);
  const en = `Go ${EN_DIR[leg.compass]} for ${d}${leg.turn ? `, then turn ${leg.turn}` : ''}`;
  const hi = `${HI_DIR[leg.compass]} की ओर ${d} चलें${leg.turn ? `, फिर ${HI_TURN[leg.turn]}` : ''}`;
  return { en, hi };
}

/** The red warning for a route: a reported flood, closure or damage lies on it, or no safe way exists. Crowds alone are not a warning. */
function routeWarning(r: RoadRoute | null): [string, string] | null {
  if (!r) return null;
  const hard = (r.blockedAhead ?? []).filter((o: Obstacle) => o.status !== 'crowded');
  if (r.unsafe) return ['Every way to this place has a reported road problem. Choose another place or go with care.', 'इस जगह के हर रास्ते पर सड़क की समस्या बताई गई है। दूसरी जगह चुनें या सावधानी से जाएँ।'];
  if (hard.length === 0) return null;
  const noun = ROAD_NOUN[hard[0].status];
  return [`A reported ${noun[0]} is on this route. Choose another place or go with care.`, `इस रास्ते पर ${noun[1]} की रिपोर्ट है। दूसरी जगह चुनें या सावधानी से जाएँ।`];
}

const toTarget = (pl: Place, fix: Fix | null): Nearby => ({ ...pl, distanceM: fix ? Math.round(distanceKm(fix, pl) * 1000) : 0, bearing: fix ? bearingDeg(fix, pl) : 0 });

export function OfflineMap({ initialPlace, height = 340, onFilterChange }: { initialPlace?: PlaceKind; playful?: boolean; height?: number; onFilterChange?: (k: PlaceKind | null) => void }) {
  const { p } = useTheme();
  const t = useT();
  const L = useLocal();
  void L;
  const { width } = useWindowDimensions();
  const size = Math.min(width - 32, 520);
  const { area, loaded, downloading, error, load, download } = useMap();
  const [fix, setFix] = useState<Fix | null>(null);
  const [fixSettled, setFixSettled] = useState(false); // true once the first GPS attempt has returned, fix or not
  const [filter, setFilterState] = useState<PlaceKind | null>(initialPlace ?? null);
  const setFilter = (k: PlaceKind | null) => {
    setFilterState(k);
    onFilterChange?.(k);
  };
  const [scale, setScale] = useState(120); // px per km
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [target, setTarget] = useState<Nearby | null>(null);
  const [mode, setMode] = useState<Mode>('walk');
  const [routing, setRouting] = useState<{ mode: Mode; opts: RouteOption<Nearby>[] } | null>(null);
  const [sel, setSel] = useState<{ key: string; road: RoadRoute | null } | null>(null);
  const panRef = useRef({ x: 0, y: 0 });
  const [reporting, setReporting] = useState(false);
  const roads = useMesh((s) => s.roads);
  const [now, setNow] = useState(() => Date.now());
  const focus = useLocalSearchParams<{ lat?: string; lon?: string }>();
  // reported road problems, re-evaluated every minute because trust fades with age
  const obstacles = useMemo(() => activeObstacles(roads, now), [roads, now]);
  const avoid = useMemo(() => ({ obstacles }), [obstacles]);
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(h);
  }, []);
  // proof of presence: nearby phones only attest a report when they know where this phone is
  useEffect(() => {
    if (fix) useMesh.getState().setPosition(fix.lat, fix.lon);
  }, [fix]);

  useEffect(() => {
    void load();
    void getFix({ maxWaitMs: 5000 }).then((f) => {
      setFix(f);
      setFixSettled(true);
    });
    // watchFix resolves after a possible unmount, so the subscription is released as soon as it arrives
    let stop = () => {};
    let gone = false;
    void watchFix(setFix)
      .then((s) => (gone ? s() : (stop = s)))
      .catch(() => {});
    return () => {
      gone = true;
      stop();
    };
  }, [load]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderMove: (_, g) => setPan({ x: panRef.current.x + g.dx, y: panRef.current.y + g.dy }),
        onPanResponderRelease: (_, g) => {
          panRef.current = { x: panRef.current.x + g.dx, y: panRef.current.y + g.dy };
        },
      }),
    [],
  );

  const center = area?.center ?? fix ?? { lat: 0, lon: 0 };
  const geometry = useMemo(() => {
    if (!area) return null;
    const line = (pts: number[]) => {
      let d = '';
      for (let i = 0; i < pts.length; i += 2) {
        const q = project({ lat: pts[i], lon: pts[i + 1] }, center, scale, size);
        d += `${i === 0 ? 'M' : 'L'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
      }
      return d;
    };
    const roadPaths = [0, 1, 2, 3].map((c) => area.roads.filter((r) => r.c === c && !r.f).map((r) => line(r.p)).join(''));
    const water = area.water.map((w) => ({ d: line(w.p) + (w.area ? 'Z' : ''), area: w.area }));
    return { roadPaths, water };
  }, [area, center.lat, center.lon, scale, size]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusKey = focus.lat && focus.lon ? `${focus.lat},${focus.lon}` : null;
  useEffect(() => {
    if (!area || !focusKey) return;
    const la = Number(focus.lat);
    const lo = Number(focus.lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return;
    const q = project({ lat: la, lon: lo }, center, scale, size);
    panRef.current = { x: size / 2 - q.x, y: size / 2 - q.y };
    setPan(panRef.current);
  }, [area, focusKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const near = useMemo(() => (area && fix ? nearest(area, fix, filter ?? FILTERS, 12) : []), [area, fix, filter]);
  const routable = !!area && isRoutable(area);
  useEffect(() => {
    if (filter && near[0]) setTarget(near[0]);
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Road routes are computed after the first paint (a timeout yields to the UI). The previous result stays until the new one arrives.
  useEffect(() => {
    if (!area || !fix || !routable) return;
    const h = setTimeout(() => setRouting({ mode, opts: routesTo(area, fix, near, mode, 8, avoid) }), 0);
    return () => clearTimeout(h);
  }, [area, fix, near, mode, routable, avoid]); // eslint-disable-line react-hooks/exhaustive-deps

  const targetKey = target ? `${target.lat},${target.lon},${mode}` : null;
  useEffect(() => {
    if (!area || !fix || !target || !routable) return;
    const key = `${target.lat},${target.lon},${mode}`;
    const h = setTimeout(() => {
      const r = routeTo(area, fix, target, mode, avoid);
      setSel({ key, road: r ? { roadM: r.distanceM, minutes: r.minutes, points: r.points, costM: r.costM, avoided: r.avoided, blockedAhead: r.blockedAhead, unsafe: r.unsafe } : null });
    }, 0);
    return () => clearTimeout(h);
  }, [area, fix, targetKey, routable, avoid]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    if (!routable || !routing || routing.mode !== mode) return null;
    return routing.opts.map((o) => ({ pl: o.place, road: o.road, first: o.road ? firstBearingDeg(o.road.points) : null }));
  }, [routable, routing, mode]);
  const selRoute = sel && targetKey && sel.key === targetKey ? sel.road : null;

  const me = fix ? project(fix, center, scale, size) : null;
  const tgt = target ? project(target, center, scale, size) : null;
  const routeD = useMemo(() => {
    if (!selRoute) return '';
    return selRoute.points.map((q, i) => {
      const s = project(q, center, scale, size);
      return `${i === 0 ? 'M' : 'L'}${s.x.toFixed(1)} ${s.y.toFixed(1)}`;
    }).join('');
  }, [selRoute, center.lat, center.lon, scale, size]); // eslint-disable-line react-hooks/exhaustive-deps
  const warning = useMemo(() => routeWarning(selRoute), [selRoute]);
  const legs = useMemo(() => (selRoute ? turnHints(selRoute.points).slice(0, 3) : []), [selRoute]);
  const land = p.dark ? '#1C1C22' : '#EFECE4';
  const edge = p.dark ? '#0F0F13' : '#D8D3C6';
  const modeEn = mode === 'walk' ? 'walk' : 'drive';
  const modeHi = mode === 'walk' ? 'पैदल' : 'गाड़ी से';

  if (!loaded) return <Skeleton h={height} w={size} r={radius.lg} style={{ alignSelf: 'center' }} />;

  // rows to show: road order when routes are ready, otherwise straight-line order
  const listRows = rows
    ? rows.slice(0, 6)
    : near.slice(0, 6).map((pl) => ({ pl, road: null as RoadRoute | null, first: null as number | null }));
  const anyStraight = !routable || listRows.some((r) => !r.road);

  return (
    <View style={{ gap: 12 }}>
      <View style={{ height, width: size, alignSelf: 'center', borderRadius: 24, overflow: 'hidden', backgroundColor: land }} {...responder.panHandlers}>
        {area && geometry ? (
          <Svg width={size} height={height} viewBox={`0 0 ${size} ${height}`}>
            <G translateX={pan.x} translateY={pan.y - (size - height) / 2}>
              <Rect x={-2000} y={-2000} width={4000} height={4000} fill={land} />
              {geometry.water.map((w, i) => (
                <Path key={i} d={w.d} fill={w.area ? '#A9D6F0' : 'none'} stroke="#A9D6F0" strokeWidth={w.area ? 0 : 2} />
              ))}
              {[3, 2, 1, 0].map((c) => (
                <G key={c}>
                  <Path d={geometry.roadPaths[c]} stroke={edge} strokeWidth={ROAD_STYLE[c].w + 1.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  <Path d={geometry.roadPaths[c]} stroke={p.dark && c > 1 ? '#3A3A44' : ROAD_STYLE[c].c} strokeWidth={ROAD_STYLE[c].w} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </G>
              ))}
              {me && tgt && !selRoute ? <Path d={`M${me.x} ${me.y}L${tgt.x} ${tgt.y}`} stroke={p.text} strokeWidth={1.5} strokeDasharray="4 5" fill="none" /> : null}
              {selRoute && routeD && me ? (
                <G>
                  <Path d={routeD} stroke="#FFFFFF" strokeWidth={9} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
                  <Path d={routeD} stroke={p.accent} strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  <SvgText x={me.x + 10} y={me.y - 12} fontSize={11} fontWeight="700" fill={p.text}>
                    {`${selRoute.minutes} min ${modeEn}`}
                  </SvgText>
                  {tgt ? (
                    <SvgText x={tgt.x + 10} y={tgt.y - 12} fontSize={11} fontWeight="700" fill={p.text}>
                      {formatDistance(selRoute.roadM)}
                    </SvgText>
                  ) : null}
                </G>
              ) : null}
              {obstacles.map((o) => {
                const q = project(o, center, scale, size);
                const col = ROAD_COLOR[o.status];
                const low = o.level === 'low';
                return (
                  <Path
                    key={o.id}
                    d={`M${q.x} ${q.y - 9}L${q.x + 9} ${q.y}L${q.x} ${q.y + 9}L${q.x - 9} ${q.y}Z`}
                    fill={col}
                    fillOpacity={low ? 0.4 : 0.95}
                    stroke={low ? col : '#FFFFFF'}
                    strokeWidth={low ? 1.8 : 1.6}
                    strokeDasharray={low ? '3 2.5' : undefined}
                  />
                );
              })}
              {area.places
                .filter((pl) => !filter || pl.kind === filter || (filter === 'shelter' && pl.kind === 'school'))
                .map((pl, i) => {
                  const q = project(pl, center, scale, size);
                  const hot = target && target.lat === pl.lat && target.lon === pl.lon;
                  return (
                    <G key={i} onPress={() => fix && setTarget(toTarget(pl, fix))}>
                      <Circle cx={q.x} cy={q.y} r={hot ? 9 : 6.5} fill={PIN[pl.kind]} stroke="#fff" strokeWidth={2} />
                      {hot ? <Circle cx={q.x} cy={q.y} r={3} fill="#fff" /> : null}
                    </G>
                  );
                })}
              {me ? (
                <G>
                  <Circle cx={me.x} cy={me.y} r={14} fill="#2F7FB5" opacity={0.18} />
                  <Circle cx={me.x} cy={me.y} r={6} fill="#2F7FB5" stroke="#fff" strokeWidth={2.5} />
                </G>
              ) : null}
            </G>
          </Svg>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <Card tint="blue" style={{ overflow: 'hidden', width: '100%', alignItems: 'center', gap: 10, paddingTop: 48, paddingBottom: 18 }}>
              <View pointerEvents="none" style={{ position: 'absolute', right: -12, top: -14, transform: [{ rotate: '12deg' }] }}>
                <Flower size={84} />
              </View>
              <Icon name="map" size={26} color={p.tint.blue.ink} />
              <Txt size={13} color={p.tint.blue.ink} style={{ textAlign: 'center' }}>
                {t('noPlaces')}
              </Txt>
              <Btn label={downloading ? t('downloading') : t('downloadArea')} icon="download" size="sm" onPress={() => void download()} disabled={downloading} />
              {error ? (
                <Txt size={12} color={p.tint.blue.ink}>
                  {error}
                </Txt>
              ) : null}
            </Card>
          </View>
        )}
        {area ? (
          <View style={{ position: 'absolute', right: 10, top: 10, gap: 6 }}>
            {[
              ['+', 1.4],
              ['−', 1 / 1.4],
            ].map(([label, f]) => (
              <Press key={label as string} accessibilityLabel={label === '+' ? 'Zoom in' : 'Zoom out'} onPress={() => setScale((s) => Math.min(900, Math.max(30, s * (f as number))))} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: p.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: p.border }}>
                <Txt size={17} weight="500">
                  {label as string}
                </Txt>
              </Press>
            ))}
          </View>
        ) : null}
      </View>

      {area ? (
        <>
          <Press accessibilityRole="button" onPress={() => setReporting(true)} style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: p.tint.peach.bg }}>
            <Icon name="alert" size={14} color={p.tint.peach.ink} />
            <Txt size={12.5} weight="600" color={p.tint.peach.ink}>
              Report a road problem · सड़क की समस्या बताएँ
            </Txt>
          </Press>
          {obstacles.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 2 }}>
              {(['blocked', 'flooded', 'damaged', 'crowded'] as const).map((st) => (
                <View key={st} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 28, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: p.card, borderWidth: 1, borderColor: p.border }}>
                  <Diamond color={ROAD_COLOR[st]} size={12} />
                  <Txt size={11.5}>{`${ROAD_LABEL[st][0]} · ${ROAD_LABEL[st][1]}`}</Txt>
                </View>
              ))}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 28, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: p.card, borderWidth: 1, borderColor: p.border }}>
                <Diamond color={p.muted} size={12} dashed />
                <Txt size={11.5}>Dashed: not confirmed · बिंदु-रेखा: अपुष्ट</Txt>
              </View>
            </ScrollView>
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 2 }}>
            <Chip label={t('nearest')} active={!filter} onPress={() => setFilter(null)} />
            {FILTERS.map((k) => (
              <Chip key={k} icon={PLACE_ICON[k]} label={t(PLACE_LABEL[k])} active={filter === k} onPress={() => setFilter(k)} />
            ))}
          </ScrollView>

          <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', padding: 3, borderRadius: 999, backgroundColor: p.card, borderWidth: 1, borderColor: p.border, gap: 2 }}>
              {(['walk', 'drive'] as Mode[]).map((m) => (
                <Press key={m} accessibilityRole="button" accessibilityState={{ selected: mode === m }} onPress={() => setMode(m)} style={{ height: 30, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center', backgroundColor: mode === m ? p.text : 'transparent' }}>
                  <Txt size={12} weight="600" color={mode === m ? p.card : p.text}>
                    {m === 'walk' ? 'Walk · पैदल' : 'Drive · गाड़ी'}
                  </Txt>
                </Press>
              ))}
            </View>
          </Row>

          {target ? (
            <Card tint={PLACE_TINT[target.kind]} style={{ padding: 12, borderRadius: 24, gap: 6 }}>
              <Txt size={14} weight="700" color={p.tint[PLACE_TINT[target.kind]].ink} numberOfLines={1}>
                {target.name}
              </Txt>
              {selRoute ? (
                <>
                  <Txt size={12.5} weight="600" color={p.tint[PLACE_TINT[target.kind]].ink}>
                    {`${formatDistance(selRoute.roadM)} by road · ${selRoute.minutes} min ${modeEn}`}
                  </Txt>
                  <Txt size={11} color={p.tint[PLACE_TINT[target.kind]].ink} style={{ opacity: 0.8 }}>
                    {`सड़क से ${formatDistance(selRoute.roadM)} · ${selRoute.minutes} मिनट ${modeHi}`}
                  </Txt>
                  {selRoute.avoided ? (
                    <>
                      <Txt size={11.5} weight="600" color={p.tint[PLACE_TINT[target.kind]].ink}>
                        {`Avoiding ${selRoute.avoided} reported road problem${selRoute.avoided === 1 ? '' : 's'}`}
                      </Txt>
                      <Txt size={11} color={p.tint[PLACE_TINT[target.kind]].ink} style={{ opacity: 0.8 }}>
                        {`${selRoute.avoided} रिपोर्ट की गई सड़क समस्याओं से बचते हुए`}
                      </Txt>
                    </>
                  ) : null}
                  {legs.map((leg, i) => (
                    <View key={i} style={{ gap: 1 }}>
                      <Txt size={12} color={p.tint[PLACE_TINT[target.kind]].ink}>
                        {`${i + 1}. ${legLines(leg).en}`}
                      </Txt>
                      <Txt size={11} color={p.tint[PLACE_TINT[target.kind]].ink} style={{ opacity: 0.8, paddingLeft: 14 }}>
                        {legLines(leg).hi}
                      </Txt>
                    </View>
                  ))}
                </>
              ) : (
                <>
                  <Txt size={12.5} weight="600" color={p.tint[PLACE_TINT[target.kind]].ink}>
                    {`${formatDistance(target.distanceM)} straight line`}
                  </Txt>
                  <Txt size={11} color={p.tint[PLACE_TINT[target.kind]].ink} style={{ opacity: 0.8 }}>
                    {`सीधी दूरी ${formatDistance(target.distanceM)}`}
                  </Txt>
                </>
              )}
            </Card>
          ) : null}

          {warning ? (
            <Card style={{ backgroundColor: p.danger + '1A', borderWidth: 1, borderColor: p.danger + '66', gap: 3, padding: 12, borderRadius: 24 }}>
              <Row style={{ gap: 8, alignItems: 'flex-start' }}>
                <Icon name="alert" size={18} color={p.danger} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt size={13} weight="700" color={p.danger}>
                    {warning[0]}
                  </Txt>
                  <Txt size={12} color={p.danger}>
                    {warning[1]}
                  </Txt>
                </View>
              </Row>
            </Card>
          ) : null}

          <View style={{ gap: 8 }}>
            {!rows && routable && fix ? <SkeletonList n={3} /> : null}
            {near.length === 0 && !fixSettled ? <SkeletonList n={3} /> : null}
            {listRows.map((row, i) => {
              const pl = row.pl;
              const hot = target && target.lat === pl.lat && target.lon === pl.lon;
              const ink = p.tint[PLACE_TINT[pl.kind]].ink;
              const compass = row.road && row.first != null ? compassWord(row.first) : compassWord(pl.bearing);
              return (
                <Appear key={`${pl.lat}-${pl.lon}`} index={i}>
                  <Press onPress={() => setTarget(pl)}>
                    <Card tint={PLACE_TINT[pl.kind]} style={{ padding: 12, borderRadius: 24, borderWidth: hot ? 2 : 0, borderColor: p.text }}>
                      <Row style={{ gap: 12 }}>
                        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: p.tint[PLACE_TINT[pl.kind]].ink, alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name={PLACE_ICON[pl.kind]} size={16} color={p.tint[PLACE_TINT[pl.kind]].bg} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Txt size={14} weight="600" numberOfLines={1} color={ink}>
                            {pl.name}
                          </Txt>
                          {row.road ? (
                            <>
                              <Txt size={11.5} weight="600" color={ink}>
                                {`${formatDistance(row.road.roadM)} by road · ${row.road.minutes} min ${modeEn}`}
                              </Txt>
                              <Txt size={11} color={ink} style={{ opacity: 0.8 }}>
                                {`सड़क से ${formatDistance(row.road.roadM)} · ${row.road.minutes} मिनट ${modeHi}`}
                              </Txt>
                              {routeWarning(row.road) ? (
                                <Txt size={11} weight="600" color={p.danger}>
                                  Reported problem on the way · रास्ते में रिपोर्ट की समस्या
                                </Txt>
                              ) : null}
                            </>
                          ) : (
                            <>
                              <Txt size={11.5} weight="600" color={ink}>
                                {`${formatDistance(pl.distanceM)} straight line`}
                              </Txt>
                              <Txt size={11} color={ink} style={{ opacity: 0.8 }}>
                                {`सीधी दूरी ${formatDistance(pl.distanceM)}`}
                              </Txt>
                            </>
                          )}
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Icon name="navigate" size={14} color={ink} />
                          <Txt size={11} weight="600" color={ink}>
                            {compass}
                          </Txt>
                        </View>
                      </Row>
                    </Card>
                  </Press>
                </Appear>
              );
            })}
            {anyStraight && area ? (
              <Press accessibilityRole="button" disabled={downloading} onPress={() => void download()} style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: p.border, backgroundColor: p.card }}>
                <Icon name="refresh" size={13} color={p.text} />
                <Txt size={11.5} weight="600">
                  Refresh the map for road routes · सड़क मार्ग के लिए नक्शा ताज़ा करें
                </Txt>
              </Press>
            ) : null}
          </View>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt size={11} color={p.muted} style={{ flex: 1 }}>
              {t('areaSaved')} · {new Date(area.savedAt).toLocaleDateString()} · © OpenStreetMap
            </Txt>
            <Btn size="sm" kind="ghost" icon="refresh" label="" onPress={() => void download()} />
          </Row>
        </>
      ) : null}
      <RoadReportSheet visible={reporting} onClose={() => setReporting(false)} />
    </View>
  );
}
