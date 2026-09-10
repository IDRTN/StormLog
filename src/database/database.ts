import * as SQLite from 'expo-sqlite';
import { CURRENT_SCHEMA_VERSION } from './schema';

const DB_NAME = 'stormlog.db';
const CURRENT_VERSION = CURRENT_SCHEMA_VERSION;

let db: SQLite.SQLiteDatabase | null = null;
let dbInitialization: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  if (dbInitialization) return dbInitialization;

  dbInitialization = (async () => {
    const opened = await SQLite.openDatabaseAsync(DB_NAME);
    try {
      await migrateDatabase(opened);
      db = opened;
      return opened;
    } catch (error) {
      try { await opened.closeAsync(); } catch {}
      throw error;
    } finally {
      dbInitialization = null;
    }
  })();
  return dbInitialization;
}

async function addMissingColumns(
  database: SQLite.SQLiteDatabase,
  table: string,
  columns: [string, string][],
): Promise<void> {
  const existing = new Set(
    (await database.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`)).map((column) => column.name),
  );
  for (const [column, type] of columns) {
    if (!existing.has(column)) await database.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

async function migrateDatabase(database: SQLite.SQLiteDatabase): Promise<void> {
  const result = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = result?.user_version ?? 0;

  if (version < 1) {
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS storm_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        startTime INTEGER NOT NULL,
        endTime INTEGER,
        startLatitude REAL NOT NULL,
        startLongitude REAL NOT NULL,
        endLatitude REAL,
        endLongitude REAL,
        eventName TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS weather_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        temperature REAL,
        humidity REAL,
        pressure REAL,
        windSpeed REAL,
        windDirection REAL,
        windGust REAL,
        dewPoint REAL,
        precipitation REAL,
        weatherCondition TEXT,
        stormEventId INTEGER NOT NULL,
        FOREIGN KEY (stormEventId) REFERENCES storm_events(id) ON DELETE CASCADE
      );
    `);
  }

  if (version < 2) {
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS daily_weather (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        temperature REAL,
        humidity REAL,
        pressure REAL,
        windSpeed REAL,
        windDirection REAL,
        windGust REAL,
        dewPoint REAL,
        precipitation REAL,
        weatherCondition TEXT,
        nwsAlerts TEXT,
        utcOffsetSeconds INTEGER,
        weatherTimezone TEXT,
        provider TEXT,
        product TEXT,
        stationId TEXT,
        gridId TEXT,
        observationTime INTEGER,
        retrievedTime INTEGER,
        confidence REAL,
        completeness REAL
      );
      CREATE INDEX IF NOT EXISTS idx_daily_weather_timestamp ON daily_weather(timestamp);
    `);
  }

  if (version < 3) {
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS analysis_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stormEventId INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        tornadoPossibilityLevel TEXT NOT NULL DEFAULT 'LOW',
        rotationSignal TEXT NOT NULL DEFAULT 'NONE',
        convergence TEXT NOT NULL DEFAULT 'LOW',
        windShear TEXT NOT NULL DEFAULT 'NONE',
        pressureTrend TEXT NOT NULL DEFAULT 'STABLE',
        windDirectionChange REAL,
        lightningTrend TEXT NOT NULL DEFAULT 'NONE',
        availableObservationCount INTEGER NOT NULL DEFAULT 0,
        confidence INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (stormEventId) REFERENCES storm_events(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_analysis_snapshots_event ON analysis_snapshots(stormEventId, timestamp);
    `);
  }

  if (version < 4) {
    await addMissingColumns(database, 'daily_weather', [
      ['utcOffsetSeconds', 'INTEGER'],
      ['weatherTimezone', 'TEXT'],
    ]);
  }

  if (version < 5) {
    await addMissingColumns(database, 'daily_weather', [
      ['provider', 'TEXT'], ['product', 'TEXT'], ['stationId', 'TEXT'], ['gridId', 'TEXT'],
      ['observationTime', 'INTEGER'], ['retrievedTime', 'INTEGER'], ['confidence', 'REAL'], ['completeness', 'REAL'],
    ]);
  }

  if (version < 6) {
    await database.withTransactionAsync(async () => {
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS processed_nws_alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nws_alert_id TEXT NOT NULL UNIQUE,
          first_seen_at INTEGER NOT NULL,
          processed_at INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'PROCESSED',
          source TEXT,
          storm_event_id INTEGER,
          FOREIGN KEY (storm_event_id) REFERENCES storm_events(id)
        );
        CREATE INDEX IF NOT EXISTS idx_processed_nws_alerts_processed_at ON processed_nws_alerts(processed_at);
      `);
      await addMissingColumns(database, 'storm_events', [
        ['nws_alert_id', 'TEXT'], ['trigger_source', 'TEXT'], ['is_automatic', 'INTEGER'],
      ]);
      await database.execAsync(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_storm_events_nws_alert_id
          ON storm_events(nws_alert_id) WHERE nws_alert_id IS NOT NULL
      `);
    });
  }

  if (version < 7) {
    await database.withTransactionAsync(async () => {
      await addMissingColumns(database, 'storm_events', [
        ['warning_status', 'TEXT'], ['warning_ends_at', 'INTEGER'], ['current_nws_alert_id', 'TEXT'],
      ]);
      await database.execAsync(`
        CREATE INDEX IF NOT EXISTS idx_storm_events_automatic_warning_end
          ON storm_events(warning_ends_at) WHERE endTime IS NULL AND is_automatic = 1
      `);
    });
  }

  if (version < 8) {
    await database.withTransactionAsync(async () => {
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS lightning_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          stormEventId INTEGER,
          providerName TEXT NOT NULL,
          providerEventId TEXT,
          timestamp INTEGER NOT NULL,
          eventLatitude REAL NOT NULL,
          eventLongitude REAL NOT NULL,
          providerTerminology TEXT NOT NULL,
          classification TEXT,
          polarity TEXT,
          peakCurrentAmperes REAL,
          multiplicity INTEGER,
          sensorCount INTEGER,
          accuracyKm REAL,
          distanceToObserverKm REAL NOT NULL,
          observerLatitude REAL NOT NULL,
          observerLongitude REAL NOT NULL,
          ingestedAt INTEGER NOT NULL,
          rawProviderPayload TEXT,
          FOREIGN KEY (stormEventId) REFERENCES storm_events(id) ON DELETE SET NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_lightning_events_provider_id
          ON lightning_events(providerName, providerEventId) WHERE providerEventId IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_lightning_events_storm ON lightning_events(stormEventId, timestamp);
        CREATE INDEX IF NOT EXISTS idx_lightning_events_timestamp ON lightning_events(timestamp);
      `);
    });
  }

  if (version < 9) {
    await database.withTransactionAsync(async () => {
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS lightning_validation_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          stormEventId INTEGER,
          recordedAtMs INTEGER NOT NULL,
          observerLatitude REAL NOT NULL,
          observerLongitude REAL NOT NULL,
          comparisonRadiusKm REAL NOT NULL,
          timeWindowSinceMs INTEGER NOT NULL,
          timeWindowUntilMs INTEGER NOT NULL,
          independentSourceEventCount INTEGER,
          independentSourceNearestDistanceKm REAL,
          independentSourceRatePerMinute REAL,
          independentSourceTrend TEXT,
          independentSourceTerminology TEXT,
          humanObservationNotes TEXT,
          stormlogEventCount INTEGER NOT NULL,
          stormlogNearestDistanceKm REAL,
          stormlogRatePerMinute REAL NOT NULL,
          stormlogTrend TEXT NOT NULL,
          eventCountDifference INTEGER NOT NULL,
          eventCountPctDifference REAL,
          notes TEXT,
          FOREIGN KEY (stormEventId) REFERENCES storm_events(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_lightning_validation_storm
          ON lightning_validation_records(stormEventId, recordedAtMs);
      `);
    });
  }

  if (version < 10) {
    // v10 separates true local-day accumulation from rolling radar QPE windows.
    // Existing `precipitation` values are preserved for historical compatibility,
    // but new writes only use that column for a true local-day accumulation.
    await database.withTransactionAsync(async () => {
      await addMissingColumns(database, 'daily_weather', [
        ['precipitation1h', 'REAL'],
        ['precipitation3h', 'REAL'],
        ['precipitation6h', 'REAL'],
        ['precipitation12h', 'REAL'],
        ['precipitation24h', 'REAL'],
        ['stationPrecipitation1h', 'REAL'],
        ['precipitationDataKind', 'TEXT'],
        ['precipitationSourceDistanceKm', 'REAL'],
      ]);
    });
  }

  await database.execAsync(`PRAGMA user_version = ${CURRENT_VERSION}`);
}
