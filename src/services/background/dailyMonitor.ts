import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchWeather } from '../weather';
import { insertDailyRecord } from '../../database/dailyWeather';
import { fetchNwsAlerts } from '../nws/alerts';
import { notifyWeatherCollected, notifyCollectionFailed } from '../notifications';
import { processNwsAlertsForStormEvents, withNwsAlertProcessingFailures, type NwsAlertProcessingFailure } from '../stormLogs/nwsWarningTrigger';
import { dispatchWarningNotification } from '../stormLogs/warningNotificationDecision';
import { getActiveStormEvent } from '../../database/stormEvents';
import { collectLightningAutomatic } from '../lightning/lightningService';
import { expireDueAutomaticWarnings } from '../../database/warningEvents';
import { getLocalDateString, formatLocalDateTime } from '../../util/dateUtils';
import { startForegroundLocationService, stopForegroundLocationService, isForegroundLocationServiceRunning, registerForegroundLocationTask, DAILY_FOREGROUND_LOCATION_TASK } from './dailyMonitorForegroundService';
import { DailyMonitorCoordinator, DAILY_MONITOR_ENABLED_EXPORT, DAILY_MONITOR_INTERVAL_EXPORT, LAST_COLLECTION_KEY_EXPORT, LAST_ERROR_EXPORT, type DailyCollectionMode, type DailyCollectionResult } from './dailyMonitorCoordinator';
import { claimAutomaticCollection } from './dailyMonitorClaim';

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
      await BackgroundFetch.registerTaskAsync(DAILY_MONITOR_TASK, { minimumInterval: Math.max(intervalMinutes * 60, 5 * 60), stopOnTerminate: false, startOnBoot: true });
    },
    unregister: () => BackgroundFetch.unregisterTaskAsync(DAILY_MONITOR_TASK),
  },
  foregroundService: {
    start: (intervalMinutes) => startForegroundLocationService(intervalMinutes),
    stop: () => stopForegroundLocationService(),
    isRunning: () => isForegroundLocationServiceRunning(),
  },
  claimAutomatic: claimAutomaticCollection,
});

