import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import {
  isNativeDailyMonitorSchedulerAvailable,
  startNativeDailyMonitorScheduler,
  stopNativeDailyMonitorScheduler,
  isNativeDailyMonitorSchedulerRunning,
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
  const TAG = '[FG-SERVICE]';

  // Android's native foreground scheduler is now the authoritative clock.
  // It runs a native Handler loop and launches the single JS headless
  // collection entry at each wall-clock interval boundary. This avoids using
  // Expo Location callbacks as a timer, since those callbacks are OS-deferred.
  if (isNativeDailyMonitorSchedulerAvailable()) {
    try {
      // Clean up any foreground-location task left behind by an older APK so
      // the new native scheduler is the only Android foreground clock.
      try {
        if (await Location.hasStartedLocationUpdatesAsync(DAILY_FOREGROUND_LOCATION_TASK)) {
          await Location.stopLocationUpdatesAsync(DAILY_FOREGROUND_LOCATION_TASK);
        }
      } catch (legacyStopError: any) {
        console.warn(`${TAG} Legacy location scheduler cleanup warning:`, legacyStopError?.message || String(legacyStopError));
      }

      startNativeDailyMonitorScheduler(intervalMinutes);
      if (!isNativeDailyMonitorSchedulerRunning()) {
        return { success: false, error: 'Native Daily Monitor scheduler could not be verified' };
      }
      console.log(`${TAG} Native scheduler started and verified (interval: ${intervalMinutes} min)`);
      return { success: true };
    } catch (error: any) {
      const msg = error?.message || String(error);
      console.error(`${TAG} Native scheduler failed to start:`, msg);
      return { success: false, error: msg };
    }
  }

  // Non-Android/dev fallback: retain the existing Expo Location foreground
  // service so coordinator tests and unsupported runtimes still have a safe
  // implementation.
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      console.warn(`${TAG} Location permission not granted — cannot start fallback foreground service`);
      return { success: false, error: 'Location permission not granted' };
    }

    const isRunning = await isForegroundLocationServiceRunning();
    if (isRunning) {
      try {
        await Location.stopLocationUpdatesAsync(DAILY_FOREGROUND_LOCATION_TASK);
      } catch (stopError: any) {
        console.warn(`${TAG} Existing fallback service stop warning:`, stopError?.message || String(stopError));
      }
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

    const registered = await isForegroundLocationServiceRunning();
    if (!registered) {
      return { success: false, error: 'Fallback foreground location service registration could not be verified' };
    }

    console.log(`${TAG} Fallback foreground location service started and verified (interval: ${intervalMinutes} min)`);
    return { success: true };
  } catch (error: any) {
    const msg = error?.message || String(error);
    console.error(`${TAG} Fallback foreground service failed:`, msg);
    return { success: false, error: msg };
  }
}

export async function stopForegroundLocationService(): Promise<void> {
  const TAG = '[FG-SERVICE]';

  if (isNativeDailyMonitorSchedulerAvailable()) {
    try {
      stopNativeDailyMonitorScheduler();
      try {
        if (await Location.hasStartedLocationUpdatesAsync(DAILY_FOREGROUND_LOCATION_TASK)) {
          await Location.stopLocationUpdatesAsync(DAILY_FOREGROUND_LOCATION_TASK);
        }
      } catch (legacyStopError: any) {
        console.warn(`${TAG} Legacy location scheduler cleanup warning:`, legacyStopError?.message || String(legacyStopError));
      }
      console.log(`${TAG} Native scheduler stopped`);
      return;
    } catch (error: any) {
      console.error(`${TAG} Native scheduler stop failed:`, error?.message || String(error));
    }
  }

  try {
    const isRunning = await isForegroundLocationServiceRunning();
    if (!isRunning) return;
    await Location.stopLocationUpdatesAsync(DAILY_FOREGROUND_LOCATION_TASK);
    console.log(`${TAG} Fallback foreground location service stopped`);
  } catch (error: any) {
    console.error(`${TAG} Fallback foreground service stop failed:`, error?.message || String(error));
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

// Kept as a compatibility fallback for runtimes where the native scheduler is
// unavailable. Android builds with the native scheduler never use this task as
// the Daily Monitor clock.
TaskManager.defineTask(DAILY_FOREGROUND_LOCATION_TASK, async ({ data, error }) => {
  const TAG = '[FG-LOCATION]';

  if (error) {
    console.error(`${TAG} Location task error:`, error.message || String(error));
    return;
  }

  const locations = (data as any)?.locations;
  if (!locations || locations.length === 0) {
    console.log(`${TAG} No location data received`);
    return;
  }

  const location = locations[0];
  const lat = location?.coords?.latitude;
  const lon = location?.coords?.longitude;
  if (lat != null && lon != null) {
    console.log(`${TAG} Location update: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
  }

  try {
    if (!collectionCallback) {
      console.warn(`${TAG} Collection callback missing — using headless Daily Monitor fallback`);
      const dailyMonitor = await import('./dailyMonitor');
      const result = await dailyMonitor.performDailyCollection('automatic');
      console.log(`${TAG} Headless fallback collection: ${result.success ? 'success' : 'failed'}`);
      return;
    }

    const result = await collectionCallback();
    if (result.outcome === 'skipped_recent_automatic') {
      console.log(`${TAG} Collection skipped (recent automatic run)`);
    } else {
      console.log(`${TAG} Collection triggered: ${result.success ? 'success' : 'failed'}`);
    }
  } catch (collectionError: any) {
    console.error(`${TAG} Collection failed:`, collectionError?.message || String(collectionError));
  }
});
