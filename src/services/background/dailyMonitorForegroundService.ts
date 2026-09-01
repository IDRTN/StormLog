import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

export const DAILY_FOREGROUND_LOCATION_TASK = 'STORM_LOG_DAILY_LOCATION';

// Android location providers may batch low-priority updates. Keep a short
// foreground-service heartbeat and let the coordinator's persisted cadence gate
// decide when a real observation is due. The location task is a wake/recovery
// mechanism, not the authoritative scheduler.
const FOREGROUND_HEARTBEAT_MS = 60_000;

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

    // Idempotent start is critical for headless Android execution. A newly
    // created JS process may discover an already-running native service; do not
    // stop/restart it because that can interrupt location callbacks and create a
    // self-inflicted monitoring gap.
    const isRunning = await isForegroundLocationServiceRunning();
    if (isRunning) {
      console.log(`${TAG} Existing foreground service already running — keeping it alive`);
      return { success: true };
    }

    // Do not ask Android to deliver location only at the observation interval.
    // A one-minute heartbeat gives the coordinator frequent opportunities to
    // recover a due collection while its persisted cadence gate prevents
    // duplicate observations. Balanced accuracy reduces battery cost versus a
    // high-accuracy continuous GPS lock.
    await Location.startLocationUpdatesAsync(DAILY_FOREGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: FOREGROUND_HEARTBEAT_MS,
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

    console.log(`${TAG} Foreground service started and verified (heartbeat: 1 min, collection interval: ${intervalMinutes} min)`);
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
  if (locations?.length) {
    const location = locations[0];
    const lat = location?.coords?.latitude;
    const lon = location?.coords?.longitude;
    if (lat != null && lon != null) {
      console.log(`${TAG} Location heartbeat: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
    }
  } else {
    console.log(`${TAG} Heartbeat received without location payload`);
  }

  try {
    // The Daily Monitor coordinator is the single authoritative execution
    // owner. The callback is registered when dailyMonitor.ts initializes the
    // module graph. Never perform a second, independent collection here: doing
    // so would bypass the coordinator's persisted cadence and in-flight guard.
    if (!collectionCallback) {
      console.error(`${TAG} Collection callback missing — refusing independent fallback collection`);
      return;
    }

    const result = await collectionCallback();
    if (result.outcome === 'skipped_recent_automatic' || result.outcome === 'skipped_inactive') {
      console.log(`${TAG} Collection skipped (${result.outcome})`);
    } else {
      console.log(`${TAG} Collection triggered: ${result.success ? 'success' : 'failed'}`);
    }
  } catch (collectionError: any) {
    console.error(`${TAG} Collection failed:`, collectionError?.message || String(collectionError));
  }
});
