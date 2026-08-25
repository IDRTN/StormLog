import type * as SQLite from 'expo-sqlite';
import type { StormEvent } from '../models/types';
import {
  createStormEvent,
  type StormEventWarningMetadata,
} from './stormEvents';

async function getDefaultDatabase() {
  const { getDatabase } = await import('./database');
  return getDatabase();
}

export type StormLogDatabase = Pick<
  SQLite.SQLiteDatabase,
  'runAsync' | 'getFirstAsync' | 'getAllAsync' | 'withTransactionAsync'
>;

export const WARNING_TRIGGER_SOURCE = 'NWS_WARNING';
export const PROCESSED_WARNING_STATUS = 'PROCESSED';
export const PROCESSING_WARNING_STATUS = 'PROCESSING';
export const CREATED_WARNING_STATUS = 'STORM_EVENT_CREATED';
export const UPDATED_WARNING_STATUS = 'STORM_EVENT_UPDATED';
export const CANCELED_WARNING_STATUS = 'STORM_EVENT_CANCELED';
export const EXPIRED_WARNING_STATUS = 'STORM_EVENT_EXPIRED';

export const WARNING_EVENT_STATUS_ACTIVE = 'ACTIVE';
export const WARNING_EVENT_STATUS_CANCELED = 'CANCELED';
export const WARNING_EVENT_STATUS_EXPIRED = 'EXPIRED';

export interface ProcessedNwsAlertInput {
  nwsAlertId: string;
  firstSeenAt?: number;
  processedAt?: number;
  status?: string;
  source?: string | null;
}

export interface ProcessedNwsAlert {
  id: number;
  nwsAlertId: string;
  firstSeenAt: number;
  processedAt: number;
  status: string;
  source: string | null;
  stormEventId: number | null;
}

export interface WarningLifecycle {
  status?: string | null;
  messageType?: string | null;
  references?: string[];
  endsAt?: number | null;
}

export interface WarningStormEventInput {
  location: { latitude: number; longitude: number } | null;
  warning: {
    nwsAlertId: string;
    event: string;
    triggerSource?: string;
    status?: string | null;
    messageType?: string | null;
    references?: string[];
    endsAt?: number | null;
  };
  eventName?: string;
  nowMs?: number;
}

export type WarningStormEventResult =
  | { outcome: 'created'; eventId: number; processedWarningId: number }
  | { outcome: 'updated_event'; eventId: number; processedWarningId: number }
  | { outcome: 'canceled_event'; eventId: number; processedWarningId: number }
  | { outcome: 'skipped_active_event'; activeEvent: unknown }
  | { outcome: 'skipped_duplicate_alert' }
  | { outcome: 'skipped_missing_location' }
  | { outcome: 'skipped_cancel_without_event' };

type ProcessedNwsAlertRow = Omit<ProcessedNwsAlert, 'stormEventId'> & {
  storm_event_id: number | null;
};

type LifecycleStormEventRow = {
  id: number;
  nws_alert_id: string | null;
  current_nws_alert_id: string | null;
  is_automatic: number | null;
};

function mapProcessedWarning(row: ProcessedNwsAlertRow): ProcessedNwsAlert {
  return {
    id: row.id,
    nwsAlertId: row.nwsAlertId,
    firstSeenAt: row.firstSeenAt,
    processedAt: row.processedAt,
    status: row.status,
    source: row.source ?? null,
    stormEventId: row.storm_event_id ?? null,
  };
}

const PROCESSED_WARNING_SELECT = `
  SELECT
    id,
    nws_alert_id AS nwsAlertId,
    first_seen_at AS firstSeenAt,
    processed_at AS processedAt,
    status,
    source,
    storm_event_id AS storm_event_id
  FROM processed_nws_alerts
`;

function uniqueWarningIds(
  ...values: Array<string | null | undefined>
): string[] {
  return [...new Set(values.filter((value): value is string =>
    typeof value === 'string' && value.trim().length > 0
  ))];
}

async function claimWarning(
  db: StormLogDatabase,
  input: WarningStormEventInput,
  now: number
) {
  return db.runAsync(
    `INSERT INTO processed_nws_alerts (
      nws_alert_id,
      first_seen_at,
      processed_at,
      status,
      source
    ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(nws_alert_id) DO NOTHING`,
    [
      input.warning.nwsAlertId,
      now,
      now,
      PROCESSING_WARNING_STATUS,
      input.warning.triggerSource ?? WARNING_TRIGGER_SOURCE,
    ]
  );
}

