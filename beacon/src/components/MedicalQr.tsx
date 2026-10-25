import React, { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import { qrMatrix } from '../services/medicalCard';

/** Four modules of white margin so any camera can lock on, whatever the app theme. */
const QUIET_ZONE = 4;

/** Renders the medical QR: one path for every run of black modules, black on white, no theme colours. */
export function MedicalQr({ text, size }: { text: string; size: number }) {
  const matrix = useMemo(() => qrMatrix(text), [text]);
  const count = matrix.length;
  const box = count + QUIET_ZONE * 2;

  const path = useMemo(() => {
    let d = '';
    for (let y = 0; y < count; y++) {
      let x = 0;
      while (x < count) {
        if (!matrix[y][x]) {
          x++;
          continue;
        }
        const start = x;
        while (x < count && matrix[y][x]) x++;
        d += `M${start} ${y}h${x - start}v1h${start - x}z`;
      }
    }
    return d;
  }, [matrix, count]);

  return (
    <Svg width={size} height={size} viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${box} ${box}`} accessibilityLabel="Medical QR code">
      <Rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={box} height={box} fill="#FFFFFF" />
      <Path d={path} fill="#000000" />
    </Svg>
  );
}
