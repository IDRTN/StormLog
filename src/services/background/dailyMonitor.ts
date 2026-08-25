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
import { expireDueAutomaticWarnings } from '../../database/warningEvents';
import { getLocalDateString, formatLocalDateTime } from '../../util/dateUtils';

export const DAILY_MONITOR_TASK = 'STORM_LOG_DAILY_MONITOR';
export const DAILY_MONITOR_INTERVAL_KEY = 'daily_monitor_interval';
export const DAILY_MONITOR_ENABLED_KEY = 'daily_monitor_enabled';
export const LAST_COLLECTION_KEY = 'daily_monitor_last_collection';
export const LAST_ERROR_KEY = 'daily_monitor_last_error';
export const LAST_COLLECTION_DATE_KEY = 'daily_monitor_last_collection_date';

// ============================================================
// Background task definition — must be at module top level
// ============================================================
TaskManager.defineTask(DAILY_MONITOR_TASK, async () => {
  const TAG = '[BG-TASK]';
  const now = new Date();
  console.log(`${TAG} EXECUTED at ${formatLocalDateTime(now)}`);
  console.log(`${TAG} Local date: ${getLocalDateString(now)}`);

  try {
    const result = await performDailyCollection();
    if (!result.success) {
      const msg = `${formatLocalDateTime(new Date())}: ${result.error || 'Unknown collection error'}`;
      console.error(`${TAG} FAILED:`, msg);
      await AsyncStorage.setItem(LAST_ERROR_KEY, msg);
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
    await AsyncStorage.setItem(LAST_COLLECTION_KEY, Date.now().toString());
    await AsyncStorage.setItem(LAST_COLLECTION_DATE_KEY, getLocalDateString(new Date()));
    await AsyncStorage.removeItem(LAST_ERROR_KEY);
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (error: any) {
    const msg = error?.message || String(error);
    console.error(`${TAG} FAILED:`, msg);
    await AsyncStorage.setItem(LAST_ERROR_KEY, `${formatLocalDateTime(new Date())}: ${msg}`);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// ============================================================
// Core collection — works in foreground AND background.
// ============================================================
export async function performDailyCollection(): Promise<{ success: boolean; error?: string }> {
  const TAG = '[DAILY-COLLECT]';
  const now = new Date();
  const localDate = getLocalDateString(now);
  console.log(`${TAG} === Collection cycle ===`);
  console.log(`${TAG} Timestamp: ${formatLocalDateTime(now)}`);
  console.log(`${TAG} Local date: ${localDate}`);

  // Log if we detect a date transition
  const lastDate = await AsyncStorage.getItem(LAST_COLLECTION_DATE_KEY);
  if (lastDate && lastDate !== localDate) {
    console.log(`${TAG} DATE TRANSITION DETECTED: ${lastDate} → ${localDate}`);
  }

  // Step 1: Location permission
  const { status } = await Location.getForegroundPermissionsAsync();
  console.log(`${TAG} Permission: ${status}`);
  if (status !== 'granted') {
    return { success: false, error: 'Location permission not granted' };
  }

  // Step 2: Get location
  let lat: number, lon: number;
  try {
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
    lat = loc.coords.latitude;
    lon = loc.coords.longitude;
    console.log(`${TAG} Location: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
  } catch (err: any) {
    console.log(`${TAG} getCurrentPosition failed (${err?.message}), trying last known...`);
    try {
      const last = await Location.getLastKnownPositionAsync();
      if (last) {
        lat = last.coords.latitude;
        lon = last.coords.longitude;
        console.log(`${TAG} Last known: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
      } else {
        return { success: false, error: 'No location available' };
      }
    } catch {
      return { success: false, error: 'Failed to get location' };
    }
  }

  // Step 3: Fetch weather
  console.log(`${TAG} Fetching weather for ${lat.toFixed(4)}, ${lon.toFixed(4)}...`);
  const weatherResult = await fetchWeather(lat, lon);
  if (!weatherResult.success) {
    const msg = `Weather API: ${weatherResult.error}`;
    console.error(`${TAG} ${msg}`);
    await notifyCollectionFailed(msg);
    return { success: false, error: msg };
  }
  console.log(`${TAG} Weather: ${weatherResult.data.temperature}°F, ${weatherResult.data.weatherCondition}`);
  console.log(`${TAG} Current precip: ${weatherResult.data.precipitation}", Observed daily: ${weatherResult.data.observedDailyPrecipitation}"`);

  // Step 4: NWS alerts
  let alertTypes: string[] = [];
  let alertProcessingFailures: NwsAlertProcessingFailure[] = [];
  let warningBatch: Awaited<ReturnType<typeof processNwsAlertsForStormEvents>> | null = null;
  const alertCycleTime = weatherResult.data.referenceTimeMs ?? now.getTime();
  try {
    await expireDueAutomaticWarnings(alertCycleTime);
  } catch (err: any) {
    alertProcessingFailures.push({
      alertId: null,
      error: err,
    });
    console.error(`${TAG} Automatic warning expiration failed:`, err?.message || String(err));
  }

  try {
    const alerts = await fetchNwsAlerts(lat, lon, weatherResult.data.referenceTimeMs ?? Date.now());
    alertTypes = [...new Set(alerts.map(a => a.event))];
    console.log(`${TAG} NWS alerts: ${alertTypes.length > 0 ? alertTypes.join(', ') : 'none'}`);

    try {
      warningBatch = await processNwsAlertsForStormEvents(
        alerts,
        undefined,
        {
          notifyWarning: dispatchWarningNotification,
        }
      );
      alertProcessingFailures = warningBatch.failures;
      for (const failure of warningBatch.failures) {
        console.error(
          `${TAG} NWS warning processing failed for ${failure.alertId ?? '<missing-id>'}:`,
          failure.error
        );
      }
    } catch (err: any) {
      alertProcessingFailures = [{ alertId: null, error: err }];
      console.error(`${TAG} NWS warning batch failed:`, err?.message || String(err));
    }

    for (const delivered of warningBatch?.results ?? []) {
      const notification = delivered.notification as
        | { status?: string; error?: unknown }
        | undefined;
      if (notification?.status === 'failed') {
        console.error(
          `${TAG} Warning notification failed for ${delivered.alertId ?? '<missing-id>'}:`,
          notification.error
        );
      }
    }
  } catch (err: any) {
    console.log(`${TAG} NWS failed (non-critical): ${err?.message}`);
  }

  // Step 5: Determine precipitation to store in daily record.
  //
  // observedDailyPrecipitation = sum of hourly precipitation from local
  // midnight through the current hour. This is the OBSERVED accumulation
  // for today's calendar day, NOT a forecast.
  //
  // If unavailable, store null (not 0) to avoid falsely claiming zero rain.
  const observedDailyPrecip = weatherResult.data.observedDailyPrecipitation;
  const currentPrecip = weatherResult.data.precipitation;
  const precipitationProvenance = weatherResult.data.precipitationSource
    ?? weatherResult.data.pressureSource
    ?? weatherResult.data.currentConditionsSource;

  console.log(
    `${TAG} Precipitation decision: ` +
    `observed_daily=${observedDailyPrecip}", current_rate=${currentPrecip}" ` +
    `→ storing: ${observedDailyPrecip}"`
  );

  // Step 6: Insert into database
  try {
    const observationTime = weatherResult.data.referenceTimeMs;
    if (observationTime == null) {
      return { success: false, error: 'Weather provider did not return an observation reference time' };
    }

    const rowId = await insertDailyRecord({
      timestamp: observationTime,
      latitude: lat,
      longitude: lon,
      temperature: weatherResult.data.temperature,
      humidity: weatherResult.data.humidity,
      pressure: weatherResult.data.pressure,
      windSpeed: weatherResult.data.windSpeed,
      windDirection: weatherResult.data.windDirection,
      windGust: weatherResult.data.windGust,
      dewPoint: weatherResult.data.dewPoint,
      precipitation: observedDailyPrecip,
      weatherCondition: weatherResult.data.weatherCondition,
      nwsAlerts: alertTypes.length > 0 ? JSON.stringify(alertTypes) : null,
      utcOffsetSeconds: (weatherResult.data as any).utcOffsetSeconds,
      weatherTimezone: (weatherResult.data as any).weatherTimezone,
      provider: precipitationProvenance?.provider ?? null,
      product: precipitationProvenance?.source ?? null,
      stationId: precipitationProvenance?.stationId ?? null,
      gridId: precipitationProvenance?.gridId ?? null,
      observationTime: precipitationProvenance?.observationTime ?? null,
      retrievedTime: precipitationProvenance?.retrievedTime ?? null,
      confidence: precipitationProvenance?.confidence ?? null,
      completeness: weatherResult.data.observedDailyPrecipitationIsComplete ? 1 : 0,
    });
    console.log(`${TAG} DB INSERT OK — row ${rowId}, date: ${localDate}, precip: ${observedDailyPrecip}"`);

    const collectionResult = withNwsAlertProcessingFailures(
      { success: true },
      alertProcessingFailures
    );

    if (collectionResult.success) {
      await notifyWeatherCollected(weatherResult.data.temperature, weatherResult.data.weatherCondition);
    } else {
      await notifyCollectionFailed(collectionResult.error || 'NWS warning processing failed');
    }

    return collectionResult;
  } catch (err: any) {
    const msg = `DB insert failed: ${err?.message || String(err)}`;
    console.error(`${TAG} ${msg}`);
    return { success: false, error: msg };
  }
}

// ============================================================
// Register background task with Android
// ============================================================
export async function registerBackgroundTask(intervalMinutes: number = 15): Promise<{ success: boolean; error?: string }> {
  try {
    const intervalSeconds = Math.max(intervalMinutes * 60, 5 * 60);
    const isRegistered = await TaskManager.isTaskRegisteredAsync(DAILY_MONITOR_TASK);
    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(DAILY_MONITOR_TASK);
    }
    await BackgroundFetch.registerTaskAsync(DAILY_MONITOR_TASK, {
      minimumInterval: intervalSeconds,
      stopOnTerminate: false,
      startOnBoot: true,
    });
    const verify = await TaskManager.isTaskRegisteredAsync(DAILY_MONITOR_TASK);
    console.log(`[BG-REGISTER] verified: ${verify}, interval: ${intervalSeconds}s`);
    if (!verify) return { success: false, error: 'Registration not verified' };
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message };
  }
}

export async function unregisterBackgroundTask(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(DAILY_MONITOR_TASK)) {
      await BackgroundFetch.unregisterTaskAsync(DAILY_MONITOR_TASK);
    }
  } catch {}
}

export async function isBackgroundTaskRegistered(): Promise<boolean> {
  try { return await TaskManager.isTaskRegisteredAsync(DAILY_MONITOR_TASK); }
  catch { return false; }
}

export async function getMonitorStatus(): Promise<{
  isActive: boolean;
  lastCollection: number | null;
  lastError: string | null;
  totalRecords: number;
}> {
  const isActive = await isBackgroundTaskRegistered();
  const lastCollectionStr = await AsyncStorage.getItem(LAST_COLLECTION_KEY);
  const lastError = await AsyncStorage.getItem(LAST_ERROR_KEY);
  let totalRecords = 0;
  try {
    const { getDailyRecordCount } = await import('../../database/dailyWeather');
    totalRecords = await getDailyRecordCount();
  } catch {}
  return {
    isActive,
    lastCollection: lastCollectionStr ? parseInt(lastCollectionStr, 10) : null,
    lastError,
    totalRecords,
  };
}
