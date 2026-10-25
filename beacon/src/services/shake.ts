import { Accelerometer } from 'expo-sensors';
import { useEffect } from 'react';
import { Platform } from 'react-native';

/** Calls `onShake` after 3 hard shakes within 1.6 s. Used for shake-to-SOS. */
export function useShake(onShake: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;
    let hits: number[] = [];
    let last = 0;
    Accelerometer.setUpdateInterval(80);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const g = Math.sqrt(x * x + y * y + z * z); // 1 g at rest
      const now = Date.now();
      if (g > 2.6 && now - last > 180) {
        last = now;
        hits = [...hits.filter((t) => now - t < 1600), now];
        if (hits.length >= 3) {
          hits = [];
          onShake();
        }
      }
    });
    return () => sub.remove();
  }, [enabled, onShake]);
}