async function getRelatedActiveAutomaticWarning(
  db: StormLogDatabase,
  identityIds: string[]
): Promise<LifecycleStormEventRow | null> {
  if (identityIds.length === 0) return null;

  const placeholders = identityIds.map(() => '?').join(', ');
  const rows = await db.getAllAsync<LifecycleStormEventRow>(
    `SELECT
       id,
       nws_alert_id,
       current_nws_alert_id,
       is_automatic
     FROM storm_events
     WHERE endTime IS NULL
       AND is_automatic = 1
       AND (
         nws_alert_id IN (${placeholders})
         OR current_nws_alert_id IN (${placeholders})
       )
     ORDER BY startTime DESC
     LIMIT 1`,
    [...identityIds, ...identityIds]
  );
  return rows[0] ?? null;
}

async function finishProcessedWarning(
  db: StormLogDatabase,
  nwsAlertId: string,
  status: string,
  now: number,
  eventId: number
): Promise<number> {
  await db.runAsync(
    `UPDATE processed_nws_alerts
     SET status = ?, processed_at = ?, storm_event_id = ?
     WHERE nws_alert_id = ?`,
    [status, now, eventId, nwsAlertId]
  );
  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM processed_nws_alerts WHERE nws_alert_id = ?',
    [nwsAlertId]
  );
  if (row == null) throw new Error(`Processed warning disappeared: ${nwsAlertId}`);
  return row.id;
}

async function applyActiveWarningLifecycle(
  db: StormLogDatabase,
  eventId: number,
  currentNwsAlertId: string,
  endsAt: number | null
): Promise<void> {
  const result = await db.runAsync(
    `UPDATE storm_events
     SET current_nws_alert_id = ?, warning_status = ?, warning_ends_at = ?
     WHERE id = ? AND endTime IS NULL AND is_automatic = 1`,
    [
      currentNwsAlertId,
      WARNING_EVENT_STATUS_ACTIVE,
      endsAt,
      eventId,
    ]
  );
  if (result.changes !== 1) {
    throw new Error(`Automatic warning event not available: ${eventId}`);
  }
}

export async function isNwsAlertProcessed(
  nwsAlertId: string,
  database?: StormLogDatabase
): Promise<boolean> {
  const db = database ?? await getDefaultDatabase();
  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM processed_nws_alerts WHERE nws_alert_id = ?',
    [nwsAlertId]
  );
  return row != null;
}

export async function recordProcessedNwsAlert(
  input: ProcessedNwsAlertInput,
  database?: StormLogDatabase
): Promise<{ recorded: boolean; processedWarningId: number | null }> {
  const db = database ?? await getDefaultDatabase();
  const now = Date.now();
  const result = await db.runAsync(
    `INSERT INTO processed_nws_alerts (
      nws_alert_id,
      first_seen_at,
      processed_at,
      status,
      source
    ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(nws_alert_id) DO NOTHING`,
    [
      input.nwsAlertId,
      input.firstSeenAt ?? now,
      input.processedAt ?? now,
      input.status ?? PROCESSED_WARNING_STATUS,
      input.source ?? null,
    ]
  );

  if (result.changes === 0) return { recorded: false, processedWarningId: null };

  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM processed_nws_alerts WHERE nws_alert_id = ?',
    [input.nwsAlertId]
  );
  return { recorded: true, processedWarningId: row?.id ?? null };
}

export async function getProcessedNwsAlert(
  nwsAlertId: string,
  database?: StormLogDatabase
): Promise<ProcessedNwsAlert | null> {
  const db = database ?? await getDefaultDatabase();
  const row = await db.getFirstAsync<ProcessedNwsAlertRow>(
    `${PROCESSED_WARNING_SELECT} WHERE nws_alert_id = ?`,
    [nwsAlertId]
  );
  return row == null ? null : mapProcessedWarning(row);
}

