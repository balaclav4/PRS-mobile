import { Platform } from 'react-native';

let Haptics = null;

async function loadHaptics() {
  if (Platform.OS === 'web') return;
  if (!Haptics) {
    try { Haptics = require('expo-haptics'); } catch {}
  }
  return Haptics;
}

export async function lightTap() {
  const h = await loadHaptics();
  h?.impactAsync?.(h.ImpactFeedbackStyle.Light);
}

export async function mediumTap() {
  const h = await loadHaptics();
  h?.impactAsync?.(h.ImpactFeedbackStyle.Medium);
}

export async function successTap() {
  const h = await loadHaptics();
  h?.notificationAsync?.(h.NotificationFeedbackType.Success);
}

export async function selectionTap() {
  const h = await loadHaptics();
  h?.selectionAsync?.();
}
