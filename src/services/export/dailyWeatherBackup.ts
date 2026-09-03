import type { DailyWeatherRecord } from '../../models/types';

export const DAILY_WEATHER_BACKUP_FORMAT = 'stormlog-daily-weather-backup';
export const DAILY_WEATHER_BACKUP_VERSION = 1;

export interface DailyWeatherBackup {
  format: typeof DAILY_WEATHER_BACKUP_FORMAT;
  version: typeof DAILY_WEATHER_BACKUP_VERSION;
  exportedAt: string;
  recordCount: number;
  records: DailyWeatherRecord[];
}

/**
 * Build a portable, versioned backup payload without mutating the database.
 * Keeping the format explicit makes a future restore/import path possible
 * without tying backups to the internal SQLite file layout.
 */
export function buildDailyWeatherBackup(
  records: DailyWeatherRecord[],
  exportedAtMs: number = Date.now(),
): DailyWeatherBackup {
  return {
    format: DAILY_WEATHER_BACKUP_FORMAT,
    version: DAILY_WEATHER_BACKUP_VERSION,
    exportedAt: new Date(exportedAtMs).toISOString(),
    recordCount: records.length,
    records,
  };
}

export function serializeDailyWeatherBackup(
  records: DailyWeatherRecord[],
  exportedAtMs: number = Date.now(),
): string {
  return JSON.stringify(buildDailyWeatherBackup(records, exportedAtMs), null, 2);
}
