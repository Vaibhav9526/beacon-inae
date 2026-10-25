import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import { fonts } from '../../theme';
import { WeatherIcon } from './WeatherIcon';

export interface SunArcProps {
  /** 0..1 position of the sun along the day (already clamped by the caller or here). */
  progress: number;
  isDaylight: boolean;
  isDay: boolean;
  sunriseText: string;
  sunsetText: string;
  sunriseLabel: string;
  sunsetLabel: string;
  /** e.g. "Mild sun, UV 3" */
  centerText: string;
  ink: string;
  muted: string;
  width?: number;
}

const H = 110;
const PAD = 28;

/** Half-sine arc from sunrise (left) to sunset (right), with a glowing sun or moon dot on it. */
export function SunArc({ progress, isDaylight, isDay, sunriseText, sunsetText, sunriseLabel, sunsetLabel, centerText, ink, muted, width = 340 }: SunArcProps) {
  const t = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const base = H - 14;
  const amp = H - 34;
  const x0 = PAD;
  const x1 = width - PAD;
  const span = x1 - x0;
  // half-sine curve sampled into a polyline, so the drawn arc and the dot use the same maths
  const pts = Array.from({ length: 49 }, (_, i) => {
    const u = i / 48;
    return `${(x0 + span * u).toFixed(1)} ${(base - amp * Math.sin(Math.PI * u)).toFixed(1)}`;
  });
  const arc = `M ${pts.join(' L ')}`;
  const px = x0 + span * t;
  const py = base - amp * Math.sin(Math.PI * t);
  const showSun = isDaylight;
  // at night the dot sits on the dark side, below the horizon line
  const nx = x0 + span * t;
  const ny = base + 12;

  return (
    <View style={{ width, alignSelf: 'center' }}>
      <Svg width={width} height={H}>
        <Defs>
          <RadialGradient id="glow" cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0%" stopColor="#FFD08A" stopOpacity="0.9" />
            <Stop offset="100%" stopColor="#FFD08A" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Path d={arc} stroke={ink} strokeOpacity={0.35} strokeWidth={2} strokeDasharray="4 6" fill="none" />
        <Path d={`M ${x0} ${base} L ${x1} ${base}`} stroke={ink} strokeOpacity={0.15} strokeWidth={1} />
        {showSun ? (
          <>
            <Circle cx={px} cy={py} r={22} fill="url(#glow)" />
            <Circle cx={px} cy={py} r={7} fill="#F3A66B" stroke="#FFF4E0" strokeWidth={2} />
          </>
        ) : (
          <>
            <Circle cx={nx} cy={ny} r={16} fill={isDay ? '#FFFFFF' : '#CBD3FF'} opacity={0.12} />
            <Circle cx={nx} cy={ny} r={6} fill={isDay ? '#FFFFFF' : '#CBD3FF'} opacity={0.85} />
          </>
        )}
      </Svg>

      <View style={[StyleSheet.absoluteFill, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 12, paddingBottom: 0 }]} pointerEvents="none">
        <View>
          <Text style={{ fontFamily: fonts.bold, fontSize: 22, color: ink }}>{sunriseText}</Text>
          <Text style={{ fontFamily: fonts.regular, fontSize: 12, color: muted }}>{sunriseLabel}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 22, color: ink }}>{sunsetText}</Text>
          <Text style={{ fontFamily: fonts.regular, fontSize: 12, color: muted }}>{sunsetLabel}</Text>
        </View>
      </View>

      <View style={{ position: 'absolute', left: 0, right: 0, top: 4, alignItems: 'center' }} pointerEvents="none">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <WeatherIcon name={showSun ? 'sun' : 'moon'} color={ink} size={18} />
          <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: muted }}>{centerText}</Text>
        </View>
      </View>
    </View>
  );
}
