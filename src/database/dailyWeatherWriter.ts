import { getDatabase } from './database';
import type { DailyWeatherRecord } from '../models/types';

export type DailyWeatherWriteResult = { rowId: number; inserted: boolean };
const AUTO_STORM_SEED_LOOKBACK_MS = 20 * 60 * 1000;

async function ensureAutomaticStormObservationBridge(db: Awaited<ReturnType<typeof getDatabase>>): Promise<void> {
  // Recreate the v1 triggers because precipitation semantics changed in schema v10:
  // storm-event observations should carry the best recent one-hour amount, not
  // a local-day cumulative total.
  await db.execAsync(`
    DROP TRIGGER IF EXISTS trg_daily_weather_to_auto_storm_v1;
    DROP TRIGGER IF EXISTS trg_auto_storm_seed_daily_weather_v1;

    CREATE TRIGGER IF NOT EXISTS trg_daily_weather_to_auto_storm_v2
    AFTER INSERT ON daily_weather
    BEGIN
      INSERT INTO weather_observations
        (timestamp, latitude, longitude, temperature, humidity, pressure,
         windSpeed, windDirection, windGust, dewPoint, precipitation,
         weatherCondition, stormEventId)
      SELECT
        NEW.timestamp, NEW.latitude, NEW.longitude, NEW.temperature,
        NEW.humidity, NEW.pressure, NEW.windSpeed, NEW.windDirection,
        NEW.windGust, NEW.dewPoint,
        COALESCE(NEW.precipitation1h, NEW.stationPrecipitation1h, NEW.precipitation),
        NEW.weatherCondition, active.id
      FROM (
        SELECT id FROM storm_events
        WHERE endTime IS NULL AND is_automatic = 1
        ORDER BY startTime DESC LIMIT 1
      ) AS active
      WHERE NOT EXISTS (
        SELECT 1 FROM weather_observations existing
        WHERE existing.stormEventId = active.id AND existing.timestamp = NEW.timestamp
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_auto_storm_seed_daily_weather_v2
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
        latest.windGust, latest.dewPoint,
        COALESCE(latest.precipitation1h, latest.stationPrecipitation1h, latest.precipitation),
        latest.weatherCondition, NEW.id
      FROM (
        SELECT * FROM daily_weather
        WHERE timestamp >= NEW.startTime - ${AUTO_STORM_SEED_LOOKBACK_MS}
          AND timestamp <= NEW.startTime
        ORDER BY timestamp DESC LIMIT 1
      ) AS latest
      WHERE NOT EXISTS (
        SELECT 1 FROM weather_observations existing WHERE existing.stormEventId = NEW.id
      );
    END;
  `);
}

export async function insertDailyRecordIdempotent(
  record: Omit<DailyWeatherRecord, 'id'> & { utcOffsetSeconds?: number; weatherTimezone?: string },
): Promise<DailyWeatherWriteResult> {
  const db = await getDatabase();
  await ensureAutomaticStormObservationBridge(db);

  const result = await db.runAsync(
    `INSERT INTO daily_weather
       (timestamp, latitude, longitude, temperature, humidity, pressure,
        windSpeed, windDirection, windGust, dewPoint, precipitation,
        precipitation1h, precipitation3h, precipitation6h, precipitation12h, precipitation24h,
        stationPrecipitation1h, precipitationDataKind, precipitationSourceDistanceKm,
        weatherCondition, nwsAlerts, utcOffsetSeconds, weatherTimezone,
        provider, product, stationId, gridId, observationTime, retrievedTime,
        confidence, completeness)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM daily_weather WHERE timestamp = ? LIMIT 1)`,
    [
      record.timestamp, record.latitude, record.longitude, record.temperature, record.humidity,
      record.pressure, record.windSpeed, record.windDirection, record.windGust, record.dewPoint,
      record.precipitation, record.precipitation1h ?? null, record.precipitation3h ?? null,
      record.precipitation6h ?? null, record.precipitation12h ?? null, record.precipitation24h ?? null,
      record.stationPrecipitation1h ?? null, record.precipitationDataKind ?? null,
      record.precipitationSourceDistanceKm ?? null, record.weatherCondition, record.nwsAlerts,
      record.utcOffsetSeconds ?? null, record.weatherTimezone ?? null, record.provider ?? null,
      record.product ?? null, record.stationId ?? null, record.gridId ?? null,
      record.observationTime ?? null, record.retrievedTime ?? null, record.confidence ?? null,
      record.completeness ?? null, record.timestamp,
    ],
  );

  if (result.changes > 0) return { rowId: Number(result.lastInsertRowId), inserted: true };
  const existing = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM daily_weather WHERE timestamp = ? ORDER BY id ASC LIMIT 1', [record.timestamp],
  );
  if (!existing) throw new Error(`Daily observation ${record.timestamp} was not inserted and no existing row was found`);
  return { rowId: existing.id, inserted: false };
}
