import React from 'react';
import { View } from 'react-native';
import { type AvatarSpec, PixelAvatar } from './PixelAvatar';
import { Appear, Card, Press, Txt, type TintName, useTheme } from './ui';

/** The big vivid card at the top of a home screen: two-line title, subtitle, optional children, a sticker in the corner. */
export function HeroCard({ title, subtitle, tint = 'lilac', deco, children, onPress }: { title: string; subtitle?: string; tint?: TintName; deco?: React.ReactNode; children?: React.ReactNode; onPress?: () => void }) {
  const { p } = useTheme();
  const t = p.tint[tint];
  const Wrap = onPress ? Press : React.Fragment;
  const wrapProps = onPress ? { onPress, accessibilityRole: 'button' as const, accessibilityLabel: title } : {};
  return (
    <Wrap {...(wrapProps as object)}>
    <View style={{ borderRadius: 28, backgroundColor: t.bg, padding: 20, overflow: 'hidden', gap: 16, minHeight: 184 }}>
      {deco ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: -18, right: -14, transform: [{ rotate: '14deg' }] }}>
          {deco}
        </View>
      ) : null}
      <View style={{ gap: 8, maxWidth: '64%' }}>
        <Txt size={36} weight="700" color={t.ink} style={{ lineHeight: 33 }}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt size={13.5} color={t.ink} style={{ opacity: 0.8 }}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {children ? <View style={{ marginTop: 'auto' }}>{children}</View> : null}
    </View>
    </Wrap>
  );
}

/** Small overlapping avatars with a "+N" bubble, sitting on a tinted hero. */
export function AvatarStack({ specs, more = 0, tint = 'lilac', size = 34 }: { specs: AvatarSpec[]; more?: number; tint?: TintName; size?: number }) {
  const { p } = useTheme();
  const t = p.tint[tint];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {specs.map((s, i) => (
        <View key={i} style={{ marginLeft: i ? -10 : 0, borderWidth: 2, borderColor: t.bg, borderRadius: (size + 4) / 2 }}>
          <PixelAvatar spec={s} size={size} bg="rgba(255,255,255,0.7)" />
        </View>
      ))}
      {more > 0 ? (
        <View style={{ marginLeft: -10, minWidth: size + 4, height: size + 4, paddingHorizontal: 8, borderRadius: (size + 4) / 2, backgroundColor: t.ink, alignItems: 'center', justifyContent: 'center' }}>
          <Txt size={12} weight="700" color={t.bg}>
            +{more}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

export type PlanTileProps = { label: string; title: string; meta?: string; tint: TintName; deco: React.ReactNode; onPress: () => void };

/** One tall sticker card in the "Your Plan" grid. The sticker sits bottom-right and is slightly rotated. */
export function PlanTile({ label, title, meta, tint, deco, onPress, tall }: PlanTileProps & { tall?: boolean }) {
  const { p } = useTheme();
  const t = p.tint[tint];
  return (
    <Press accessibilityRole="button" accessibilityLabel={title} onPress={onPress}>
      <Card tint={tint} style={{ minHeight: tall ? 196 : 164, padding: 14, borderRadius: 24, justifyContent: 'space-between', overflow: 'hidden' }}>
        <View style={{ alignSelf: 'flex-start', backgroundColor: t.ink, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Txt size={11} weight="600" color={t.bg}>
            {label}
          </Txt>
        </View>
        <View style={{ gap: 4, paddingRight: 36 }}>
          <Txt size={17} weight="700" color={t.ink}>
            {title}
          </Txt>
          {meta ? (
            <Txt size={12} color={t.ink} style={{ opacity: 0.8 }}>
              {meta}
            </Txt>
          ) : null}
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', right: -8, bottom: -8, transform: [{ rotate: '-10deg' }] }}>
          {deco}
        </View>
      </Card>
    </Press>
  );
}

/** Two-column staggered grid: the right column starts lower and the tiles alternate tall and short. */
export function PlanGrid({ items }: { items: (PlanTileProps & { id: string })[] }) {
  const cols = [0, 1].map((c) => items.filter((_, i) => i % 2 === c).map((it, i) => ({ it, order: i * 2 + c, tall: (i + c) % 2 === 0 })));
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
      {cols.map((col, c) => (
        <View key={c} style={{ flex: 1, gap: 12, marginTop: c ? 28 : 0 }}>
          {col.map(({ it, order, tall }) => (
            <Appear key={it.id} index={order}>
              <PlanTile {...it} tall={tall} />
            </Appear>
          ))}
        </View>
      ))}
    </View>
  );
}
