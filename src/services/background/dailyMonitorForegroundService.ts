import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import {
  hasNativeDailyMonitorExactAlarmPermission,
  isNativeDailyMonitorSchedulerAvailable,
  isNativeDailyMonitorSchedulerRunning,
  startNativeDailyMonitorScheduler,
  stopNativeDailyMonitorScheduler,
} from './dailyMonitorNativeScheduler';

export const DAILY_FOREGROUND_LOCATION_TASK = 'STORM_LOG_DAILY_LOCATION';

type CollectionResult = { success: boolean; outcome?: string };
let collectionCallback: (() => Promise<CollectionResult>) | null = null;

export function registerForegroundLocationTask(
  callback: () => Promise<CollectionResult>,
): void {
  collectionCallback = callback;
}

export async function startForegroundLocationService(
  intervalMinutes: number,
): Promise<{ success: boolean; error?: string }> {
  const TAG = '[DAILY-SCHEDULER]';

  if (isNativeDailyMonitorSchedulerAvailable()) {
    try {
      // Remove the old expo-location foreground scheduler left by previous APKs.
      // The new Android path must sleep between AlarmManager wakeups.
      try {
        if (await Location.hasStartedLocationUpdatesAsync(DAILY_FOREGROUND_LOCATION_TASK)) {
          await Location.stopLocationUpdatesAsync(DAILY_FOREGROUND_LOCATION_TASK);
        }
      } catch (legacyStopError: any) {
        console.warn(`${TAG} Legacy location cleanup warning:`, legacyStopError?.message || String(legacyStopError));
      }

      if (!startNativeDailyMonitorScheduler(intervalMinutes)) {
        return { success: false, error: 'Native Daily Monitor scheduler is unavailable' };
      }

      // Alarm registration is synchronous on the native side. A short yield gives
      // the bridge time to reflect the PendingIntent before verification.
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
      if (!isNativeDailyMonitorSchedulerRunning()) {
        return { success: false, error: 'Native Daily Monitor alarm could not be verified' };
      }

      if (!hasNativeDailyMonitorExactAlarmPermission()) {
        console.warn(`${TAG} Exact-alarm permission is not granted; Android may delay 15-minute observations until permission is granted.`);
      }

      console.log(`${TAG} AlarmManager scheduler armed (interval: ${intervalMinutes} min)`);
      return { success: true };
    } catch (error: any) {
      const msg = error?.message || String(error);
      console.error(`${TAG} Native scheduler failed to start:`, msg);
      return { success: false, error: msg };
    }
  }

  // Compatibility fallback only. Production Android builds include the native
  // AlarmManager module, so expo-location must never be the primary interval clock.
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      return { success: false, error: 'Location permission not granted' };
    }

    if (await Location.hasStartedLocationUpdatesAsync(DAILY_FOREGROUND_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(DAILY_FOREGROUND_LOCATION_TASK);
    }

    const timeIntervalMs = Math.max(intervalMinutes * 60 * 1000, 60_000);
    await Location.startLocationUpdatesAsync(DAILY_FOREGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.Low,
      timeInterval: timeIntervalMs,
      distanceInterval: 0,
      deferredUpdatesDistance: 0,
      deferredUpdatesInterval: 0,
      showsBackgroundLocationIndicator: false,
      foregroundService: {
        notificationTitle: 'StormLog',
        notificationBody: `Daily Monitor active — collecting every ${intervalMinutes} min`,
        notificationColor: '#2196F3',
        killServiceOnDestroy: false,
      },
    });

    return (await Location.hasStartedLocationUpdatesAsync(DAILY_FOREGROUND_LOCATION_TASK))
      ? { success: true }
      : { success: false, error: 'Fallback location scheduler could not be verified' };
  } catch (error: any) {
    return { success: false, error: error?.message || String(error) };
  }
}

export async function stopForegroundLocationService(): Promise<void> {
  if (isNativeDailyMonitorSchedulerAvailable()) {
    stopNativeDailyMonitorScheduler();
  }

  try {
    if (await Location.hasStartedLocationUpdatesAsync(DAILY_FOREGROUND_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(DAILY_FOREGROUND_LOCATION_TASK);
    }
  } catch (error: any) {
    console.warn('[DAILY-SCHEDULER] Legacy location stop warning:', error?.message || String(error));
  }
}

export async function isForegroundLocationServiceRunning(): Promise<boolean> {
  if (isNativeDailyMonitorSchedulerAvailable()) {
    return isNativeDailyMonitorSchedulerRunning();
  }
  try {
    return await Location.hasStartedLocationUpdatesAsync(DAILY_FOREGROUND_LOCATION_TASK);
  } catch {
    return false;
  }
}

// Compatibility fallback for runtimes where the native scheduler is unavailable.
TaskManager.defineTask(DAILY_FOREGROUND_LOCATION_TASK, async ({ data, error }) => {
  const TAG = '[FG-LOCATION]';
  if (error) {
    console.error(`${TAG} Location task error:`, error.message || String(error));
    return;
  }

  const locations = (data as any)?.locations;
  if (!locations || locations.length === 0) return;

  try {
    if (!collectionCallback) {
      const dailyMonitor = await import('./dailyMonitor');
      await dailyMonitor.performDailyCollection('automatic');
      return;
    }
    await collectionCallback();
  } catch (collectionError: any) {
    console.error(`${TAG} Collection failed:`, collectionError?.message || String(collectionError));
  }
});
