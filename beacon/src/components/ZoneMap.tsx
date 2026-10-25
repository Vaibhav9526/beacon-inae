import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Line, Rect, Text as SvgText } from 'react-native-svg';
import { distanceKm } from '../alerts/sources';
import { useTheme } from './ui';

interface Pt {
  lat: number;
  lon: number;
}
interface Zone extends Pt {
  name: string;
  radius: number;
}

/** A tiny schematic: where the child is, relative to the safe zones and to you. No tiles, so it works offline. */
export function ZoneMap({ child, zones, me, height = 150 }: { child?: Pt; zones: Zone[]; me?: Pt | null; height?: number }) {
  const { p } = useTheme();
  const W = 320;
  const pts: Pt[] = [...(child ? [child] : []), ...zones, ...(me ? [me] : [])];
  if (pts.length === 0) return null;
  const mLat = pts.reduce((s, q) => s + q.lat, 0) / pts.length;
  const mLon = pts.reduce((s, q) => s + q.lon, 0) / pts.length;
  const kx = 111000 * Math.cos((mLat * Math.PI) / 180);
  const ky = 111000;
  const xy = (q: Pt) => ({ x: (q.lon - mLon) * kx, y: -(q.lat - mLat) * ky });
  let ext = 120;
  for (const q of pts) {
    const { x, y } = xy(q);
    ext = Math.max(ext, Math.abs(x) + 40, Math.abs(y) * (W / height) + 40);
  }
  for (const z of zones) ext = Math.max(ext, Math.abs(xy(z).x) + z.radius + 20);
  const s = W / 2 / ext; // px per metre
  const px = (q: Pt) => {
    const { x, y } = xy(q);
    return { x: W / 2 + x * s, y: height / 2 + y * s };
  };
  const away = child && me ? Math.round(distanceKm(me, child) * 1000) : null;
  const okc = p.ok;

  return (
    <View style={{ borderRadius: 16, overflow: 'hidden', backgroundColor: p.cardAlt, borderWidth: 1, borderColor: p.border }}>
      <Svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`}>
        <Rect width={W} height={height} fill="none" />
        {[0.25, 0.5, 0.75].map((f) => (
          <G key={f} opacity={0.5}>
            <Line x1={W * f} y1={0} x2={W * f} y2={height} stroke={p.border} />
            <Line x1={0} y1={height * f} x2={W} y2={height * f} stroke={p.border} />
          </G>
        ))}
        {zones.map((z, i) => {
          const c = px(z);
          return (
            <G key={i}>
              <Circle cx={c.x} cy={c.y} r={Math.max(8, z.radius * s)} fill={okc} fillOpacity={0.14} stroke={okc} strokeWidth={1.5} />
              <SvgText x={c.x} y={c.y + 3.5} fontSize={10} fontWeight="600" textAnchor="middle" fill={p.text}>
                {z.name.slice(0, 10)}
              </SvgText>
            </G>
          );
        })}
        {me ? <Circle cx={px(me).x} cy={px(me).y} r={5} fill={p.info} stroke="#fff" strokeWidth={2} /> : null}
        {child ? (
          <G>
            <Circle cx={px(child).x} cy={px(child).y} r={13} fill={p.text} opacity={0.12} />
            <Circle cx={px(child).x} cy={px(child).y} r={7} fill={p.text} stroke={p.bg} strokeWidth={2.5} />
          </G>
        ) : null}
        {away !== null ? (
          <SvgText x={W - 8} y={height - 8} fontSize={10.5} textAnchor="end" fill={p.muted}>
            {away < 1000 ? `${away} m` : `${(away / 1000).toFixed(1)} km`}
          </SvgText>
        ) : null}
      </Svg>
    </View>
  );
}
