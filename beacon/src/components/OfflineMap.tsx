import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, ScrollView, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { useLocal, useT } from '../i18n';
import { type Nearby, type PlaceKind, compassWord, formatDistance, nearest, project } from '../maps/osm';
import { type Fix, getFix, watchFix } from '../services/location';
import { useMap } from '../services/maps';
import { radius } from '../theme';
import { Icon, type IconName } from './Icon';
import { Skeleton, SkeletonList } from './Skeleton';
import { Appear, Btn, Card, Chip, Press, Row, Txt, useTheme } from './ui';

export const PLACE_ICON: Record<PlaceKind, IconName> = { shelter: 'tent', hospital: 'hospital', water: 'water', police: 'shield', pharmacy: 'pill', fire: 'fire', school: 'learn' };
const PLACE_LABEL: Record<PlaceKind, 'shelter' | 'hospital' | 'water' | 'police' | 'pharmacy' | 'fire'> = { shelter: 'shelter', hospital: 'hospital', water: 'water', police: 'police', pharmacy: 'pharmacy', fire: 'fire', school: 'shelter' };
const FILTERS: PlaceKind[] = ['shelter', 'hospital', 'water', 'police', 'pharmacy'];
const PIN: Record<PlaceKind, string> = { shelter: '#2E9B5F', hospital: '#D14B4B', water: '#2F7FB5', police: '#5B3FA8', pharmacy: '#B97D12', fire: '#C2571A', school: '#7B7B86' };

const ROAD_STYLE = [
  { w: 3.6, c: '#E9B44C' },
  { w: 3, c: '#F3D58A' },
  { w: 2.1, c: '#FFFFFF' },
  { w: 1.4, c: '#FFFFFF' },
];

export function OfflineMap({ initialPlace, height = 340 }: { initialPlace?: PlaceKind; playful?: boolean; height?: number }) {
  const { p } = useTheme();
  const t = useT();
  const L = useLocal();
  void L;
  const { width } = useWindowDimensions();
  const size = Math.min(width - 32, 520);
  const { area, loaded, downloading, error, load, download } = useMap();
  const [fix, setFix] = useState<Fix | null>(null);
  const [fixSettled, setFixSettled] = useState(false); // true once the first GPS attempt has returned, fix or not
  const [filter, setFilter] = useState<PlaceKind | null>(initialPlace ?? null);
  const [scale, setScale] = useState(120); // px per km
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [target, setTarget] = useState<Nearby | null>(null);
  const panRef = useRef({ x: 0, y: 0 });

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
    const roadPaths = [0, 1, 2, 3].map((c) => area.roads.filter((r) => r.c === c).map((r) => line(r.p)).join(''));
    const water = area.water.map((w) => ({ d: line(w.p) + (w.area ? 'Z' : ''), area: w.area }));
    return { roadPaths, water };
  }, [area, center.lat, center.lon, scale, size]); // eslint-disable-line react-hooks/exhaustive-deps

  const near = useMemo(() => (area && fix ? nearest(area, fix, filter ?? FILTERS, 12) : []), [area, fix, filter]);
  useEffect(() => {
    if (filter && near[0]) setTarget(near[0]);
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const me = fix ? project(fix, center, scale, size) : null;
  const tgt = target ? project(target, center, scale, size) : null;
  const land = p.dark ? '#1C1C22' : '#EFECE4';
  const edge = p.dark ? '#0F0F13' : '#D8D3C6';

  if (!loaded) return <Skeleton h={height} w={size} r={radius.lg} style={{ alignSelf: 'center' }} />;

  return (
    <View style={{ gap: 12 }}>
      <View style={{ height, width: size, alignSelf: 'center', borderRadius: radius.lg, overflow: 'hidden', backgroundColor: land, borderWidth: 1, borderColor: p.border }} {...responder.panHandlers}>
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
              {me && tgt ? <Path d={`M${me.x} ${me.y}L${tgt.x} ${tgt.y}`} stroke={p.text} strokeWidth={1.5} strokeDasharray="4 5" fill="none" /> : null}
              {area.places
                .filter((pl) => !filter || pl.kind === filter || (filter === 'shelter' && pl.kind === 'school'))
                .map((pl, i) => {
                  const q = project(pl, center, scale, size);
                  const hot = target && target.lat === pl.lat && target.lon === pl.lon;
                  return (
                    <G key={i} onPress={() => fix && setTarget({ ...pl, distanceM: 0, bearing: 0 })}>
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
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 10 }}>
            <Icon name="map" size={26} color={p.muted} />
            <Txt size={13} color={p.muted} style={{ textAlign: 'center' }}>
              {t('noPlaces')}
            </Txt>
            <Btn label={downloading ? t('downloading') : t('downloadArea')} icon="download" size="sm" onPress={() => void download()} disabled={downloading} />
            {error ? (
              <Txt size={12} color={p.danger}>
                {error}
              </Txt>
            ) : null}
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 2 }}>
            <Chip label={t('nearest')} active={!filter} onPress={() => setFilter(null)} />
            {FILTERS.map((k) => (
              <Chip key={k} icon={PLACE_ICON[k]} label={t(PLACE_LABEL[k])} active={filter === k} onPress={() => setFilter(k)} />
            ))}
          </ScrollView>
          <View style={{ gap: 8 }}>
            {near.length === 0 && !fixSettled ? <SkeletonList n={3} /> : null}
            {near.slice(0, 6).map((pl, i) => {
              const hot = target && target.lat === pl.lat && target.lon === pl.lon;
              return (
                <Appear key={`${pl.lat}-${pl.lon}`} index={i}>
                  <Press onPress={() => setTarget(pl)}>
                    <Card style={{ padding: 10, borderColor: hot ? p.text : p.border }}>
                      <Row style={{ gap: 12 }}>
                        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: PIN[pl.kind] + '22', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name={PLACE_ICON[pl.kind]} size={16} color={PIN[pl.kind]} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Txt size={14} weight="500" numberOfLines={1}>
                            {pl.name}
                          </Txt>
                          <Txt size={11.5} color={p.muted}>
                            {t(PLACE_LABEL[pl.kind])}
                          </Txt>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Txt size={14} weight="600">
                            {formatDistance(pl.distanceM)}
                          </Txt>
                          <Txt size={11} color={p.muted}>
                            {compassWord(pl.bearing)}
                          </Txt>
                        </View>
                      </Row>
                    </Card>
                  </Press>
                </Appear>
              );
            })}
          </View>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt size={11} color={p.muted} style={{ flex: 1 }}>
              {t('areaSaved')} · {new Date(area.savedAt).toLocaleDateString()} · © OpenStreetMap
            </Txt>
            <Btn size="sm" kind="ghost" icon="refresh" label="" onPress={() => void download()} />
          </Row>
        </>
      ) : null}
    </View>
  );
}
