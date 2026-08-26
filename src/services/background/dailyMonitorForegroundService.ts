import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

// ============================================================
// Foreground Location Service for Daily Monitor
//
// Uses expo-location's foreground service to produce periodic
// location updates that trigger the DailyMonitorCoordinator.
//
// The coordinator remains the ONE authoritative execution owner.
// This module is an execution trigger only.
// ============================================================

export const DAILY_FOREGROUND_LOCATION_TASK = 'STORM_LOG_DAILY_LOCATION';

/**
 * Register the foreground location task.
 * Must be called at module top level (same pattern as BackgroundFetch task).
 * Accepts a collection callback that will be invoked on each location update.
 * The callback should call dailyMonitorCoordinator.collectAutomatic().
 */
let collectionCallback: (() => Promise<{ success: boolean; outcome?: string }>) | null = null;

export function registerForegroundLocationTask(
  callback: () => Promise<{ success: boolean; outcome?: string }>,
): void {
  collectionCallback = callback;
}

/**
 * Start the foreground location service.
 * Must be called while the app is in the foreground (Android 12+ restriction).
 *
 * @param intervalMinutes - Collection interval (e.g. 15)
 */
export async function startForegroundLocationService(
  intervalMinutes: number,
): Promise<{ success: boolean; error?: string }> {
  const TAG = '[FG-SERVICE]';
  try {
    // Check foreground location permission
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      console.warn(`${TAG} Location permission not granted — cannot start foreground service`);
      return { success: false, error: 'Location permission not granted' };
    }

    // Check if already running
    const isRunning = await isForegroundLocationServiceRunning();
    if (isRunning) {
      console.log(`${TAG} Foreground location service already running`);
      return { success: true };
    }

    // Start location updates with foreground service
    const timeIntervalMs = Math.max(intervalMinutes * 60 * 1000, 60_000); // minimum 60 seconds

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

    console.log(`${TAG} Foreground location service started (interval: ${intervalMinutes} min)`);
    return { success: true };
  } catch (error: any) {
    const msg = error?.message || String(error);
    console.error(`${TAG} Failed to start:`, msg);
    return { success: false, error: msg };
  }
}

/**
 * Stop the foreground location service.
 */
export async function stopForegroundLocationService(): Promise<void> {
  const TAG = '[FG-SERVICE]';
  try {
    const isRunning = await isForegroundLocationServiceRunning();
    if (!isRunning) {
      console.log(`${TAG} Foreground location service not running`);
      return;
    }

    await Location.stopLocationUpdatesAsync(DAILY_FOREGROUND_LOCATION_TASK);
    console.log(`${TAG} Foreground location service stopped`);
  } catch (error: any) {
    console.error(`${TAG} Failed to stop:`, error?.message || String(error));
  }
}

/**
 * Check if the foreground location service is currently registered.
 */
export async function isForegroundLocationServiceRunning(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(DAILY_FOREGROUND_LOCATION_TASK);
  } catch {
    return false;
  }
}

// ============================================================
// Task definition — must be at module top level
// ============================================================
TaskManager.defineTask(DAILY_FOREGROUND_LOCATION_TASK, async ({ data }) => {
  const TAG = '[FG-LOCATION]';
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

  // Delegate to the coordinator — the ONE authoritative execution owner.
  if (collectionCallback) {
    try {
      const result = await collectionCallback();
      if (result.outcome === 'skipped_recent_automatic') {
        console.log(`${TAG} Collection skipped (recent automatic run)`);
      } else {
        console.log(`${TAG} Collection triggered: ${result.success ? 'success' : 'failed'}`);
      }
    } catch (error: any) {
      console.error(`${TAG} Collection failed:`, error?.message || String(error));
    }
  } else {
    console.warn(`${TAG} No collection callback registered`);
  }
});
