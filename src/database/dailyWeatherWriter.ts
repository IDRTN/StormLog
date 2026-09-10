import { getDatabase } from './database';
import type { DailyWeatherRecord } from '../models/types';

export type DailyWeatherWriteResult = {
  rowId: number;
  inserted: boolean;
  collectionTimestamp: number;
};

export type DailyWeatherWriteOptions = {
  /** Override only for deterministic tests/replay. Normal callers use Date.now(). */
  collectedAtMs?: number;
  /**
   * Protects against a near-simultaneous recovery-path race without collapsing
   * legitimate 5/10/15-minute collections that happen to contain the same
   * upstream provider observation.
   */
  duplicateWindowMs?: number;
};

const DEFAULT_DUPLICATE_WINDOW_MS = 30_000;
const AUTO_STORM_SEED_LOOKBACK_MS = 20 * 60 * 1000;

/**
 * Install the persistence bridge between Daily Monitor and automatic storm
 * events.
 *
 * Automatic storm events deliberately do not run a second React setInterval
 * weather logger: the native Daily Monitor is the reliable background clock.
 * These SQLite triggers therefore make the already-persisted Daily Monitor
 * sample the authoritative weather feed for automatic storm events:
 *
 * 1. Every new Daily Monitor row is mirrored into the newest active automatic
 *    storm event.
 * 2. When an automatic event starts after the current Daily Monitor row was
 *    written (for example lightning starts the event later in the same cycle),
 *    seed it with the most recent Daily Monitor sample from the last 20 minutes.
 *
 * Keeping this at the persistence boundary means it works whether the app UI is
 * open, backgrounded, or fully terminated and restarted headlessly.
 */
async function ensureAutomaticStormObservationBridge(
  db: Awaited<ReturnType<typeof getDatabase>>,
): Promise<void> {
  await db.execAsync(`
    CREATE TRIGGER IF NOT EXISTS trg_daily_weather_to_auto_storm_v1
    AFTER INSERT ON daily_weather
    BEGIN
      INSERT INTO weather_observations
        (timestamp, latitude, longitude, temperature, humidity, pressure,
         windSpeed, windDirection, windGust, dewPoint, precipitation,
         weatherCondition, stormEventId)
      SELECT
        NEW.timestamp, NEW.latitude, NEW.longitude, NEW.temperature,
        NEW.humidity, NEW.pressure, NEW.windSpeed, NEW.windDirection,
        NEW.windGust, NEW.dewPoint, NEW.precipitation, NEW.weatherCondition,
        active.id
      FROM (
        SELECT id
        FROM storm_events
        WHERE endTime IS NULL AND is_automatic = 1
        ORDER BY startTime DESC
        LIMIT 1
      ) AS active
      WHERE NOT EXISTS (
        SELECT 1
        FROM weather_observations existing
        WHERE existing.stormEventId = active.id
          AND existing.timestamp = NEW.timestamp
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_auto_storm_seed_daily_weather_v1
    AFTER INSERT ON storm_events
    WHEN NEW.is_automatic = 1
    BEGIN
      INSERT INTO weather_observations
        (timestamp, latitude, longitude, temperature, humidity, pressure,
         windSpeed, windDirection, windGust, dewPoint, precipitation,
         weatherCondition, stormEventId)
      SELECT
        latest.timestamp, latest.latitude, latest.longitude, latest.temperature,
        latest.humidity, latest.pressure, latest.windSpeed, latest.windDirection,
        latest.windGust, latest.dewPoint, latest.precipitation,
        latest.weatherCondition, NEW.id
      FROM (
        SELECT *
        FROM daily_weather
        WHERE timestamp >= NEW.startTime - ${AUTO_STORM_SEED_LOOKBACK_MS}
          AND timestamp <= NEW.startTime + ${DEFAULT_DUPLICATE_WINDOW_MS}
        ORDER BY timestamp DESC
        LIMIT 1
      ) AS latest
      WHERE NOT EXISTS (
        SELECT 1
        FROM weather_observations existing
        WHERE existing.stormEventId = NEW.id
      );
    END;
  `);
}

