import { getDatabase } from './database';
import { getLocalDateString, getLocalDayStart, getLocalDayEnd, formatLocalDateTime } from '../util/dateUtils';

/**
 * Calculate epoch ms boundaries for a calendar date using the WEATHER
 * LOCATION's UTC offset (not the device timezone).
 *
 * When utcOffsetSeconds is provided, boundaries are shifted so that
 * records stored with UTC timestamps are correctly grouped by the
 * weather location's local calendar date.
 */
function getWeatherLocalDayBounds(dateString: string, utcOffsetSeconds?: number): {
  start: number;
  end: number;
} {
  if (utcOffsetSeconds == null) {
    // Fall back to device timezone (backward compatible)
    return { start: getLocalDayStart(dateString), end: getLocalDayEnd(dateString) };
  }

  // Parse as UTC midnight of that date
  const utcMidnight = Date.parse(`${dateString}T00:00:00Z`);
  // The weather-local midnight in UTC terms:
  // local midnight = UTC midnight - offset (because local = UTC + offset)
  const start = utcMidnight - utcOffsetSeconds * 1000;
  const end = start + 86400000;
  return { start, end };
}
import type { DailyWeatherRecord, DailySummary } from '../models/types';

export async function insertDailyRecord(
  record: Omit<DailyWeatherRecord, 'id'> & { utcOffsetSeconds?: number; weatherTimezone?: string }
): Promise<number> {
  const db = await getDatabase();
  const obsDate = getLocalDateString(new Date(record.timestamp));
  console.log(
    `[DAILY-DB] Insert — timestamp: ${formatLocalDateTime(new Date(record.timestamp))}, ` +
    `local date: ${obsDate}, precip: ${record.precipitation}", ` +
    `tz: ${record.weatherTimezone ?? 'unknown'} (${record.utcOffsetSeconds ?? '?'}s)`
  );

  const result = await db.runAsync(
    `INSERT INTO daily_weather
	     (timestamp, latitude, longitude, temperature, humidity, pressure,
	      windSpeed, windDirection, windGust, dewPoint, precipitation,
	      weatherCondition, nwsAlerts, utcOffsetSeconds, weatherTimezone,
	      provider, product, stationId, gridId, observationTime, retrievedTime,
	      confidence, completeness)
	     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
	    ]
  );
  console.log(`[DAILY-DB] Inserted row ${result.lastInsertRowId} for date ${obsDate}`);
  return result.lastInsertRowId;
}

export async function getDailyRecordsForDate(
  dateString: string,
  utcOffsetSeconds?: number
): Promise<DailyWeatherRecord[]> {
  const { start, end } = getWeatherLocalDayBounds(dateString, utcOffsetSeconds);
  const db = await getDatabase();
  console.log(
    `[DAILY-DB] Query date ${dateString}: ` +
    `start=${new Date(start).toISOString()}, end=${new Date(end).toISOString()}`
  );
  return await db.getAllAsync<DailyWeatherRecord>(
    'SELECT * FROM daily_weather WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp ASC',
    [start, end]
  );
}

/**
 * Read every Daily Monitor observation in chronological order for export.
 * This is intentionally read-only and does not participate in monitor
 * scheduling or collection ownership.
 */
export async function getAllDailyRecords(): Promise<DailyWeatherRecord[]> {
  const db = await getDatabase();
  return await db.getAllAsync<DailyWeatherRecord>(
    'SELECT * FROM daily_weather ORDER BY timestamp ASC'
  );
}

export async function getDailySummary(dateString: string, utcOffsetSeconds?: number): Promise<DailySummary> {
  const records = await getDailyRecordsForDate(dateString, utcOffsetSeconds);

  if (records.length === 0) {
    return {
      date: dateString,
      highTemp: null,
      lowTemp: null,
      avgTemp: null,
      maxWind: null,
      maxGust: null,
      avgHumidity: null,
      minPressure: null,
      maxPressure: null,
      totalPrecip: null,
      observationCount: 0,
      alertCount: 0,
      alertTypes: [],
    };
  }

  const temps = records.map((r) => r.temperature).filter((v): v is number => v != null);
  const winds = records.map((r) => r.windSpeed).filter((v): v is number => v != null);
  const gusts = records.map((r) => r.windGust).filter((v): v is number => v != null);
  const humidities = records.map((r) => r.humidity).filter((v): v is number => v != null);
  const pressures = records.map((r) => r.pressure).filter((v): v is number => v != null);

  // Each record stores the OBSERVED accumulated precipitation from local
  // midnight through the current hour (summed from hourly API data).
  // Later observations in the day have higher or equal cumulative totals.
  // MAX() picks the most recent/complete accumulation for the day.
  const precipValues = records.map((r) => r.precipitation).filter((v): v is number => v != null);
  // MAX() gives the most complete cumulative total for the day.
  // Each observation stores the running total from midnight to that point.
  // If we have observations but all show 0, the day genuinely had no rain.
  const totalPrecip = precipValues.length > 0 ? Math.max(...precipValues) : null;
  console.log(
    `[DAILY-DB] Summary for ${dateString}: ` +
    `${records.length} obs, precip values: [${precipValues.map(v => v.toFixed(2)).join(', ')}] → max: ${totalPrecip?.toFixed(2) ?? 'null'}"`
  );

  // Aggregate NWS alerts
  const alertSet = new Set<string>();
  let alertCount = 0;
  const alertTypes: string[] = [];
  for (const r of records) {
    if (r.nwsAlerts) {
      try {
        const alerts = JSON.parse(r.nwsAlerts) as string[];
        for (const a of alerts) {
          if (!alertSet.has(a)) {
            alertSet.add(a);
            alertTypes.push(a);
          }
        }
        alertCount += alerts.length;
      } catch {}
    }
  }

  return {
    date: dateString,
    highTemp: temps.length > 0 ? Math.max(...temps) : null,
    lowTemp: temps.length > 0 ? Math.min(...temps) : null,
    avgTemp: temps.length > 0 ? Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10 : null,
    maxWind: winds.length > 0 ? Math.max(...winds) : null,
    maxGust: gusts.length > 0 ? Math.max(...gusts) : null,
    avgHumidity: humidities.length > 0 ? Math.round(humidities.reduce((a, b) => a + b, 0) / humidities.length) : null,
    minPressure: pressures.length > 0 ? Math.min(...pressures) : null,
    maxPressure: pressures.length > 0 ? Math.max(...pressures) : null,
    totalPrecip: totalPrecip != null ? Math.round(totalPrecip * 100) / 100 : null,
    observationCount: records.length,
    alertCount,
    alertTypes,
  };
}