registerForegroundLocationTask(() => dailyMonitorCoordinator.collectAutomatic());

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
    if (result.outcome === 'skipped_recent_automatic') return BackgroundFetch.BackgroundFetchResult.NoData;
    await AsyncStorage.setItem(LAST_COLLECTION_DATE_KEY, getLocalDateString(new Date()));
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (error: any) {
    const msg = error?.message || String(error);
    console.error(`${TAG} FAILED:`, msg);
    await AsyncStorage.setItem(LAST_ERROR_KEY, `${formatLocalDateTime(new Date())}: ${msg}`);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function executeDailyCollectionPipeline(): Promise<{ success: boolean; error?: string }> {
  const TAG = '[DAILY-COLLECT]';
  const now = new Date();
  const localDate = getLocalDateString(now);
  console.log(`${TAG} === Collection cycle ===`);
  console.log(`${TAG} Timestamp: ${formatLocalDateTime(now)}`);
  console.log(`${TAG} Local date: ${localDate}`);

  const lastDate = await AsyncStorage.getItem(LAST_COLLECTION_DATE_KEY);
  if (lastDate && lastDate !== localDate) console.log(`${TAG} DATE TRANSITION DETECTED: ${lastDate} → ${localDate}`);

  const { status } = await Location.getForegroundPermissionsAsync();
  console.log(`${TAG} Permission: ${status}`);
  if (status !== 'granted') return { success: false, error: 'Location permission not granted' };

  let lat: number, lon: number;
  try {
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
    lat = loc.coords.latitude; lon = loc.coords.longitude;
    console.log(`${TAG} Location: ${lat.toFixed(4)}, ${lon.toFixed(4)} [current]`);
    try {
      await AsyncStorage.setItem(CACHED_LOCATION_LAT_KEY, lat.toString());
      await AsyncStorage.setItem(CACHED_LOCATION_LON_KEY, lon.toString());
      await AsyncStorage.setItem(CACHED_LOCATION_TIMESTAMP_KEY, Date.now().toString());
    } catch {}
  } catch (err: any) {
    console.log(`${TAG} getCurrentPosition failed (${err?.message}), trying last known...`);
    try {
      const last = await Location.getLastKnownPositionAsync();
      if (last) {
        lat = last.coords.latitude; lon = last.coords.longitude;
      } else {
        const cachedLat = await AsyncStorage.getItem(CACHED_LOCATION_LAT_KEY);
        const cachedLon = await AsyncStorage.getItem(CACHED_LOCATION_LON_KEY);
        const cachedTs = await AsyncStorage.getItem(CACHED_LOCATION_TIMESTAMP_KEY);
        if (!cachedLat || !cachedLon || !cachedTs) return { success: false, error: 'No location available' };
        lat = parseFloat(cachedLat); lon = parseFloat(cachedLon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { success: false, error: 'No location available' };
        console.log(`${TAG} Cached location: ${lat.toFixed(4)}, ${lon.toFixed(4)} [stormlog_cached, ${Math.round((Date.now() - Number(cachedTs)) / 60_000)}m old]`);
      }
    } catch { return { success: false, error: 'Failed to get location' }; }
  }

  const weatherResult = await fetchWeather(lat, lon);
  if (!weatherResult.success) {
    const msg = `Weather API: ${weatherResult.error}`;
    await notifyCollectionFailed(msg);
    return { success: false, error: msg };
  }

  let alertTypes: string[] = [];
  let alertProcessingFailures: NwsAlertProcessingFailure[] = [];
  let warningBatch: Awaited<ReturnType<typeof processNwsAlertsForStormEvents>> | null = null;
  const alertCycleTime = weatherResult.data.referenceTimeMs ?? now.getTime();
  try { await expireDueAutomaticWarnings(alertCycleTime); } catch (err: any) {
    alertProcessingFailures.push({ alertId: null, error: err });
  }
  try {
    const alerts = await fetchNwsAlerts(lat, lon, weatherResult.data.referenceTimeMs ?? Date.now());
    alertTypes = [...new Set(alerts.map(a => a.event))];
    try {
      warningBatch = await processNwsAlertsForStormEvents(alerts, undefined, { notifyWarning: dispatchWarningNotification });
      alertProcessingFailures = warningBatch.failures;
    } catch (err: any) { alertProcessingFailures = [{ alertId: null, error: err }]; }
  } catch (err: any) { console.log(`${TAG} NWS failed (non-critical): ${err?.message}`); }

  const observedDailyPrecip = weatherResult.data.observedDailyPrecipitation;
  const precipitationProvenance = weatherResult.data.precipitationSource ?? weatherResult.data.pressureSource ?? weatherResult.data.currentConditionsSource;

  try {
    const observationTime = weatherResult.data.referenceTimeMs;
    if (observationTime == null) return { success: false, error: 'Weather provider did not return an observation reference time' };
    const rowId = await insertDailyRecord({
      timestamp: observationTime, latitude: lat, longitude: lon,
      temperature: weatherResult.data.temperature, humidity: weatherResult.data.humidity,
      pressure: weatherResult.data.pressure, windSpeed: weatherResult.data.windSpeed,
      windDirection: weatherResult.data.windDirection, windGust: weatherResult.data.windGust,
      dewPoint: weatherResult.data.dewPoint, precipitation: observedDailyPrecip,
      weatherCondition: weatherResult.data.weatherCondition,
      nwsAlerts: alertTypes.length > 0 ? JSON.stringify(alertTypes) : null,
      utcOffsetSeconds: (weatherResult.data as any).utcOffsetSeconds,
      weatherTimezone: (weatherResult.data as any).weatherTimezone,
      provider: precipitationProvenance?.provider ?? null, product: precipitationProvenance?.source ?? null,
      stationId: precipitationProvenance?.stationId ?? null, gridId: precipitationProvenance?.gridId ?? null,
      observationTime: precipitationProvenance?.observationTime ?? null, retrievedTime: precipitationProvenance?.retrievedTime ?? null,
      confidence: precipitationProvenance?.confidence ?? null,
      completeness: weatherResult.data.observedDailyPrecipitationIsComplete ? 1 : 0,
    });
    console.log(`${TAG} DB INSERT OK — row ${rowId}, date: ${localDate}`);
    const collectionResult = withNwsAlertProcessingFailures({ success: true }, alertProcessingFailures);
    if (collectionResult.success) await notifyWeatherCollected(weatherResult.data.temperature, weatherResult.data.weatherCondition, Date.now());
    else await notifyCollectionFailed(collectionResult.error || 'NWS warning processing failed');
    try {
      const activeEvent = await getActiveStormEvent();
      await collectLightningAutomatic({ location: { latitude: lat, longitude: lon }, stormEventId: activeEvent?.isAutomatic === false ? activeEvent.id : null });
    } catch (lightningErr) { console.warn('[DAILY-COLLECT] Lightning collection failed:', lightningErr instanceof Error ? lightningErr.message : String(lightningErr)); }
    return collectionResult;
  } catch (err: any) {
    const msg = `DB insert failed: ${err?.message || String(err)}`;
    return { success: false, error: msg };
  }
}

export function subscribeToDailyMonitor(listener: (state: { isActive: boolean; intervalMinutes: number; loading: boolean; lastCollectionTime: number | null; lastError: string | null }) => void): () => void {
  return dailyMonitorCoordinator.subscribe(listener);
}
export async function initializeDailyMonitorCoordinator(): Promise<void> { await dailyMonitorCoordinator.initialize(); }
export async function startDailyMonitor(intervalMinutes?: number): Promise<void> { await dailyMonitorCoordinator.startMonitor(intervalMinutes); }
export async function stopDailyMonitor(): Promise<void> { await dailyMonitorCoordinator.stopMonitor(); }
export async function setDailyMonitorInterval(minutes: number): Promise<void> { await dailyMonitorCoordinator.setIntervalMinutes(minutes); }
export async function collectDailyWeatherManually(): Promise<DailyCollectionResult> { return dailyMonitorCoordinator.collectManual(); }
export async function performDailyCollection(mode: DailyCollectionMode = 'manual'): Promise<DailyCollectionResult> { return mode === 'automatic' ? dailyMonitorCoordinator.collectAutomatic() : dailyMonitorCoordinator.collectManual(); }
export async function registerBackgroundTask(intervalMinutes: number = 15): Promise<{ success: boolean; error?: string }> {
  try {
    await dailyMonitorCoordinator.registerBackground(intervalMinutes);
    const registered = await TaskManager.isTaskRegisteredAsync(DAILY_MONITOR_TASK);
    if (!registered) return { success: false, error: 'Registration not verified' };
    return { success: true };
  } catch (error: any) { return { success: false, error: error?.message }; }
}
export async function unregisterBackgroundTask(): Promise<void> { await dailyMonitorCoordinator.unregisterBackground(); }