/**
 * Persist one Daily Monitor collection attempt.
 *
 * `daily_weather.timestamp` is the time StormLog actually collected the sample.
 * The upstream weather-provider timestamp is preserved separately in
 * `observationTime`. This distinction is important: a station/provider can
 * legally return the same source observation across two 15-minute StormLog
 * cycles. Using the provider timestamp as the row identity made a healthy
 * scheduler look as if it had skipped an interval because the second collection
 * was discarded as a duplicate.
 *
 * Multiple Android recovery paths are still allowed to race. A narrow
 * collection-time window suppresses only near-simultaneous duplicate writes;
 * it does not suppress the next legitimate configured interval.
 */
export async function insertDailyRecordIdempotent(
  record: Omit<DailyWeatherRecord, 'id'> & {
    utcOffsetSeconds?: number;
    weatherTimezone?: string;
  },
  options: DailyWeatherWriteOptions = {},
): Promise<DailyWeatherWriteResult> {
  const db = await getDatabase();
  await ensureAutomaticStormObservationBridge(db);

  const collectionTimestamp = options.collectedAtMs ?? Date.now();
  const duplicateWindowMs = Math.max(
    0,
    options.duplicateWindowMs ?? DEFAULT_DUPLICATE_WINDOW_MS,
  );
  const duplicateWindowStart = collectionTimestamp - duplicateWindowMs;
  const duplicateWindowEnd = collectionTimestamp + duplicateWindowMs;

  // The caller historically supplied the provider reference timestamp as
  // record.timestamp. Preserve that provenance instead of using it as the
  // Daily Monitor cadence timestamp.
  const providerObservationTime = record.observationTime ?? record.timestamp;
  const retrievedTime = record.retrievedTime ?? collectionTimestamp;

  const result = await db.runAsync(
    `INSERT INTO daily_weather
       (timestamp, latitude, longitude, temperature, humidity, pressure,
        windSpeed, windDirection, windGust, dewPoint, precipitation,
        weatherCondition, nwsAlerts, utcOffsetSeconds, weatherTimezone,
        provider, product, stationId, gridId, observationTime, retrievedTime,
        confidence, completeness)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1
       FROM daily_weather
       WHERE timestamp BETWEEN ? AND ?
       LIMIT 1
     )`,
    [
      collectionTimestamp,
      record.latitude,
      record.longitude,
      record.temperature,
      record.humidity,
      record.pressure,
      record.windSpeed,
      record.windDirection,
      record.windGust,
      record.dewPoint,
      record.precipitation,
      record.weatherCondition,
      record.nwsAlerts,
      record.utcOffsetSeconds ?? null,
      record.weatherTimezone ?? null,
      record.provider ?? null,
      record.product ?? null,
      record.stationId ?? null,
      record.gridId ?? null,
      providerObservationTime,
      retrievedTime,
      record.confidence ?? null,
      record.completeness ?? null,
      duplicateWindowStart,
      duplicateWindowEnd,
    ],
  );

  if (result.changes > 0) {
    return {
      rowId: Number(result.lastInsertRowId),
      inserted: true,
      collectionTimestamp,
    };
  }

  const existing = await db.getFirstAsync<{ id: number; timestamp: number }>(
    `SELECT id, timestamp
     FROM daily_weather
     WHERE timestamp BETWEEN ? AND ?
     ORDER BY ABS(timestamp - ?) ASC, id ASC
     LIMIT 1`,
    [duplicateWindowStart, duplicateWindowEnd, collectionTimestamp],
  );
  if (!existing) {
    throw new Error(
      `Daily collection near ${collectionTimestamp} was not inserted and no near-duplicate row was found`,
    );
  }
  return {
    rowId: existing.id,
    inserted: false,
    collectionTimestamp: existing.timestamp,
  };
}
