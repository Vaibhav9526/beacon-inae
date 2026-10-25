import React from 'react';
import { Icon } from './Icon';
import { Row, useTheme } from './ui';

/** Three small stars, filled up to `n`. */
export function Stars({ n, size = 13 }: { n: number; size?: number }) {
  const { p } = useTheme();
  return (
    <Row style={{ gap: 2 }}>
      {[1, 2, 3].map((i) => (
        <Icon key={i} name="star" size={size} color={i <= n ? '#E9B44C' : p.border} fill={i <= n ? '#E9B44C' : 'none'} strokeWidth={1.6} />
      ))}
    </Row>
  );
}
