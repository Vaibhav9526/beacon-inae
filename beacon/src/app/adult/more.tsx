import { router } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { Bell, Cross, Drop, Flower, Ribbon, Shield, Sun, Bolt, Wave } from '../../components/Deco';
import { Icon, type IconName } from '../../components/Icon';
import { Screen } from '../../components/Screen';
import { Appear, type TintName, Txt, useTheme } from '../../components/ui';
import { useLang, useT } from '../../i18n';
import * as haptics from '../../services/haptics';
import { useSettings } from '../../state/settings';

const EASE = Easing.out(Easing.cubic);

/** A vivid rounded tile. Press scales to 0.985 over 200ms. The sticker sits bottom-right with a light tilt. */
function BentoTile({
  label,
  icon,
  tint,
  deco,
  tilt = -8,
  minH = 124,
  onPress,
  flex,
}: {
  label: string;
  icon: IconName;
  tint: TintName;
  deco: React.ReactNode;
  tilt?: number;
  minH?: number;
  onPress: () => void;
  flex?: number;
}) {
  const { p } = useTheme();
  const reduced = useReducedMotion();
  const t = p.tint[tint];
  const s = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ flex: flex ?? undefined }}
      onPressIn={() => {
        haptics.tap();
        if (!reduced) s.value = withTiming(0.985, { duration: 200, easing: EASE });
      }}
      onPressOut={() => {
        if (!reduced) s.value = withTiming(1, { duration: 200, easing: EASE });
      }}
      onPress={onPress}>
      <Animated.View style={[{ flex: 1, minHeight: minH, borderRadius: 28, backgroundColor: t.bg, padding: 16, overflow: 'hidden', justifyContent: 'space-between' }, a]}>
        <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.6)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={20} color={t.ink} />
        </View>
        <Txt size={22} weight="700" color={t.ink} style={{ paddingRight: 44 }}>
          {label}
        </Txt>
        <View pointerEvents="none" style={{ position: 'absolute', right: -10, bottom: -10, transform: [{ rotate: `${tilt}deg` }] }}>
          {deco}
        </View>
      </Animated.View>
    </Pressable>
  );
}

export default function More() {
  const { p } = useTheme();
  const t = useT();
  const lang = useLang();
  const name = useSettings((s) => s.nickname).trim();
  const hi = lang === 'hi';
  const greet = hi ? `नमस्ते${name ? ` ${name}` : ''}, आपको क्या चाहिए?` : `Hi${name ? ` ${name}` : ' there'}, what do you need?`;

  const go = (href: string) => () => router.push(href as never);

  return (
    <Screen back={false} title={t('tabMore')}>
      <Appear>
        <View style={{ borderRadius: 28, backgroundColor: p.tint.peach.bg, padding: 20, minHeight: 150, overflow: 'hidden', justifyContent: 'flex-end' }}>
          <View pointerEvents="none" style={{ position: 'absolute', right: -16, top: -18, transform: [{ rotate: '12deg' }] }}>
            <Sun size={110} />
          </View>
          <Txt size={27} weight="700" color={p.tint.peach.ink} style={{ maxWidth: '72%', lineHeight: 32 }}>
            {greet}
          </Txt>
          <Txt size={13} color={p.tint.peach.ink} style={{ opacity: 0.8, marginTop: 6 }}>
            {hi ? 'आपके सारे ज़रूरी औज़ार एक टैप दूर।' : 'Your essential tools, one tap away.'}
          </Txt>
        </View>
      </Appear>

      {/* the three phases: before, during, after */}
      <Appear index={1} style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <BentoTile label={hi ? 'तैयारी' : 'Prepare'} icon="shield" tint="lilac" deco={<Shield size={86} />} tilt={-8} minH={232} onPress={go('/prepare')} />
        </View>
        <View style={{ flex: 1, gap: 12 }}>
          <BentoTile label={hi ? 'सुधार' : 'Recover'} icon="heart" tint="green" deco={<Flower size={64} />} tilt={9} onPress={go('/recover')} />
          <BentoTile label={hi ? 'संकेत औज़ार' : 'Signal tools'} icon="siren" tint="yellow" deco={<Bolt size={62} />} tilt={-7} onPress={go('/tools')} />
        </View>
      </Appear>

      {/* row: two small tiles on the left, one tall tile on the right */}
      <Appear index={2} style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1, gap: 12 }}>
          <BentoTile label={t('goBag')} icon="learn" tint="green" deco={<Shield size={70} />} tilt={8} onPress={go('/gobag')} />
          <BentoTile label={t('drills')} icon="trophy" tint="yellow" deco={<Bell size={66} />} tilt={-6} onPress={go('/drills')} />
        </View>
        <View style={{ flex: 1 }}>
          <BentoTile label={t('medicalId')} icon="heartPulse" tint="pink" deco={<Cross size={92} />} tilt={-10} minH={260} onPress={go('/medical')} />
        </View>
      </Appear>

      <Appear index={2} style={{ flexDirection: 'row', gap: 12 }}>
        <BentoTile flex={1} label={t('tabKids')} icon="family" tint="blue" deco={<Flower size={80} />} tilt={7} minH={104} onPress={go('/family')} />
        <BentoTile flex={1} label={hi ? 'फोटो जाँच' : 'Photo check'} icon="camera" tint="yellow" deco={<Cross size={70} />} tilt={-8} minH={104} onPress={go('/photo')} />
      </Appear>

      <Appear index={3} style={{ flexDirection: 'row', gap: 12 }}>
        <BentoTile flex={1} label={t('tabMap')} icon="map" tint="lilac" deco={<Wave size={62} />} tilt={-7} onPress={go('/adult/map')} />
        <BentoTile flex={1} label={hi ? 'डेस्कटॉप हब' : 'Desktop hub'} icon="bot" tint="peach" deco={<Bolt size={62} />} tilt={9} onPress={go('/hub')} />
      </Appear>

      <Appear index={4} style={{ flexDirection: 'row', gap: 12 }}>
        <BentoTile flex={1} label={hi ? 'मेश की सेहत' : 'Mesh health'} icon="radio" tint="blue" deco={<Wave size={62} />} tilt={-7} onPress={go('/mesh')} />
        <BentoTile flex={1} label={hi ? 'निजता' : 'Privacy'} icon="lock" tint="pink" deco={<Shield size={60} />} tilt={8} onPress={go('/privacy')} />
      </Appear>

      <Appear index={4} style={{ flexDirection: 'row', gap: 12 }}>
        <BentoTile flex={1} label={t('settings')} icon="settings" tint="blue" deco={<Ribbon size={62} />} tilt={-9} onPress={go('/settings')} />
        <BentoTile flex={1} label={t('language')} icon="language" tint="green" deco={<Drop size={62} />} tilt={8} onPress={go('/settings')} />
      </Appear>

      <Appear index={5}>
        <BentoTile label={hi ? 'मदद और जानकारी' : 'Help and about'} icon="info" tint="lilac" deco={<Sun size={78} />} tilt={10} minH={104} onPress={go('/adult/aid')} />
      </Appear>
    </Screen>
  );
}
