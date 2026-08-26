import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import {
  warningNotificationText,
  WarningNotificationPermissionDeniedError,
  type WarningNotificationContentInput,
} from './stormLogs/warningNotificationContent';

// ============================================================
// Configure foreground notification display
// ============================================================
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ============================================================
// Ensure notification channels exist (call early on startup)
// ============================================================
export async function ensureNotificationChannels(): Promise<void> {
  const TAG = '[NOTIF-CHANNELS]';
  if (Platform.OS !== 'android') {
    console.log(`${TAG} Not Android, skipping channels`);
    return;
  }

  try {
    const defaultChannel = await Notifications.getNotificationChannelAsync('default');
    if (!defaultChannel) {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Storm Log',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#58A6FF',
        sound: 'default',
        enableVibrate: true,
        showBadge: false,
      });
      console.log(`${TAG} Created 'default' channel (HIGH importance)`);
    } else {
      console.log(`${TAG} 'default' channel exists, importance: ${defaultChannel.importance}`);
    }

    const weatherChannel = await Notifications.getNotificationChannelAsync('weather');
    if (!weatherChannel) {
      await Notifications.setNotificationChannelAsync('weather', {
        name: 'Weather Updates',
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: 'default',
      });
      console.log(`${TAG} Created 'weather' channel`);
    }

    const alertsChannel = await Notifications.getNotificationChannelAsync('alerts');
    if (!alertsChannel) {
      await Notifications.setNotificationChannelAsync('alerts', {
        name: 'NWS Weather Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 200, 500],
        lightColor: '#F85149',
        sound: 'default',
        enableVibrate: true,
      });
      console.log(`${TAG} Created 'alerts' channel (MAX importance)`);
    }
  } catch (error: any) {
    console.error(`${TAG} Failed to create channels:`, error?.message);
  }
}

// ============================================================
// Request notification permission
// ============================================================
export async function requestNotificationPermission(): Promise<boolean> {
  const TAG = '[NOTIF]';
  console.log(`${TAG} Device is physical: ${Device.isDevice}`);

  await ensureNotificationChannels();

  const { status: existing } = await Notifications.getPermissionsAsync();
  console.log(`${TAG} Existing permission: ${existing}`);

  if (existing === 'granted') {
    console.log(`${TAG} Permission already granted`);
    return true;
  }

  const { status } = await Notifications.requestPermissionsAsync();
  console.log(`${TAG} Requested permission result: ${status}`);
  return status === 'granted';
}

// ============================================================
// Send notification — with full logging at every step
// ============================================================
export async function sendNotification(
  title: string,
  body: string,
  channelId: string = 'default'
): Promise<void> {
  const TAG = '[NOTIF-SEND]';

  try {
    // Step 1: Check device
    console.log(`${TAG} Device: ${Device.modelName || 'unknown'}, Platform: ${Platform.OS}`);

    // Step 2: Check permission
    const { status } = await Notifications.getPermissionsAsync();
    console.log(`${TAG} Permission status: ${status}`);

    if (status !== 'granted') {
      console.log(`${TAG} Requesting permission...`);
      const { status: newStatus } = await Notifications.requestPermissionsAsync();
      console.log(`${TAG} New permission status: ${newStatus}`);
      if (newStatus !== 'granted') {
        console.error(`${TAG} PERMISSION DENIED — cannot send notification`);
        return;
      }
    }

    // Step 3: Ensure channel exists
    if (Platform.OS === 'android') {
      const channel = await Notifications.getNotificationChannelAsync(channelId);
      if (channel && channel.importance === Notifications.AndroidImportance.NONE) {
        console.warn(`${TAG} Channel '${channelId}' is DISABLED (importance=NONE) — notification may not show`);
      } else if (!channel) {
        console.warn(`${TAG} Channel '${channelId}' does not exist, creating...`);
        await ensureNotificationChannels();
      }
    }

    // Step 4: Send the notification using a 1-second delay trigger
    // (null trigger is unreliable on some Android/Samsung devices)
    console.log(`${TAG} Sending: "${title}" — ${body} on channel '${channelId}'`);
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
      },
    });
    console.log(`${TAG} NOTIFICATION SCHEDULED — ID: ${id}`);
  } catch (error: any) {
    console.error(`${TAG} FAILED: ${error?.message || String(error)}`);
  }
}

// ============================================================
// Convenience senders
// ============================================================
export async function notifyStormLogStarted(): Promise<void> {
  await sendNotification('⛈️ Storm Log Started', 'Recording weather observations.');
}

export async function notifyStormLogStopped(count: number): Promise<void> {
  await sendNotification('⛈️ Storm Log Stopped', `${count} observation(s) recorded.`);
}

export async function notifyWeatherCollected(temp: number | null, condition: string | null, collectionTimeMs?: number): Promise<void> {
  const time = collectionTimeMs != null
    ? new Date(collectionTimeMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    : new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const t = temp != null ? `${Math.round(temp)}°F` : 'Temp unavailable';
  const c = condition || 'Conditions unavailable';
  await sendNotification('StormLog — Daily Monitor', `${time} · ${t} · ${c}`, 'weather');
}

export async function notifyNwsAlert(eventType: string, headline: string | null): Promise<void> {
  await sendNotification(`⚠️ NWS: ${eventType}`, headline || 'Active weather alert', 'alerts');
}

export { warningNotificationText, WarningNotificationPermissionDeniedError };
type WarningNotificationInput = WarningNotificationContentInput;

export async function ensureWarningNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await ensureNotificationChannels();
}

async function notifyWarningLifecycle(input: WarningNotificationInput): Promise<void> {
  await ensureWarningNotificationChannel();

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    console.warn('[WARNING-NOTIF] Permission denied; warning processing is unaffected.');
    throw new WarningNotificationPermissionDeniedError();
  }

  const { title, body } = warningNotificationText(input);
  if (title.includes(String(input.eventId)) || body.includes(String(input.eventId))) {
    throw new Error('Warning notification text must not contain internal event IDs');
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: {
        category: 'nws_warning',
        lifecycle: input.lifecycle,
        ...(input.eventId == null ? {} : { stormEventId: input.eventId }),
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 1,
    },
  });
}

export function notifyWarningCreated(
  input: Omit<WarningNotificationInput, 'lifecycle'>
): Promise<void> {
  return notifyWarningLifecycle({ ...input, lifecycle: 'created' });
}

export function notifyWarningUpdated(
  input: Omit<WarningNotificationInput, 'lifecycle'>
): Promise<void> {
  return notifyWarningLifecycle({ ...input, lifecycle: 'updated' });
}

export function notifyWarningCanceled(
  input: Omit<WarningNotificationInput, 'lifecycle'>
): Promise<void> {
  return notifyWarningLifecycle({ ...input, lifecycle: 'canceled' });
}

export async function notifyCollectionFailed(error: string): Promise<void> {
  await sendNotification('❌ Collection Failed', error.substring(0, 100));
}
