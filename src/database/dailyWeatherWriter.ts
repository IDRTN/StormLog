import { getDatabase } from './database';
import type { DailyWeatherRecord } from '../models/types';

export type DailyWeatherWriteResult = {
  rowId: number;
  inserted: boolean;
};

/**
 * Atomically persist one provider observation timestamp.
 *
 * Daily Monitor has multiple recovery paths (native alarm + BackgroundFetch).
 * They are intentionally allowed to race for recovery, but the database must
 * never contain two copies of the same provider observation. A single
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
