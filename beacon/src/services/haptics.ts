import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { useSettings } from '../state/settings';

/** Whether haptics should fire right now (user setting on, and the platform supports it). */
const on = () => useSettings.getState().haptics && Platform.OS !== 'web';

/** Light selection tick, for toggles and taps. */
export const tap = () => {
  if (!on()) return;
  Haptics.selectionAsync().catch(() => {});
};

/** Soft impact, for a press with weight (danger actions, icon-only buttons). */
export const soft = () => {
  if (!on()) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
};

export const success = () => {
  if (!on()) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
};

export const warn = () => {
  if (!on()) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
};
