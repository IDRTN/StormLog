import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchWeather } from '../weather';
import { insertDailyRecord } from '../../database/dailyWeather';
import { getActiveAlertTypes, fetchNwsAlerts } from '../nws/alerts';
import { notifyWeatherCollected, notifyCollectionFailed } from '../notifications';
import {
  processNwsAlertsForStormEvents,
  withNwsAlertProcessingFailures,
  type NwsAlertProcessingFailure,
} from '../stormLogs/nwsWarningTrigger';
import { dispatchWarningNotification } from '../stormLogs/warningNotificationDecision';
import { getActiveStormEvent } from '../../database/stormEvents';
import { collectLightningAutomatic } from '../lightning/lightningService';
import { expireDueAutomaticWarnings } from '../../database/warningEvents';
import { getLocalDateString, formatLocalDateTime } from '../../util/dateUtils';
import {
  startForegroundLocationService,
  stopForegroundLocationService,
  isForegroundLocationServiceRunning,
  registerForegroundLocationTask,
  DAILY_FOREGROUND_LOCATION_TASK,
} from './dailyMonitorForegroundService';
import {
  DailyMonitorCoordinator,
  DAILY_MONITOR_ENABLED_EXPORT,
  DAILY_MONITOR_INTERVAL_EXPORT,
  LAST_COLLECTION_KEY_EXPORT,
  LAST_ERROR_EXPORT,
  type DailyCollectionMode,
  type DailyCollectionResult,
} from './dailyMonitorCoordinator';

export const DAILY_MONITOR_TASK = 'STORM_LOG_DAILY_MONITOR';
export const DAILY_MONITOR_INTERVAL_KEY = 'daily_monitor_interval';
export const DAILY_MONITOR_ENABLED_KEY = 'daily_monitor_enabled';
export const LAST_COLLECTION_KEY = 'daily_monitor_last_collection';
export const LAST_ERROR_KEY = 'daily_monitor_last_error';
export const LAST_COLLECTION_DATE_KEY = 'daily_monitor_last_collection_date';
export { DAILY_FOREGROUND_LOCATION_TASK };
export const CACHED_LOCATION_LAT_KEY = 'daily_monitor_cached_location_lat';
export const CACHED_LOCATION_LON_KEY = 'daily_monitor_cached_location_lon';
export const CACHED_LOCATION_TIMESTAMP_KEY = 'daily_monitor_cached_location_timestamp';

const dailyMonitorCoordinator = new DailyMonitorCoordinator({
  runCollection: executeDailyCollectionPipeline,
  storage: AsyncStorage,
  scheduler: {
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (timerId) => clearTimeout(timerId as Parameters<typeof clearTimeout>[0]),
  },
  background: {
    isRegistered: () => TaskManager.isTaskRegisteredAsync(DAILY_MONITOR_TASK),
    register: async (intervalMinutes) => {
      await BackgroundFetch.registerTaskAsync(DAILY_MONITOR_TASK, {
        minimumInterval: Math.max(intervalMinutes * 60, 5 * 60),
        stopOnTerminate: false,
        startOnBoot: true,
      });
    },
    unregister: () => BackgroundFetch.unregisterTaskAsync(DAILY_MONITOR_TASK),
  },
  foregroundService: {
    start: (intervalMinutes) => startForegroundLocationService(intervalMinutes),
    stop: () => stopForegroundLocationService(),
    isRunning: () => isForegroundLocationServiceRunning(),
  },
});

// Register the callback at module scope so it is available to Android
// headless/background execution as soon as this module is loaded.
registerForegroundLocationTask(() => dailyMonitorCoordinator.collectAutomatic());

