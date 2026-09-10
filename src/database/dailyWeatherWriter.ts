import { getDatabase } from './database';
import type { DailyWeatherRecord } from '../models/types';

export type DailyWeatherWriteResult = {
  rowId: number;
  inserted: boolean;
};

const AUTO_STORM_SEED_LOOKBACK_MS = 20 * 60 * 1000;

/**
 * Keep automatic storm weather observations tied to the reliable Daily Monitor
 * persistence path instead of starting a second React timer.
 *
 * Trigger 1 mirrors every new Daily Monitor row into the newest active automatic
 * storm event. Trigger 2 handles the opposite ordering: lightning can create an
 * automatic event after the Daily Monitor row has already been written in the
 * same cycle, so a newly-created automatic event is seeded from the newest Daily
 * Monitor observation from the preceding 20 minutes.
 *
 * Both triggers are idempotent. Manual storm events are intentionally excluded;
 * their observations remain owned by useStormLogger.
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
          AND timestamp <= NEW.startTime
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
 * Atomically persist one Daily Monitor observation timestamp.
 *
 * Daily Monitor has multiple recovery paths (native alarm + BackgroundFetch).
 * They are intentionally allowed to race for recovery, but the database must
 * never contain two copies of the same observation. A single
 * INSERT..SELECT..WHERE NOT EXISTS statement makes that invariant live at the
 * persistence boundary instead of relying only on timing gates in JavaScript.
 */
export async function insertDailyRecordIdempotent(
  record: Omit<DailyWeatherRecord, 'id'> & {
    utcOffsetSeconds?: number;
    weatherTimezone?: string;
  },
): Promise<DailyWeatherWriteResult> {
  const db = await getDatabase();
  await ensureAutomaticStormObservationBridge(db);

  const result = await db.runAsync(
    `INSERT INTO daily_weather
       (timestamp, latitude, longitude, temperature, humidity, pressure,
        windSpeed, windDirection, windGust, dewPoint, precipitation,
        weatherCondition, nwsAlerts, utcOffsetSeconds, weatherTimezone,
        provider, product, stationId, gridId, observationTime, retrievedTime,
        confidence, completeness)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM daily_weather WHERE timestamp = ? LIMIT 1
     )`,
    [
      record.timestamp,
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
      record.observationTime ?? null,
      record.retrievedTime ?? null,
      record.confidence ?? null,
      record.completeness ?? null,
      record.timestamp,
    ],
  );

  if (result.changes > 0) {
    return { rowId: Number(result.lastInsertRowId), inserted: true };
  }

  const existing = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM daily_weather WHERE timestamp = ? ORDER BY id ASC LIMIT 1',
    [record.timestamp],
  );
  if (!existing) {
    throw new Error(`Daily observation ${record.timestamp} was not inserted and no existing row was found`);
  }
  return { rowId: existing.id, inserted: false };
}
