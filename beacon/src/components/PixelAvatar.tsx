import React, { useEffect, useMemo, useState } from 'react';
import Svg, { Rect } from 'react-native-svg';

// Procedural pixel-art portraits (in the spirit of munder-difflin's code-drawn cast): every face is built on a 16x16 grid
// from a few traits, then given a one-pixel dark outline. No image files, and they stay crisp at any size.

const N = 16;
type Grid = (string | null)[][];

const blank = (): Grid => Array.from({ length: N }, () => Array<string | null>(N).fill(null));
const px = (g: Grid, x: number, y: number, c: string | null) => {
  if (x >= 0 && x < N && y >= 0 && y < N) g[y][x] = c;
};
const rect = (g: Grid, x: number, y: number, w: number, h: number, c: string) => {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(g, x + i, y + j, c);
};
const oval = (g: Grid, cx: number, cy: number, rx: number, ry: number, c: string) => {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) px(g, x, y, c);
};

function outline(g: Grid, ink: string) {
  const out = g.map((r) => [...r]);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++)
      if (!g[y][x]) {
        const near = [g[y - 1]?.[x], g[y + 1]?.[x], g[y]?.[x - 1], g[y]?.[x + 1]].some(Boolean);
        if (near) out[y][x] = ink;
      }
  return out;
}

export interface Traits {
  skin: string;
  hair: string;
  hairStyle: 'short' | 'long' | 'bun' | 'braids' | 'cap' | 'helmet' | 'bald' | 'curly';
  shirt: string;
  accent?: string;
  glasses?: boolean;
  mustache?: boolean;
  bindi?: boolean;
  stethoscope?: boolean;
  badge?: string; // small coloured chest mark
  bg?: string;
}

const INK = '#241B2B';
const EYE = '#1B1420';

