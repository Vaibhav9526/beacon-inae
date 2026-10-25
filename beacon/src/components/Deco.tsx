import { useId } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  Line,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

type Props = { size?: number; style?: StyleProp<ViewStyle> };
type Stops = [offset: number, color: string, opacity?: number][];

// unique, SVG-safe id prefix per instance (useId yields colons, which url(#...) dislikes)
const useUid = () => 'd' + useId().replace(/[^a-zA-Z0-9]/g, '');

const polar = (cx: number, cy: number, r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;

const Lin = ({ id, stops, a = [0, 0, 1, 1] }: { id: string; stops: Stops; a?: [number, number, number, number] }) => (
  <LinearGradient id={id} x1={a[0]} y1={a[1]} x2={a[2]} y2={a[3]}>
    {stops.map(([o, c, op], i) => <Stop key={i} offset={o} stopColor={c} stopOpacity={op ?? 1} />)}
  </LinearGradient>
);

const Rad = ({ id, stops }: { id: string; stops: Stops }) => (
  <RadialGradient id={id}>
    {stops.map(([o, c, op], i) => <Stop key={i} offset={o} stopColor={c} stopOpacity={op ?? 1} />)}
  </RadialGradient>
);

// soft contact shadow under the sticker
const Shadow = ({ id, cy = 113, rx = 36 }: { id: string; cy?: number; rx?: number }) => (
  <>
    <Defs><Rad id={id} stops={[[0, '#000000', 0.35], [1, '#000000', 0]]} /></Defs>
    <Ellipse cx={60} cy={cy} rx={rx} ry={6} fill={`url(#${id})`} />
  </>
);

// glossy white hotspot
const Gloss = ({ id, cx, cy, rx, ry, o = 0.85 }: { id: string; cx: number; cy: number; rx: number; ry: number; o?: number }) => (
  <>
    <Defs><Rad id={id} stops={[[0, '#FFFFFF', o], [1, '#FFFFFF', 0]]} /></Defs>
    <Ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={`url(#${id})`} />
  </>
);

export function Flower({ size = 120, style }: Props) {
  const u = useUid();
  const petals = Array.from({ length: 6 }, (_, i) => polar(60, 60, 24, (i * Math.PI) / 3));
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" style={style}>
      <Defs>
        <Lin id={`${u}p`} stops={[[0, '#FF8A1F'], [1, '#FFD84A']]} a={[0, 0, 1, 1]} />
        <Lin id={`${u}b`} stops={[[0, '#FFB347'], [1, '#FFE066']]} a={[0, 0, 1, 1]} />
      </Defs>
      <Shadow id={`${u}s`} cy={112} rx={34} />
      {petals.map(([x, y], i) => <Circle key={i} cx={x} cy={y} r={19} fill={`url(#${u}p)`} />)}
      {petals.map(([x, y], i) => <Circle key={`h${i}`} cx={x - 5} cy={y - 6} r={5} fill="#FFFFFF" fillOpacity={0.35} />)}
      <Circle cx={60} cy={60} r={26} fill={`url(#${u}b)`} />
      <Gloss id={`${u}g`} cx={50} cy={48} rx={14} ry={9} />
    </Svg>
  );
}

export function Bell({ size = 120, style }: Props) {
  const u = useUid();
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" style={style}>
      <Defs>
        <Lin id={`${u}b`} stops={[[0, '#D2D9FF'], [0.55, '#8E9CF5'], [1, '#5566DB']]} />
        <Lin id={`${u}n`} stops={[[0, '#C98DFF'], [1, '#7A3BE0']]} />
      </Defs>
      <Shadow id={`${u}s`} />
      <Circle cx={60} cy={12} r={5} fill="#7F8DEA" />
      <Path d="M60 16C38 16 30 34 30 54L30 74L22 84L98 84L90 74L90 54C90 34 82 16 60 16Z" fill={`url(#${u}b)`} />
      <Circle cx={60} cy={96} r={9} fill={`url(#${u}b)`} />
      <Gloss id={`${u}g`} cx={44} cy={44} rx={8} ry={20} />
      <Circle cx={92} cy={30} r={15} fill={`url(#${u}n)`} stroke="#FFFFFF" strokeWidth={3} />
      <Gloss id={`${u}h`} cx={88} cy={24} rx={6} ry={4} o={0.9} />
    </Svg>
  );
}