export async function getAvailableDates(utcOffsetSeconds?: number): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ ts: number }>(
    'SELECT DISTINCT timestamp as ts FROM daily_weather ORDER BY timestamp DESC'
  );

  const offset = utcOffsetSeconds ?? -(new Date().getTimezoneOffset() * 60);
  const dateSet = new Set<string>();

  for (const row of rows) {
    const localMs = row.ts + offset * 1000;
    const d = new Date(localMs);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    dateSet.add(`${year}-${month}-${day}`);
  }

  return Array.from(dateSet).sort().reverse();
}

export interface WeatherLocalDayReference {
  dateString: string;
  utcOffsetSeconds: number;
}

/**
 * Build weather-local day references from the offset persisted with each
 * observation. The latest observation wins when a date has multiple rows.
 * Rows recorded before timezone context existed are omitted rather than
 * assigned a guessed timezone.
 */
export async function getWeatherLocalDayReferences(): Promise<WeatherLocalDayReference[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ timestamp: number; utcOffsetSeconds: number | null }>(
    `SELECT timestamp, utcOffsetSeconds FROM daily_weather
     WHERE utcOffsetSeconds IS NOT NULL ORDER BY timestamp DESC`
  );
  const dayReferences = new Map<string, number>();

  for (const row of rows) {
    if (row.utcOffsetSeconds == null) continue;
    const localMs = row.timestamp + row.utcOffsetSeconds * 1000;
    const localDate = new Date(localMs);
    const year = localDate.getUTCFullYear();
    const month = String(localDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(localDate.getUTCDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;
    if (!dayReferences.has(dateString)) {
      dayReferences.set(dateString, row.utcOffsetSeconds);
    }
  }

  return Array.from(dayReferences.entries())
    .map(([dateString, utcOffsetSeconds]) => ({ dateString, utcOffsetSeconds }))
    .sort((a, b) => b.dateString.localeCompare(a.dateString));
}

export async function getLatestUtcOffsetForWeatherLocalDay(
  dateString: string
): Promise<number | undefined> {
  const dayReferences = await getWeatherLocalDayReferences();
  return dayReferences.find((reference) => reference.dateString === dateString)?.utcOffsetSeconds;
}

export async function getDailyRecordCount(): Promise<number> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM daily_weather'
  );
  return result?.count ?? 0;
}

export async function getDailyRecordCountForDate(dateString: string, utcOffsetSeconds?: number): Promise<number> {
  const { start, end } = getWeatherLocalDayBounds(dateString, utcOffsetSeconds);
  const db = await getDatabase();
  const result = await db.getFirstSync<{ count: number }>(
    'SELECT COUNT(*) as count FROM daily_weather WHERE timestamp >= ? AND timestamp < ?',
    [start, end]
  );
  return result?.count ?? 0;
}

export async function deleteDailyRecordsForDate(dateString: string, utcOffsetSeconds?: number): Promise<number> {
  const { start, end } = getWeatherLocalDayBounds(dateString, utcOffsetSeconds);
  const db = await getDatabase();
  const result = await db.runAsync(
    'DELETE FROM daily_weather WHERE timestamp >= ? AND timestamp < ?',
    [start, end]
  );
  return result.changes;
}

export async function deleteAllDailyRecords(): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync('DELETE FROM daily_weather');
  return result.changes;
}
