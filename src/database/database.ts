import * as SQLite from 'expo-sqlite';

const DB_NAME = 'stormlog.db';
const CURRENT_VERSION = 5;

let db: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync(DB_NAME);
  await migrateDatabase(db);
  return db;
}

async function migrateDatabase(database: SQLite.SQLiteDatabase): Promise<void> {
  const result = await database.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version'
  );
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

      CREATE INDEX IF NOT EXISTS idx_daily_weather_timestamp
        ON daily_weather(timestamp);
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

      CREATE INDEX IF NOT EXISTS idx_analysis_snapshots_event
        ON analysis_snapshots(stormEventId, timestamp);
    `);
  }

  if (version < 4) {
    // Migration v4: Add timezone context columns to daily_weather
    try {
      await database.execAsync(
        'ALTER TABLE daily_weather ADD COLUMN utcOffsetSeconds INTEGER'
      );
    } catch { /* column may already exist */ }
    try {
      await database.execAsync(
        'ALTER TABLE daily_weather ADD COLUMN weatherTimezone TEXT'
      );
    } catch { /* column may already exist */ }
  }

  if (version < 5) {
    const provenanceColumns: [string, string][] = [
      ['provider', 'TEXT'],
      ['product', 'TEXT'],
      ['stationId', 'TEXT'],
      ['gridId', 'TEXT'],
      ['observationTime', 'INTEGER'],
      ['retrievedTime', 'INTEGER'],
      ['confidence', 'REAL'],
      ['completeness', 'REAL'],
    ];
    const existingColumns = new Set(
      (await database.getAllAsync<{ name: string }>('PRAGMA table_info(daily_weather)'))
        .map((column) => column.name)
    );
    for (const [column, type] of provenanceColumns) {
      if (!existingColumns.has(column)) {
        await database.execAsync(`ALTER TABLE daily_weather ADD COLUMN ${column} ${type}`);
      }
    }
  }

  await database.execAsync(`PRAGMA user_version = ${CURRENT_VERSION}`);
}