// Background task definition must remain at module top level.
TaskManager.defineTask(DAILY_MONITOR_TASK, async () => {
  const TAG = '[BG-TASK]';
  const now = new Date();
  console.log(`${TAG} EXECUTED at ${formatLocalDateTime(now)}`);
  console.log(`${TAG} Local date: ${getLocalDateString(now)}`);

  try {
    const result = await dailyMonitorCoordinator.collectAutomatic();
    if (!result.success) {
      const msg = `${formatLocalDateTime(new Date())}: ${result.error || 'Unknown collection error'}`;
      console.error(`${TAG} FAILED:`, msg);
      await AsyncStorage.setItem(LAST_ERROR_KEY, msg);
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
    if (result.outcome !== 'skipped_recent_automatic' && result.outcome !== 'skipped_inactive') {
      await AsyncStorage.setItem(LAST_COLLECTION_DATE_KEY, getLocalDateString(new Date()));
    }
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (error: any) {
    const msg = `${formatLocalDateTime(new Date())}: ${error?.message || String(error)}`;
    console.error(`${TAG} ERROR:`, msg);
    await AsyncStorage.setItem(LAST_ERROR_KEY, msg);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

async function executeDailyCollectionPipeline(): Promise<DailyCollectionResult> {
  const TAG = '[DAILY-MONITOR]';
  const now = new Date();
  const localDate = getLocalDateString(now);
  console.log(`${TAG} Collection cycle started at ${formatLocalDateTime(now)} (${localDate})`);

  try {
    const previousDate = await AsyncStorage.getItem(LAST_COLLECTION_DATE_KEY);
    if (previousDate !== localDate) {
      console.log(`${TAG} Local-day transition: ${previousDate || 'none'} -> ${localDate}`);
    }

    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      const error = 'Location permission not granted';
      await notifyCollectionFailed(error);
      return { success: false, error };
    }

    let position: Location.LocationObject | null = null;
    try {
      position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
    } catch (locationError) {
      console.warn(`${TAG} Current position unavailable:`, locationError);
    }

    if (!position) {
      try {
        position = await Location.getLastKnownPositionAsync();
      } catch (locationError) {
        console.warn(`${TAG} OS last-known location unavailable:`, locationError);
      }
    }

    if (!position) {
      const [cachedLat, cachedLon] = await Promise.all([
        AsyncStorage.getItem(CACHED_LOCATION_LAT_KEY),
        AsyncStorage.getItem(CACHED_LOCATION_LON_KEY),
      ]);
      if (cachedLat && cachedLon) {
        position = {
          coords: {
            latitude: Number(cachedLat),
            longitude: Number(cachedLon),
            altitude: null,
            accuracy: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Number(await AsyncStorage.getItem(CACHED_LOCATION_TIMESTAMP_KEY)) || Date.now(),
        } as Location.LocationObject;
        console.log(`${TAG} Using cached StormLog location`);
      }
    }

    if (!position) {
      const error = 'No usable location available';
      await notifyCollectionFailed(error);
      return { success: false, error };
    }

    const { latitude, longitude } = position.coords;
    await Promise.all([
      AsyncStorage.setItem(CACHED_LOCATION_LAT_KEY, latitude.toString()),
      AsyncStorage.setItem(CACHED_LOCATION_LON_KEY, longitude.toString()),
      AsyncStorage.setItem(CACHED_LOCATION_TIMESTAMP_KEY, Date.now().toString()),
    ]);

    let weatherResult;
    try {
      weatherResult = await fetchWeather(latitude, longitude);
    } catch (weatherError: any) {
      const error = weatherError?.message || String(weatherError);
      await notifyCollectionFailed(error);
      return { success: false, error };
    }

    try {
      const alerts = await fetchNwsAlerts(latitude, longitude);
      const activeAlertTypes = getActiveAlertTypes(alerts);
      await processNwsAlertsForStormEvents(alerts, latitude, longitude);
      await dispatchWarningNotification(alerts);
      await expireDueAutomaticWarnings();
      console.log(`${TAG} NWS alerts processed: ${activeAlertTypes.length} active types`);
    } catch (alertError) {
      console.warn(`${TAG} NWS alert processing failed (non-critical):`, alertError);
    }

    const observationTime = weatherResult.data.referenceTimeMs;
    if (observationTime == null) {
      const error = 'Weather response did not provide a reference observation time';
      await notifyCollectionFailed(error);
      return { success: false, error };
    }

    await insertDailyRecord({
      timestamp: observationTime,
      latitude,
      longitude,
      temperature: weatherResult.data.temperature,
      humidity: weatherResult.data.humidity,
      windSpeed: weatherResult.data.windSpeed,
      windDirection: weatherResult.data.windDirection,
      pressure: weatherResult.data.pressure,
      precipitation: weatherResult.data.precipitation,
      weatherCode: weatherResult.data.weatherCode,
      source: weatherResult.data.source,
      provenance: weatherResult.data.provenance,
      completeness: weatherResult.data.completeness,
    });
    console.log(`${TAG} DB INSERT OK at ${formatLocalDateTime(new Date(observationTime))}`);

    await notifyWeatherCollected(weatherResult.data);

    try {
      await collectLightningAutomatic(latitude, longitude, observationTime);
    } catch (lightningError) {
      console.warn(`${TAG} Lightning enrichment failed (non-critical):`, lightningError);
    }

    await AsyncStorage.setItem(LAST_COLLECTION_DATE_KEY, localDate);
    return { success: true, outcome: 'completed' };
  } catch (error: any) {
    const msg = error?.message || String(error);
    console.error(`${TAG} Collection pipeline failed:`, msg);
    await notifyCollectionFailed(msg);
    return { success: false, error: msg };
  }
}

export function getMonitorState() {
  return dailyMonitorCoordinator.getState();
}

export async function getMonitorStatus() {
  await dailyMonitorCoordinator.initialize();
  const state = dailyMonitorCoordinator.getState();
  const totalRecords = await import('../../database/dailyWeather').then(({ getDailyRecordCount }) => getDailyRecordCount());
  return {
    isActive: state.isActive,
    intervalMinutes: state.intervalMinutes,
    lastCollection: state.lastCollectionTime,
    lastError: state.lastError,
    totalRecords,
  };
}

export function subscribeToDailyMonitor(listener: Parameters<typeof dailyMonitorCoordinator.subscribe>[0]) {
  return dailyMonitorCoordinator.subscribe(listener);
}

export async function initializeDailyMonitorCoordinator(): Promise<void> {
  await dailyMonitorCoordinator.initialize();
}

/**
 * Repair a persisted active monitor after a fresh app process starts.
 *
 * Android/Expo can preserve a registered foreground-location task across an
 * APK update while the native foreground-service consumer is left in a bad
 * state. In that situation the UI can still report "running" while no new
 * location heartbeats reach the JS task. The supported recovery is to stop
 * and start the foreground location task while the app is visibly foregrounded.
 * This function is intentionally called only from the root app startup path;
 * headless/background task execution must never attempt this restart.
 */
export async function repairDailyMonitorRuntime(): Promise<void> {
  await dailyMonitorCoordinator.initialize();
  const state = dailyMonitorCoordinator.getState();
  if (!state.isActive) return;

  console.log('[DAILY-MONITOR] Repairing foreground runtime after app startup');
  await dailyMonitorCoordinator.stopMonitor();
  await dailyMonitorCoordinator.startMonitor(state.intervalMinutes);
  console.log('[DAILY-MONITOR] Foreground runtime repair complete');
}

export async function startDailyMonitor(intervalMinutes?: number): Promise<void> {
  await dailyMonitorCoordinator.startMonitor(intervalMinutes);
}

export async function stopDailyMonitor(): Promise<void> {
  await dailyMonitorCoordinator.stopMonitor();
}

export async function setDailyMonitorInterval(minutes: number): Promise<void> {
  await dailyMonitorCoordinator.setIntervalMinutes(minutes);
}

export async function collectDailyWeatherManually(): Promise<DailyCollectionResult> {
  return dailyMonitorCoordinator.collectManual();
}

export async function performDailyCollection(mode: DailyCollectionMode = 'manual'): Promise<DailyCollectionResult> {
  if (mode === 'automatic') return dailyMonitorCoordinator.collectAutomatic();
  return dailyMonitorCoordinator.collectManual();
}

export async function registerBackgroundTask(): Promise<void> {
  await dailyMonitorCoordinator.initialize();
  await dailyMonitorCoordinator.registerBackground(dailyMonitorCoordinator.getState().intervalMinutes);
}

export async function unregisterBackgroundTask(): Promise<void> {
  await dailyMonitorCoordinator.unregisterBackground();
}
