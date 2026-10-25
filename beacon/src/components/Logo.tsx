import { Image } from 'expo-image';
import { View } from 'react-native';
import { useTheme } from './ui';

const LOGO = require('../../assets/logo-source.png');

type Props = { size?: number; rounded?: boolean };

export function Logo({ size = 64, rounded = true }: Props) {
  const { p } = useTheme();
  const radius = rounded ? size * 0.28 : 0;
  return (
    <View style={{ width: size, height: size, borderRadius: radius, borderWidth: 1, borderColor: p.border, overflow: 'hidden' }}>
      <Image source={LOGO} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={200} accessibilityLabel="Beacon logo" />
    </View>
  );
}
