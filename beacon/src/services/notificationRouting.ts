// Local notifications for hub items and official alerts, and the tap that opens /notice/<id>.
// buildNotification (notify.ts) decides the words; this file schedules them and routes the tap.

import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useNotices } from '../state/notices';
import { type NoticeSource, type ChannelId, CHANNEL, buildNotification, parseNoticeData } from './notify';

let channelsReady: Promise<void> | null = null;

/** Creates the three severity channels once. Android only; a no-op elsewhere. */
export function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  if (!channelsReady) {
    channelsReady = (async () => {
      try {
        await Notifications.setNotificationChannelAsync(CHANNEL.severe, { name: 'Severe alerts', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 400, 200, 400], lightColor: '#E0457B' });
        await Notifications.setNotificationChannelAsync(CHANNEL.warning, { name: 'Warnings', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 150, 250], lightColor: '#F2A65A' });
        await Notifications.setNotificationChannelAsync(CHANNEL.info, { name: 'Updates', importance: Notifications.AndroidImportance.DEFAULT, sound: null });
      } catch {
        channelsReady = null; // try again on the next notification
      }
    })();
  }
  return channelsReady;
}

/**
 * Shows a notice once. Returns false when it was already notified, the platform has no notifications, or
 * scheduling failed (then it is not marked, so the next poll can try again).
 */
export async function scheduleNotice(source: NoticeSource, lang: 'en' | 'hi'): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const content = buildNotification(source, lang);
  const { id } = content.data;
  if (useNotices.getState().notifiedIds.includes(id)) return false;
  try {
    await ensureChannels();
    await Notifications.scheduleNotificationAsync({
      content: { title: content.title, body: content.body, data: { ...content.data }, sound: content.sound },
      trigger: { channelId: content.channelId as ChannelId },
    });
    useNotices.getState().markNotified(id);
    return true;
  } catch {
    return false;
  }
}

/** Notification ids this session already routed, so a repeated "last response" does not open the page twice. */
const routed = new Set<string>();
let coldStartChecked = false;

function openNotice(id: string, requestId: string | undefined) {
  if (requestId) {
    if (routed.has(requestId)) return;
    routed.add(requestId);
  }
  useNotices.getState().markRead([id]);
  router.push(`/notice/${encodeURIComponent(id)}` as never);
}

function handleResponse(res: Notifications.NotificationResponse | null | undefined) {
  if (!res) return;
  const parsed = parseNoticeData(res.notification?.request?.content?.data);
  if (!parsed) return; // not ours: ignore
  openNotice(parsed.id, res.notification?.request?.identifier);
}

/**
 * Mount once in the root layout. Opens /notice/<id> when a notification is tapped, including the tap that
 * launched the app from closed. Marks the notice read. Unknown payloads are ignored.
 */
export function useNotificationRouting() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener(handleResponse);
    if (!coldStartChecked) {
      coldStartChecked = true;
      // The app may have been opened by a tap. Wait a moment so the navigator is mounted first.
      void Notifications.getLastNotificationResponseAsync()
        .then((res) => {
          if (res) setTimeout(() => handleResponse(res), 400);
        })
        .catch(() => {
          /* no response to route */
        });
    }
    return () => sub.remove();
  }, []);
}
