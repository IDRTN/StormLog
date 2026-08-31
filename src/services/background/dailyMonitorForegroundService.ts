import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

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
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      console.warn(`${TAG} Location permission not granted — cannot start foreground service`);
      return { success: false, error: 'Location permission not granted' };
    }

    const isRunning = await isForegroundLocationServiceRunning();
    if (isRunning) {
      console.log(`${TAG} Existing foreground service found — restarting for current app process`);
      try {
        await Location.stopLocationUpdatesAsync(DAILY_FOREGROUND_LOCATION_TASK);
      } catch (stopError: any) {
        console.warn(`${TAG} Existing service stop warning:`, stopError?.message || String(stopError));
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
      return { success: false, error: 'Foreground location service registration could not be verified' };
    }

    console.log(`${TAG} Foreground location service started and verified (interval: ${intervalMinutes} min)`);
    return { success: true };
  } catch (error: any) {
    const msg = error?.message || String(error);
    console.error(`${TAG} Failed to start:`, msg);
    return { success: false, error: msg };
  }
}

export async function stopForegroundLocationService(): Promise<void> {
  const TAG = '[FG-SERVICE]';
  try {
    const isRunning = await isForegroundLocationServiceRunning();
    if (!isRunning) return;
    await Location.stopLocationUpdatesAsync(DAILY_FOREGROUND_LOCATION_TASK);
    console.log(`${TAG} Foreground location service stopped`);
  } catch (error: any) {
    console.error(`${TAG} Failed to stop:`, error?.message || String(error));
  }
}

export async function isForegroundLocationServiceRunning(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(DAILY_FOREGROUND_LOCATION_TASK);
  } catch {
    return false;
  }
}

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
    // Headless Android execution may load this task without preserving the
    // module-level callback. Fall back to the coordinator's public automatic
    // entry point so the same single execution owner is used.
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