export function Ribbon({ size = 120, style }: Props) {
  const u = useUid();
  const d = 'M22 92C22 50 60 40 60 62C60 84 98 74 98 28';
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" style={style}>
      <Defs>
        <Lin id={`${u}r`} stops={[[0, '#EEF8FF'], [1, '#86C2F2']]} />
      </Defs>
      <Shadow id={`${u}s`} rx={40} />
      <Path d={d} stroke={`url(#${u}r)`} strokeWidth={24} strokeLinecap="round" fill="none" />
      <Path d={d} stroke="#3F8CCB" strokeWidth={3} strokeOpacity={0.35} strokeDasharray="6 10" fill="none" />
      <Path d="M28 86C28 56 52 46 60 60" stroke="#FFFFFF" strokeWidth={5} strokeOpacity={0.75} strokeLinecap="round" fill="none" />
      <Path d="M80 40C90 34 94 32 98 28" stroke="#FFFFFF" strokeWidth={4} strokeOpacity={0.6} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

export function Shield({ size = 120, style }: Props) {
  const u = useUid();
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" style={style}>
      <Defs>
        <Lin id={`${u}s`} stops={[[0, '#FF9BE0'], [0.5, '#E25BCB'], [1, '#8A3BD9']]} a={[0, 0, 0.6, 1]} />
      </Defs>
      <Shadow id={`${u}d`} />
      <Path d="M60 12L100 26L100 60C100 86 82 102 60 110C38 102 20 86 20 60L20 26Z" fill={`url(#${u}s)`} />
      <Path d="M60 12L20 26L20 60C20 80 30 94 42 103C44 80 46 40 60 12Z" fill="#FFFFFF" fillOpacity={0.22} />
      <Gloss id={`${u}g`} cx={40} cy={32} rx={12} ry={6} />
      <Path d="M44 60L56 72L78 48" stroke="#FFFFFF" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

export function Drop({ size = 120, style }: Props) {
  const u = useUid();
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" style={style}>
      <Defs>
        <Lin id={`${u}d`} stops={[[0, '#A8E1FF'], [0.5, '#3EA6FF'], [1, '#1659E0']]} a={[0.2, 0, 0.8, 1]} />
      </Defs>
      <Shadow id={`${u}s`} rx={30} />
      <Path d="M60 12C60 12 26 58 26 80C26 98 41 110 60 110C79 110 94 98 94 80C94 58 60 12 60 12Z" fill={`url(#${u}d)`} />
      <Gloss id={`${u}g`} cx={44} cy={72} rx={7} ry={14} o={0.9} />
      <Gloss id={`${u}h`} cx={50} cy={40} rx={4} ry={6} o={0.8} />
      <Circle cx={40} cy={94} r={3} fill="#FFFFFF" fillOpacity={0.5} />
    </Svg>
  );
}

const WAVES: { y: number; stops: Stops }[] = [
  { y: 36, stops: [[0, '#B8FFF2'], [1, '#3FD3C0']] },
  { y: 60, stops: [[0, '#5FE3CF'], [1, '#14A596']] },
  { y: 84, stops: [[0, '#1FB3A3'], [1, '#065E59']] },
];

export function Wave({ size = 120, style }: Props) {
  const u = useUid();
  const crest = (y: number) => `M4 ${y}C24 ${y - 14} 44 ${y - 14} 60 ${y}S96 ${y + 14} 116 ${y}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" style={style}>
      <Defs>
        {WAVES.map((w, i) => <Lin key={i} id={`${u}w${i}`} stops={w.stops} />)}
      </Defs>
      <Shadow id={`${u}s`} cy={116} rx={46} />
      {WAVES.map((w, i) => (
        <Path key={i} d={`${crest(w.y)}L116 112L4 112Z`} fill={`url(#${u}w${i})`} />
      ))}
      {WAVES.map((w, i) => (
        <Path key={`c${i}`} d={crest(w.y)} stroke="#FFFFFF" strokeWidth={3} strokeOpacity={0.5} strokeLinecap="round" fill="none" />
      ))}
    </Svg>
  );
}

export function Sun({ size = 120, style }: Props) {
  const u = useUid();
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return [polar(60, 60, 37, a), polar(60, 60, 47, a)] as const;
  });
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" style={style}>
      <Defs>
        <Lin id={`${u}b`} stops={[[0, '#FFF6A6'], [1, '#FFC21A']]} />
      </Defs>
      <Shadow id={`${u}s`} cy={114} rx={34} />
      {rays.map(([[x1, y1], [x2, y2]], i) => (
        <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#FFB800" strokeWidth={11} strokeLinecap="round" />
      ))}
      <Circle cx={60} cy={60} r={30} fill={`url(#${u}b)`} />
      <Gloss id={`${u}g`} cx={50} cy={48} rx={12} ry={8} />
    </Svg>
  );
}

export function Cross({ size = 120, style }: Props) {
  const u = useUid();
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" style={style}>
      <Defs>
        <Lin id={`${u}c`} stops={[[0, '#FF9AB0'], [1, '#E0284F']]} a={[0.1, 0.1, 0.9, 0.9]} />
      </Defs>
      <Shadow id={`${u}s`} />
      <Rect x={44} y={18} width={32} height={84} rx={14} fill={`url(#${u}c)`} />
      <Rect x={18} y={44} width={84} height={32} rx={14} fill={`url(#${u}c)`} />
      <Rect x={49} y={26} width={7} height={22} rx={3.5} fill="#FFFFFF" fillOpacity={0.45} />
      <Rect x={26} y={49} width={22} height={7} rx={3.5} fill="#FFFFFF" fillOpacity={0.45} />
      <Gloss id={`${u}g`} cx={50} cy={50} rx={8} ry={8} o={0.6} />
    </Svg>
  );
}

export function Bolt({ size = 120, style }: Props) {
  const u = useUid();
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" style={style}>
      <Defs>
        <Lin id={`${u}b`} stops={[[0, '#FFF6B0'], [0.5, '#FFD93D'], [1, '#FF9F1C']]} />
      </Defs>
      <Shadow id={`${u}s`} cy={113} rx={28} />
      <Path d="M70 8L26 68L56 68L44 112L94 48L64 48Z" fill={`url(#${u}b)`} stroke="#F7B500" strokeWidth={4} strokeLinejoin="round" />
      <Path d="M66 18L38 60L56 60Z" fill="#FFFFFF" fillOpacity={0.4} />
    </Svg>
  );
}

export const DecoByName = {
  flower: Flower,
  bell: Bell,
  ribbon: Ribbon,
  shield: Shield,
  drop: Drop,
  wave: Wave,
  sun: Sun,
  cross: Cross,
  bolt: Bolt,
} as const;

export type DecoName = keyof typeof DecoByName;
