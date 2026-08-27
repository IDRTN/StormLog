import { getDatabase } from './database';
import type { LightningEvent } from '../models/types';

// ============================================================
// Lightning Events — Persistence & Query Primitives
//
// Phase 1: Database layer only.
// The coordinator (Phase 2) will supply distanceToObserverKm
// and observer location. This module stores and retrieves.
// ============================================================

export type LightningEventInsert = Omit<LightningEvent, 'id'>;

/**
 * Insert a single lightning event.
 * Uses INSERT OR IGNORE so that duplicate providerEventId pairs
 * are silently skipped (authoritative dedup at the DB level).
 *
 * Returns the inserted row's id, or 0 if the row was a duplicate.
 */
export async function insertLightningEvent(
  event: LightningEventInsert,
): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO lightning_events
     (stormEventId, providerName, providerEventId, timestamp,
      eventLatitude, eventLongitude, providerTerminology,
      classification, polarity, peakCurrentAmperes, multiplicity,
      sensorCount, accuracyKm, distanceToObserverKm,
      observerLatitude, observerLongitude, ingestedAt,
      rawProviderPayload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.stormEventId,
      event.providerName,
      event.providerEventId,
      event.timestamp,
      event.eventLatitude,
      event.eventLongitude,
      event.providerTerminology,
      event.classification,
      event.polarity,
      event.peakCurrentAmperes,
      event.multiplicity,
      event.sensorCount,
      event.accuracyKm,
      event.distanceToObserverKm,
      event.observerLatitude,
      event.observerLongitude,
      event.ingestedAt,
      event.rawProviderPayload,
    ],
  );
  return result.changes > 0 ? result.lastInsertRowId : 0;
}

/**
 * Insert multiple lightning events in a single transaction.
 * Uses INSERT OR IGNORE for deduplication.
 * Returns the count of events actually inserted (excluding duplicates).
 */