export async function createStormEventForWarning(
  input: WarningStormEventInput,
  database?: StormLogDatabase
): Promise<WarningStormEventResult> {
  const db = database ?? await getDefaultDatabase();
  const now = input.nowMs ?? Date.now();
  const messageType = (input.warning.messageType ?? 'Alert').toUpperCase();
  const referenceIds = input.warning.references ?? [];
  let result: WarningStormEventResult;

  await db.withTransactionAsync(async () => {
    const claim = await claimWarning(db, input, now);
    if (claim.changes === 0) {
      result = { outcome: 'skipped_duplicate_alert' };
      return;
    }

    const relatedEvent = await getRelatedActiveAutomaticWarning(
      db,
      uniqueWarningIds(input.warning.nwsAlertId, ...referenceIds)
    );

    if (messageType === 'CANCEL') {
      if (relatedEvent == null) {
        result = { outcome: 'skipped_cancel_without_event' };
        return;
      }

      const closeResult = await db.runAsync(
        `UPDATE storm_events
         SET endTime = ?, warning_status = ?
         WHERE id = ? AND endTime IS NULL AND is_automatic = 1`,
        [now, WARNING_EVENT_STATUS_CANCELED, relatedEvent.id]
      );
      if (closeResult.changes !== 1) {
        throw new Error(`Automatic warning could not be canceled: ${relatedEvent.id}`);
      }

      const processedWarningId = await finishProcessedWarning(
        db,
        input.warning.nwsAlertId,
        CANCELED_WARNING_STATUS,
        now,
        relatedEvent.id
      );
      result = {
        outcome: 'canceled_event',
        eventId: relatedEvent.id,
        processedWarningId,
      };
      return;
    }

    if (relatedEvent != null && messageType === 'UPDATE') {
      await applyActiveWarningLifecycle(
        db,
        relatedEvent.id,
        input.warning.nwsAlertId,
        input.warning.endsAt ?? null
      );
      const processedWarningId = await finishProcessedWarning(
        db,
        input.warning.nwsAlertId,
        UPDATED_WARNING_STATUS,
        now,
        relatedEvent.id
      );
      result = {
        outcome: 'updated_event',
        eventId: relatedEvent.id,
        processedWarningId,
      };
      return;
    }

    const location = input.location;
    if (
      location == null ||
      !Number.isFinite(location.latitude) ||
      !Number.isFinite(location.longitude)
    ) {
      result = { outcome: 'skipped_missing_location' };
      return;
    }

    const activeRows = await db.getAllAsync<StormEvent>(
      `SELECT * FROM storm_events WHERE endTime IS NULL ORDER BY startTime DESC LIMIT 1`
    );
    if (activeRows.length > 0) {
      result = { outcome: 'skipped_active_event', activeEvent: activeRows[0] };
      return;
    }

    const metadata: StormEventWarningMetadata = {
      nwsAlertId: input.warning.nwsAlertId,
      triggerSource: input.warning.triggerSource ?? WARNING_TRIGGER_SOURCE,
      isAutomatic: true,
    };
    const eventId = await createStormEvent(
      location.latitude,
      location.longitude,
      input.eventName || `Automatic ${input.warning.event}`,
      metadata,
      db
    );

    await applyActiveWarningLifecycle(
      db,
      eventId,
      input.warning.nwsAlertId,
      input.warning.endsAt ?? null
    );
    const processedWarningId = await finishProcessedWarning(
      db,
      input.warning.nwsAlertId,
      CREATED_WARNING_STATUS,
      now,
      eventId
    );
    result = {
      outcome: 'created',
      eventId,
      processedWarningId,
    };
  });

  return result!;
}

export async function expireDueAutomaticWarnings(
  nowMs: number = Date.now(),
  database?: StormLogDatabase
): Promise<number> {
  const db = database ?? await getDefaultDatabase();
  let expiredCount = 0;

  await db.withTransactionAsync(async () => {
    const dueEvents = await db.getAllAsync<{ id: number }>(
      `SELECT id
       FROM storm_events
       WHERE endTime IS NULL
         AND is_automatic = 1
         AND warning_ends_at IS NOT NULL
         AND warning_ends_at <= ?
       ORDER BY warning_ends_at ASC`,
      [nowMs]
    );

    for (const event of dueEvents) {
      const result = await db.runAsync(
        `UPDATE storm_events
         SET endTime = warning_ends_at, warning_status = ?
         WHERE id = ? AND endTime IS NULL AND is_automatic = 1`,
        [WARNING_EVENT_STATUS_EXPIRED, event.id]
      );
      if (result.changes !== 1) {
        throw new Error(`Automatic warning could not be expired: ${event.id}`);
      }

      await db.runAsync(
        `UPDATE processed_nws_alerts
         SET status = ?
         WHERE storm_event_id = ?
           AND status IN (?, ?)`,
        [
          EXPIRED_WARNING_STATUS,
          event.id,
          CREATED_WARNING_STATUS,
          UPDATED_WARNING_STATUS,
        ]
      );
      expiredCount += 1;
    }
  });

  return expiredCount;
}
