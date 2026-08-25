import type * as SQLite from 'expo-sqlite';
import type { StormEvent } from '../models/types';

async function getDefaultDatabase() {
  const { getDatabase } = await import('./database');
  return getDatabase();
}

export interface StormEventWithWarningMetadata extends StormEvent {
  nwsAlertId: string | null;
  triggerSource: string | null;
  isAutomatic: boolean | null;
  warningStatus: string | null;
  warningEndsAt: number | null;
  currentNwsAlertId: string | null;
}

export interface StormEventWarningMetadata {
  nwsAlertId: string;
  triggerSource: string;
  isAutomatic: boolean;
}

type StormEventRow = Omit<
  StormEventWithWarningMetadata,
  'isAutomatic' | 'warningStatus' | 'warningEndsAt' | 'currentNwsAlertId'
> & {
  isAutomatic?: number | null;
  warning_status?: string | null;
  warning_ends_at?: number | null;
  current_nws_alert_id?: string | null;
};

const STORM_EVENT_SELECT = `
  SELECT
    id,
    startTime,
    endTime,
    startLatitude,
    startLongitude,
    endLatitude,
    endLongitude,
    eventName,
    notes,
    nws_alert_id AS nwsAlertId,
    trigger_source AS triggerSource,
    is_automatic AS isAutomatic,
    warning_status AS warningStatus,
    warning_ends_at AS warningEndsAt,
    current_nws_alert_id AS currentNwsAlertId
  FROM storm_events
`;

function mapStormEvent(row: StormEventRow): StormEventWithWarningMetadata {
  return {
    ...row,
    nwsAlertId: row.nwsAlertId ?? null,
    triggerSource: row.triggerSource ?? null,
    isAutomatic: row.isAutomatic == null ? null : row.isAutomatic === 1,
    warningStatus: row.warning_status ?? null,
    warningEndsAt: row.warning_ends_at ?? null,
    currentNwsAlertId: row.current_nws_alert_id ?? null,
  };
}

export async function createStormEvent(
  startLatitude: number,
  startLongitude: number,
  eventName?: string,
  warningMetadata?: StormEventWarningMetadata,
  database?: Pick<SQLite.SQLiteDatabase, 'runAsync'>
): Promise<number> {
  if (database) return createWithDatabase(database, startLatitude, startLongitude, eventName, warningMetadata);
  const { getDatabase } = await import('./database');
  return createWithDatabase(await getDefaultDatabase(), startLatitude, startLongitude, eventName, warningMetadata);
}

async function createWithDatabase(
  db: Pick<SQLite.SQLiteDatabase, 'runAsync'>,
  startLatitude: number,
  startLongitude: number,
  eventName?: string,
  warningMetadata?: StormEventWarningMetadata
): Promise<number> {
  const now = Date.now();
  const name = eventName || `Storm ${new Date(now).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const result = await db.runAsync(
    `INSERT INTO storm_events (
      startTime,
      startLatitude,
      startLongitude,
      eventName,
      nws_alert_id,
      trigger_source,
      is_automatic
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      now,
      startLatitude,
      startLongitude,
      name,
      warningMetadata?.nwsAlertId ?? null,
      warningMetadata?.triggerSource ?? null,
      warningMetadata?.isAutomatic == null ? null : warningMetadata.isAutomatic ? 1 : 0,
    ]
  );
  return result.lastInsertRowId;
}

export async function endStormEvent(
  eventId: number,
  endLatitude: number | null,
  endLongitude: number | null
): Promise<void> {
  const db = await getDefaultDatabase();
  await db.runAsync(
    'UPDATE storm_events SET endTime = ?, endLatitude = ?, endLongitude = ? WHERE id = ?',
    [Date.now(), endLatitude, endLongitude, eventId]
  );
}

export async function getAllStormEvents(
  database?: Pick<SQLite.SQLiteDatabase, 'getAllAsync'>
): Promise<StormEventWithWarningMetadata[]> {
  if (!database) {
    const { getDatabase } = await import('./database');
    database = await getDefaultDatabase();
  }
  const db = database;
  const rows = await db.getAllAsync<StormEventRow>(
    `${STORM_EVENT_SELECT} ORDER BY startTime DESC`
  );
  return rows.map(mapStormEvent);
}

export async function getStormEventById(id: number): Promise<StormEventWithWarningMetadata | null> {
  const db = await getDefaultDatabase();
  const results = await db.getAllAsync<StormEventRow>(
    `${STORM_EVENT_SELECT} WHERE id = ?`,
    [id]
  );
  return results.length > 0 ? mapStormEvent(results[0]) : null;
}

export async function getActiveStormEvent(): Promise<StormEventWithWarningMetadata | null> {
  const db = await getDefaultDatabase();
  const results = await db.getAllAsync<StormEventRow>(
    `${STORM_EVENT_SELECT} WHERE endTime IS NULL ORDER BY startTime DESC LIMIT 1`
  );
  return results.length > 0 ? mapStormEvent(results[0]) : null;
}

export async function getActiveAutomaticStormEvent(): Promise<StormEventWithWarningMetadata | null> {
  const db = await getDefaultDatabase();
  const results = await db.getAllAsync<StormEventRow>(
    `${STORM_EVENT_SELECT} WHERE endTime IS NULL AND is_automatic = 1 ORDER BY startTime DESC LIMIT 1`
  );
  return results.length > 0 ? mapStormEvent(results[0]) : null;
}

export async function getActiveManualStormEvent(): Promise<StormEventWithWarningMetadata | null> {
  const db = await getDefaultDatabase();
  const results = await db.getAllAsync<StormEventRow>(
    `${STORM_EVENT_SELECT}
     WHERE endTime IS NULL AND (is_automatic IS NULL OR is_automatic <> 1)
     ORDER BY startTime DESC LIMIT 1`
  );
  return results.length > 0 ? mapStormEvent(results[0]) : null;
}

export async function hasActiveStormEvent(): Promise<boolean> {
  return (await getActiveStormEvent()) != null;
}

export async function deleteStormEvent(id: number): Promise<void> {
  const db = await getDefaultDatabase();
  await db.runAsync('DELETE FROM storm_events WHERE id = ?', [id]);
}
