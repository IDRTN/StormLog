import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import {
  warningNotificationText,
  WarningNotificationPermissionDeniedError,
  type WarningNotificationContentInput,
} from './stormLogs/warningNotificationContent';
import type { AutomaticStormStopReview } from './stormLogs/automaticStormLifecycle';

export const AUTOMATIC_STORM_STOP_CATEGORY = 'automatic_storm_stop_review';
export const KEEP_RECORDING_ACTION = 'KEEP_RECORDING';
export const STOP_RECORDING_ACTION = 'STOP_RECORDING';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function ensureNotificationChannels(): Promise<void> {
  const TAG = '[NOTIF-CHANNELS]';
  if (Platform.OS === 'android') {
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
      }

      const weatherChannel = await Notifications.getNotificationChannelAsync('weather');
      if (!weatherChannel) {
        await Notifications.setNotificationChannelAsync('weather', {
          name: 'Weather Updates',
          importance: Notifications.AndroidImportance.DEFAULT,
          sound: 'default',
        });
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
      }
    } catch (error: any) {
      console.error(`${TAG} Failed to create channels:`, error?.message);
    }
  }

  try {
    await Notifications.setNotificationCategoryAsync(AUTOMATIC_STORM_STOP_CATEGORY, [
      {
        identifier: KEEP_RECORDING_ACTION,
        buttonTitle: 'Keep Recording',
        options: { opensAppToForeground: true },
      },
      {
        identifier: STOP_RECORDING_ACTION,
        buttonTitle: 'Stop Recording',
        options: { opensAppToForeground: true },
      },
    ]);
  } catch (error: any) {
    console.warn(`${TAG} Could not register storm lifecycle actions:`, error?.message || String(error));
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  const TAG = '[NOTIF]';
  console.log(`${TAG} Device is physical: ${Device.isDevice}`);
  await ensureNotificationChannels();
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function sendNotification(
  title: string,
  body: string,
  channelId: string = 'default'
): Promise<void> {
  const TAG = '[NOTIF-SEND]';
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      const { status: newStatus } = await Notifications.requestPermissionsAsync();
      if (newStatus !== 'granted') return;
    }

    if (Platform.OS === 'android') {
      const channel = await Notifications.getNotificationChannelAsync(channelId);
      if (!channel) await ensureNotificationChannels();
      else if (channel.importance === Notifications.AndroidImportance.NONE) {
        console.warn(`${TAG} Channel '${channelId}' is disabled`);
      }
    }

    await Notifications.scheduleNotificationAsync({
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
  } catch (error: any) {
    console.error(`${TAG} FAILED: ${error?.message || String(error)}`);
  }
}

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

export async function notifyAutomaticStormStopReview(
  review: AutomaticStormStopReview,
): Promise<void> {
  await ensureNotificationChannels();
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    console.warn('[AUTO-STORM] Stop-review notification skipped; permission not granted');
    return;
  }

  const distance = review.nearestLightningMiles == null
    ? ''
    : ` Nearest recent lightning: ${review.nearestLightningMiles.toFixed(1)} mi.`;
  const reason = review.reason === 'lightning_clear'
    ? 'Nearby lightning has moved outside the monitoring threshold.'
    : 'The watch/warning has ended and no nearby lightning trigger remains.';

  await Notifications.scheduleNotificationAsync({
    content: {
      title: '⛈️ Keep recording this storm?',
      body: `${reason}${distance}`,
      categoryIdentifier: AUTOMATIC_STORM_STOP_CATEGORY,
      data: {
        category: AUTOMATIC_STORM_STOP_CATEGORY,
        stormEventId: review.eventId,
      },
      sound: true,
      priority: Notifications.AndroidNotificationPriority.HIGH,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 1,
    },
  });
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