export async function insertLightningEvents(
  events: LightningEventInsert[],
): Promise<number> {
  if (events.length === 0) return 0;
  const db = await getDatabase();
  let inserted = 0;
  await db.withTransactionAsync(async () => {
    for (const event of events) {
      const result = await db.runAsync(
        `INSERT OR IGNORE INTO lightning_events
         (stormEventId, providerName, providerEventId, timestamp,
          eventLatitude, eventLongitude, providerTerminology,
          classification, polarity, peakCurrentAmperes, multiplicity,
          sensorCount, accuracyKm, distanceToObserverKm,
          observerLatitude, observerLongitude, ingestedAt,
          rawProviderPayload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.stormEventId,
          event.providerName,
          event.providerEventId,
          event.timestamp,
          event.eventLatitude,
          event.eventLongitude,
          event.providerTerminology,
          event.classification,
          event.polarity,
          event.peakCurrentAmperes,
          event.multiplicity,
          event.sensorCount,
          event.accuracyKm,
          event.distanceToObserverKm,
          event.observerLatitude,
          event.observerLongitude,
          event.ingestedAt,
          event.rawProviderPayload,
        ],
      );
      if (result.changes > 0) inserted++;
    }
  });
  return inserted;
}

/**
 * Query all lightning events for a storm event, ordered by timestamp.
 */
export async function queryLightningEventsByStormEvent(
  stormEventId: number,
): Promise<LightningEvent[]> {
  const db = await getDatabase();
  return await db.getAllAsync<LightningEvent>(
    `SELECT * FROM lightning_events
     WHERE stormEventId = ?
     ORDER BY timestamp ASC`,
    [stormEventId],
  );
}

/**
 * Query lightning events within a time range, optionally filtered by storm event.
 * Useful for rate/trend calculations and time-window queries.
 */
export async function queryLightningEventsByTimeRange(
  sinceMs: number,
  untilMs: number,
  stormEventId?: number,
): Promise<LightningEvent[]> {
  const db = await getDatabase();
  if (stormEventId != null) {
    return await db.getAllAsync<LightningEvent>(
      `SELECT * FROM lightning_events
       WHERE timestamp >= ? AND timestamp <= ? AND stormEventId = ?
       ORDER BY timestamp ASC`,
      [sinceMs, untilMs, stormEventId],
    );
  }
  return await db.getAllAsync<LightningEvent>(
    `SELECT * FROM lightning_events
     WHERE timestamp >= ? AND timestamp <= ?
     ORDER BY timestamp ASC`,
    [sinceMs, untilMs],
  );
}

/**
 * Query lightning events near the observer within a radius.
 * Uses the pre-calculated distanceToObserverKm column.
 * Useful for "nearby lightning" counts and nearest-event queries.
 */
export async function queryLightningEventsNearObserver(
  maxDistanceKm: number,
  stormEventId?: number,
): Promise<LightningEvent[]> {
  const db = await getDatabase();
  if (stormEventId != null) {
    return await db.getAllAsync<LightningEvent>(
      `SELECT * FROM lightning_events
       WHERE distanceToObserverKm <= ? AND stormEventId = ?
       ORDER BY distanceToObserverKm ASC`,
      [maxDistanceKm, stormEventId],
    );
  }
  return await db.getAllAsync<LightningEvent>(
    `SELECT * FROM lightning_events
     WHERE distanceToObserverKm <= ?
     ORDER BY distanceToObserverKm ASC`,
    [maxDistanceKm],
  );
}

/**
 * Count lightning events for a storm event.
 */
export async function countLightningEventsByStormEvent(
  stormEventId: number,
): Promise<number> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM lightning_events WHERE stormEventId = ?`,
    [stormEventId],
  );
  return result?.count ?? 0;
}

/**
 * Count lightning events within a time range, optionally filtered by storm event.
 */
export async function countLightningEventsByTimeRange(
  sinceMs: number,
  untilMs: number,
  stormEventId?: number,
): Promise<number> {
  const db = await getDatabase();
  if (stormEventId != null) {
    const result = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM lightning_events
       WHERE timestamp >= ? AND timestamp <= ? AND stormEventId = ?`,
      [sinceMs, untilMs, stormEventId],
    );
    return result?.count ?? 0;
  }
  const result = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM lightning_events
     WHERE timestamp >= ? AND timestamp <= ?`,
    [sinceMs, untilMs],
  );
  return result?.count ?? 0;
}

/**
 * Find the nearest lightning event to the observer for a storm event.
 * Returns null if no events exist.
 */
export async function findNearestLightningEvent(
  stormEventId: number,
): Promise<LightningEvent | null> {
  const db = await getDatabase();
  const results = await db.getAllAsync<LightningEvent>(
    `SELECT * FROM lightning_events
     WHERE stormEventId = ?
     ORDER BY distanceToObserverKm ASC
     LIMIT 1`,
    [stormEventId],
  );
  return results.length > 0 ? results[0] : null;
}

/**
 * Get the most recent lightning event for a storm event.
 */
export async function getLatestLightningEvent(
  stormEventId: number,
): Promise<LightningEvent | null> {
  const db = await getDatabase();
  const results = await db.getAllAsync<LightningEvent>(
    `SELECT * FROM lightning_events
     WHERE stormEventId = ?
     ORDER BY timestamp DESC
     LIMIT 1`,
    [stormEventId],
  );
  return results.length > 0 ? results[0] : null;
}

/**
 * Count unlinked lightning events (no storm event) within a time window.
 * Used for retroactive storm association.
 */
export async function countUnlinkedLightningEvents(
  sinceMs: number,
  untilMs: number,
): Promise<number> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM lightning_events
     WHERE stormEventId IS NULL AND timestamp >= ? AND timestamp <= ?`,
    [sinceMs, untilMs],
  );
  return result?.count ?? 0;
}

/**
 * Associate unlinked lightning events with a storm event.
 * Links events within a time window that have no current storm association.
 * Returns the number of events linked.
 */
export async function associateUnlinkedLightningEvents(
  stormEventId: number,
  sinceMs: number,
  untilMs: number,
): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(
    `UPDATE lightning_events
     SET stormEventId = ?
     WHERE stormEventId IS NULL AND timestamp >= ? AND timestamp <= ?`,
    [stormEventId, sinceMs, untilMs],
  );
  return result.changes;
}
