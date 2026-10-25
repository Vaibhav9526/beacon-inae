import React from 'react';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';

export type WeatherIconName = 'sun' | 'moon' | 'partly' | 'cloud' | 'fog' | 'rain' | 'storm' | 'snow';

const CLOUD = 'M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 11.5 3.5 3.5 0 0 0 7 18z';
const MOON = 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z';

function Rays({ cx, cy, r, color }: { cx: number; cy: number; r: number; color: string }) {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <G stroke={color} strokeWidth={1.8} strokeLinecap="round">
      <Circle cx={cx} cy={cy} r={r} fill="none" />
      {rays.map((a) => {
        const rad = (a * Math.PI) / 180;
        const r1 = r + 2.5;
        const r2 = r + 5;
        return <Line key={a} x1={cx + Math.cos(rad) * r1} y1={cy + Math.sin(rad) * r1} x2={cx + Math.cos(rad) * r2} y2={cy + Math.sin(rad) * r2} />;
      })}
    </G>
  );
}

/** Simple line weather icon in a 24px box. `color` is the ink colour. */
export function WeatherIcon({ name, color = '#0A0A0C', size = 24 }: { name: WeatherIconName; color?: string; size?: number }) {
  const stroke = { stroke: color, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  let body: React.ReactNode;
  switch (name) {
    case 'sun':
      body = <Rays cx={12} cy={12} r={4} color={color} />;
      break;
    case 'moon':
      body = <Path d={MOON} {...stroke} />;
      break;
    case 'partly':
      body = (
        <>
          <G transform="translate(-2 -3) scale(0.8)">
            <Rays cx={12} cy={12} r={4} color={color} />
          </G>
          <Path d={CLOUD} {...stroke} />
        </>
      );
      break;
    case 'cloud':
      body = <Path d={CLOUD} {...stroke} />;
      break;
    case 'fog':
      body = (
        <G {...stroke}>
          <Line x1={4} y1={9} x2={20} y2={9} />
          <Line x1={6} y1={13} x2={18} y2={13} />
          <Line x1={4} y1={17} x2={20} y2={17} />
        </G>
      );
      break;
    case 'rain':
      body = (
        <>
          <Path d={CLOUD} {...stroke} />
          <G {...stroke}>
            <Line x1={8} y1={18} x2={7} y2={21} />
            <Line x1={12} y1={18} x2={11} y2={21} />
            <Line x1={16} y1={18} x2={15} y2={21} />
          </G>
        </>
      );
      break;
    case 'storm':
      body = (
        <>
          <Path d={CLOUD} {...stroke} />
          <Path d="M12.5 15l-2 4h3l-2 3" {...stroke} />
        </>
      );
      break;
    case 'snow':
      body = (
        <G {...stroke}>
          <Line x1={12} y1={3} x2={12} y2={21} />
          <Line x1={4.2} y1={7.5} x2={19.8} y2={16.5} />
          <Line x1={4.2} y1={16.5} x2={19.8} y2={7.5} />
        </G>
      );
      break;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {body}
    </Svg>
  );
}