function person(t: Traits, blink: boolean): Grid {
  const g = blank();
  // shoulders / shirt
  rect(g, 2, 12, 12, 4, t.shirt);
  rect(g, 4, 11, 8, 1, t.shirt);
  if (t.accent) {
    rect(g, 7, 12, 2, 4, t.accent); // collar / placket
  }
  if (t.stethoscope) {
    px(g, 5, 12, '#8A8F99');
    px(g, 5, 13, '#8A8F99');
    px(g, 6, 14, '#8A8F99');
    px(g, 7, 14, '#8A8F99');
    px(g, 8, 14, '#C9CDD6');
  }
  if (t.badge) rect(g, 10, 13, 2, 2, t.badge);
  // neck + head
  rect(g, 7, 10, 2, 2, t.skin);
  oval(g, 7.5, 6.2, 4.4, 5, t.skin);
  // hair
  const h = t.hair;
  switch (t.hairStyle) {
    case 'short':
      rect(g, 4, 1, 8, 3, h);
      rect(g, 3, 3, 1, 3, h);
      rect(g, 12, 3, 1, 3, h);
      break;
    case 'long':
      rect(g, 4, 1, 8, 3, h);
      rect(g, 3, 2, 2, 10, h);
      rect(g, 11, 2, 2, 10, h);
      break;
    case 'bun':
      rect(g, 4, 1, 8, 3, h);
      rect(g, 3, 3, 1, 4, h);
      rect(g, 12, 3, 1, 4, h);
      rect(g, 6, 0, 4, 2, h);
      break;
    case 'braids':
      rect(g, 4, 1, 8, 3, h);
      rect(g, 3, 3, 1, 9, h);
      rect(g, 12, 3, 1, 9, h);
      px(g, 3, 12, t.accent ?? '#E5487A');
      px(g, 12, 12, t.accent ?? '#E5487A');
      break;
    case 'curly':
      rect(g, 3, 1, 10, 3, h);
      rect(g, 2, 3, 2, 4, h);
      rect(g, 12, 3, 2, 4, h);
      break;
    case 'cap':
      rect(g, 3, 1, 10, 3, h);
      rect(g, 2, 4, 12, 1, h);
      break;
    case 'helmet':
      rect(g, 3, 0, 10, 4, h);
      rect(g, 2, 3, 12, 2, h);
      rect(g, 7, 0, 2, 3, '#FFE066');
      break;
    case 'bald':
      break;
  }
  if (t.bindi) px(g, 7, 3, '#D62F6E');
  // face
  if (blink) {
    rect(g, 5, 7, 2, 1, EYE);
    rect(g, 9, 7, 2, 1, EYE);
  } else {
    rect(g, 5, 6, 2, 2, EYE);
    rect(g, 9, 6, 2, 2, EYE);
    px(g, 5, 6, '#FFFFFF');
    px(g, 9, 6, '#FFFFFF');
  }
  px(g, 7, 8, shade(t.skin, -18));
  rect(g, 6, 9, 4, 1, '#B14B4B'); // mouth
  px(g, 5, 9, shade(t.skin, -10));
  px(g, 10, 9, shade(t.skin, -10));
  if (t.mustache) rect(g, 5, 8, 6, 1, h);
  if (t.glasses) {
    rect(g, 4, 5, 4, 1, '#2A2F3A');
    rect(g, 8, 5, 4, 1, '#2A2F3A');
    rect(g, 4, 8, 4, 1, '#2A2F3A');
    rect(g, 8, 8, 4, 1, '#2A2F3A');
    rect(g, 4, 5, 1, 4, '#2A2F3A');
    rect(g, 7, 5, 2, 1, '#2A2F3A');
    rect(g, 11, 5, 1, 4, '#2A2F3A');
  }
  return g;
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, v + amt));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => c(v).toString(16).padStart(2, '0')).join('')}`;
}

// ---- animals (kid buddies) ----

export type Species = 'fox' | 'panda' | 'bunny' | 'lion' | 'owl' | 'frog';
export const SPECIES: Species[] = ['fox', 'panda', 'bunny', 'lion', 'owl', 'frog'];

function animal(s: Species, blink: boolean): Grid {
  const g = blank();
  const eyes = (c = EYE) => {
    if (blink) {
      rect(g, 4, 8, 2, 1, c);
      rect(g, 10, 8, 2, 1, c);
    } else {
      rect(g, 4, 7, 2, 2, c);
      rect(g, 10, 7, 2, 2, c);
      px(g, 4, 7, '#fff');
      px(g, 10, 7, '#fff');
    }
  };
  if (s === 'fox') {
    rect(g, 2, 1, 3, 4, '#E8731C');
    rect(g, 11, 1, 3, 4, '#E8731C');
    px(g, 3, 2, '#3B2A2A');
    px(g, 12, 2, '#3B2A2A');
    oval(g, 7.5, 9, 6, 5, '#F28A2E');
    rect(g, 2, 10, 12, 4, '#FFF1E0');
    oval(g, 7.5, 9, 6, 5, '#F28A2E');
    rect(g, 3, 11, 10, 3, '#FFF1E0');
    eyes();
    rect(g, 7, 11, 2, 1, EYE);
  } else if (s === 'panda') {
    rect(g, 2, 1, 3, 3, EYE);
    rect(g, 11, 1, 3, 3, EYE);
    oval(g, 7.5, 9, 6, 5.5, '#FFFFFF');
    rect(g, 3, 6, 3, 4, EYE);
    rect(g, 10, 6, 3, 4, EYE);
    if (blink) {
      rect(g, 4, 8, 2, 1, '#fff');
      rect(g, 10, 8, 2, 1, '#fff');
    } else {
      px(g, 4, 8, '#fff');
      px(g, 11, 8, '#fff');
    }
    rect(g, 7, 11, 2, 1, EYE);
  } else if (s === 'bunny') {
    rect(g, 4, 0, 2, 6, '#FFFFFF');
    rect(g, 10, 0, 2, 6, '#FFFFFF');
    rect(g, 5, 1, 1, 4, '#FFB7CC');
    rect(g, 10, 1, 1, 4, '#FFB7CC');
    oval(g, 7.5, 10, 5.5, 4.5, '#FFFFFF');
    eyes();
    px(g, 7, 11, '#FF8FB0');
    px(g, 8, 11, '#FF8FB0');
  } else if (s === 'lion') {
    oval(g, 7.5, 8.5, 7, 7, '#E38A1D');
    oval(g, 7.5, 9, 5, 5, '#F9C65A');
    eyes();
    rect(g, 6, 11, 4, 2, '#FFE9B3');
    rect(g, 7, 11, 2, 1, EYE);
  } else if (s === 'owl') {
    rect(g, 2, 1, 3, 3, '#7A4B2A');
    rect(g, 11, 1, 3, 3, '#7A4B2A');
    oval(g, 7.5, 9, 6, 6, '#9B6238');
    rect(g, 3, 5, 4, 4, '#FFFFFF');
    rect(g, 9, 5, 4, 4, '#FFFFFF');
    rect(g, 4, 6, 2, 2, EYE);
    rect(g, 10, 6, 2, 2, EYE);
    if (blink) {
      rect(g, 3, 5, 4, 4, '#9B6238');
      rect(g, 9, 5, 4, 4, '#9B6238');
      rect(g, 4, 7, 2, 1, EYE);
      rect(g, 10, 7, 2, 1, EYE);
    }
    rect(g, 7, 9, 2, 2, '#FFB020');
    rect(g, 4, 12, 8, 3, '#F3D9A8');
  } else {
    rect(g, 2, 2, 4, 4, '#58C95B');
    rect(g, 10, 2, 4, 4, '#58C95B');
    px(g, 3, 3, '#fff');
    px(g, 11, 3, '#fff');
    px(g, 4, 4, EYE);
    px(g, 12, 4, EYE);
    oval(g, 7.5, 10, 7, 4.5, '#6ADA6C');
    rect(g, 4, 12, 8, 1, EYE);
  }
  return g;
}

// ---- named cast ----

export type CastId = 'didi' | 'asha' | 'veer' | 'sentinel' | 'medic' | 'rescue' | 'guardian' | 'scout' | 'orchestrator' | 'you';

const CAST: Record<CastId, Traits> = {
  didi: { skin: '#D9A06B', hair: '#1E1530', hairStyle: 'braids', shirt: '#F2B24B', accent: '#E5487A', bindi: true },
  asha: { skin: '#C58B5F', hair: '#2A1B14', hairStyle: 'bun', shirt: '#F6F7F9', accent: '#7FD1BF', glasses: true, stethoscope: true, badge: '#E5484D' },
  veer: { skin: '#C99467', hair: '#FF8A1F', hairStyle: 'helmet', shirt: '#E4572E', accent: '#FFE066', mustache: true },
  sentinel: { skin: '#E0AC83', hair: '#3B3F4A', hairStyle: 'short', shirt: '#5B7FD6', accent: '#CFE0FF', glasses: true },
  medic: { skin: '#B97D55', hair: '#1C1620', hairStyle: 'long', shirt: '#7FD1BF', accent: '#FFFFFF', badge: '#E5484D' },
  rescue: { skin: '#D3A178', hair: '#2B2420', hairStyle: 'cap', shirt: '#F28B3C', accent: '#FFE066', mustache: true },
  guardian: { skin: '#E3B48C', hair: '#6B3F2A', hairStyle: 'curly', shirt: '#B9A3FF', accent: '#FFFFFF' },
  scout: { skin: '#C48A60', hair: '#222733', hairStyle: 'short', shirt: '#7FB77E', accent: '#E8F3E6' },
  orchestrator: { skin: '#D8A57C', hair: '#2C2230', hairStyle: 'bald', shirt: '#2E2E36', accent: '#F1F1F4', glasses: true },
  you: { skin: '#D9A77F', hair: '#2A2230', hairStyle: 'short', shirt: '#A8B3C4', accent: '#FFFFFF' },
};

export const castOrder: CastId[] = ['didi', 'asha', 'veer', 'sentinel', 'medic', 'rescue', 'guardian', 'scout', 'orchestrator'];

export type AvatarSpec = { kind: 'cast'; id: CastId } | { kind: 'animal'; species: Species } | { kind: 'traits'; traits: Traits };

/**
 * A pixel portrait. `animated` makes the character blink now and then, a very small touch of life.
 * Pass a `bg` token for the little tinted tile behind the head.
 */
export function PixelAvatar({ spec, size = 48, bg, animated = false, round = true }: { spec: AvatarSpec; size?: number; bg?: string; animated?: boolean; round?: boolean }) {
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (!animated) return;
    let t1: ReturnType<typeof setTimeout>;
    let t2: ReturnType<typeof setTimeout>;
    const loop = () => {
      t1 = setTimeout(() => {
        setBlink(true);
        t2 = setTimeout(() => {
          setBlink(false);
          loop();
        }, 140);
      }, 2400 + Math.random() * 3200);
    };
    loop();
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [animated]);

  const grid = useMemo(() => {
    const g = spec.kind === 'animal' ? animal(spec.species, blink) : person(spec.kind === 'cast' ? CAST[spec.id] : spec.traits, blink);
    return outline(g, INK);
  }, [spec, blink]);

  const cell = size / N;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={round ? { borderRadius: size / 2, overflow: 'hidden' } : undefined}>
      <Rect width={size} height={size} fill={bg ?? 'transparent'} />
      {grid.flatMap((row, y) =>
        row.map((c, x) => (c ? <Rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell + 0.5} height={cell + 0.5} fill={c} /> : null)),
      )}
    </Svg>
  );
}

export const cast = (id: CastId): AvatarSpec => ({ kind: 'cast', id });
export const buddy = (species: Species): AvatarSpec => ({ kind: 'animal', species });
