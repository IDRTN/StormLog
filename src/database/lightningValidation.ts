// ============================================================
// Lightning Validation Records — Field Validation Persistence
//
// Phase 8: Stores comparison snapshots between StormLog's
// authoritative lightning data and an independent source.
// Independent-source values are explicit field-validation
// inputs supplied by the observer — never auto-collected.
// ============================================================

import { getDatabase } from './database';
import { getLightningSummary, type LightningSummary } from '../services/lightning/lightningSummaries';

// ---- Types ----

export interface LightningValidationRecord {
  id: number;
  stormEventId: number | null;
  recordedAtMs: number;
  observerLatitude: number;
  observerLongitude: number;
  comparisonRadiusKm: number;
  timeWindowSinceMs: number;
  timeWindowUntilMs: number;
  independentSourceEventCount: number | null;
  independentSourceNearestDistanceKm: number | null;
  independentSourceRatePerMinute: number | null;
  independentSourceTrend: string | null;
  independentSourceTerminology: string | null;
  humanObservationNotes: string | null;
  stormlogEventCount: number;
  stormlogNearestDistanceKm: number | null;
  stormlogRatePerMinute: number;
  stormlogTrend: string;
  eventCountDifference: number;
  eventCountPctDifference: number | null;
  notes: string | null;
}

export type LightningValidationRecordInsert = Omit<LightningValidationRecord, 'id'>;

// ---- Comparison metrics (pure, deterministic) ----

export interface ComparisonMetrics {
  /** Difference: StormLog count minus independent source count. */
  eventCountDifference: number;
  /** Percentage difference: (StormLog - independent) / independent * 100.
   *  null when independent source count is 0 or not supplied. */
  eventCountPctDifference: number | null;
  /** Whether StormLog event count matches the independent source. */
  countsMatch: boolean;
  /** Whether both sources report zero events. */
  bothZero: boolean;
  /** Human-readable summary of the comparison. */
  summaryText: string;
}

/**
 * Pure deterministic comparison between StormLog data and an independent source.
 * No database access. No side effects.
 *
 * @param stormlogCount - StormLog's event count in the comparison window
 * @param independentCount - Independent source's event count (null if not supplied)
 * @param stormlogNearestKm - StormLog's nearest event distance (null if no events)
 * @param independentNearestKm - Independent source's nearest distance (null if not supplied)
 * @param stormlogRate - StormLog's rate per minute
 * @param independentRate - Independent source's rate (null if not supplied)
 */
export function calculateComparisonMetrics(
  stormlogCount: number,
  independentCount: number | null,
  stormlogNearestKm: number | null,
  independentNearestKm: number | null,
  stormlogRate: number,
  independentRate: number | null,
): ComparisonMetrics {
  const eventCountDifference =
    independentCount != null ? stormlogCount - independentCount : stormlogCount;

  let eventCountPctDifference: number | null = null;
  if (independentCount != null && independentCount > 0) {
    eventCountPctDifference =
      ((stormlogCount - independentCount) / independentCount) * 100;
  }

  const countsMatch =
    independentCount != null ? stormlogCount === independentCount : false;

  const bothZero =
    independentCount != null && stormlogCount === 0 && independentCount === 0;

  const parts: string[] = [];

  if (independentCount != null) {
    if (bothZero) {
      parts.push('Both sources report zero events');
    } else if (countsMatch) {
      parts.push(`Event counts match (${stormlogCount})`);
    } else {
      const sign = eventCountDifference > 0 ? '+' : '';
      parts.push(`StormLog: ${stormlogCount}, Independent: ${independentCount} (${sign}${eventCountDifference})`);
      if (eventCountPctDifference != null) {
        parts.push(`${eventCountPctDifference > 0 ? '+' : ''}${eventCountPctDifference.toFixed(1)}%`);
      }
    }
  } else {
    parts.push(`StormLog: ${stormlogCount} events (no independent source data)`);
  }

  if (stormlogNearestKm != null && independentNearestKm != null) {
    const nearestDiff = Math.abs(stormlogNearestKm - independentNearestKm);
    if (nearestDiff < 1) {
      parts.push(`Nearest distance within 1 km`);
    } else {
      parts.push(`Nearest: StormLog ${stormlogNearestKm.toFixed(1)} km, Independent ${independentNearestKm.toFixed(1)} km`);
    }
  }

  if (stormlogRate > 0 || (independentRate != null && independentRate > 0)) {
    const slRate = stormlogRate.toFixed(1);
    const indRate = independentRate != null ? independentRate.toFixed(1) : '—';
    parts.push(`Rate: ${slRate}/min vs ${indRate}/min`);
  }

  return {
    eventCountDifference,
    eventCountPctDifference,
    countsMatch,
    bothZero,
    summaryText: parts.join(' · '),
  };
}

// ---- Database persistence ----

/**
 * Insert a validation record.
 * The stormlog* fields should be snapshotted from getLightningSummary()
 * at the time of comparison, not re-queried later.
 *
 * Returns the inserted record's id.
 */
export async function insertValidationRecord(
  record: LightningValidationRecordInsert,
): Promise<number> {
  const db = await getDatabase();
  const metrics = calculateComparisonMetrics(
    record.stormlogEventCount,
    record.independentSourceEventCount,
    record.stormlogNearestDistanceKm,
    record.independentSourceNearestDistanceKm,
    record.stormlogRatePerMinute,
    record.independentSourceRatePerMinute,
  );

  const result = await db.runAsync(
    `INSERT INTO lightning_validation_records
     (stormEventId, recordedAtMs, observerLatitude, observerLongitude,
      comparisonRadiusKm, timeWindowSinceMs, timeWindowUntilMs,
      independentSourceEventCount, independentSourceNearestDistanceKm,
      independentSourceRatePerMinute, independentSourceTrend,
      independentSourceTerminology, humanObservationNotes,
      stormlogEventCount, stormlogNearestDistanceKm,
      stormlogRatePerMinute, stormlogTrend,
      eventCountDifference, eventCountPctDifference, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.stormEventId,
      record.recordedAtMs,
      record.observerLatitude,
      record.observerLongitude,
      record.comparisonRadiusKm,
      record.timeWindowSinceMs,
      record.timeWindowUntilMs,
      record.independentSourceEventCount,
      record.independentSourceNearestDistanceKm,
      record.independentSourceRatePerMinute,
      record.independentSourceTrend,
      record.independentSourceTerminology,
      record.humanObservationNotes,
      record.stormlogEventCount,
      record.stormlogNearestDistanceKm,
      record.stormlogRatePerMinute,
      record.stormlogTrend,
      metrics.eventCountDifference,
      metrics.eventCountPctDifference,
      record.notes,
    ],
  );
  return result.lastInsertRowId;
}

/**
 * Retrieve all validation records for a storm event, ordered by recorded time.
 */
export async function getValidationRecordsByStormEvent(
  stormEventId: number,
): Promise<LightningValidationRecord[]> {
  const db = await getDatabase();
  return await db.getAllAsync<LightningValidationRecord>(
    `SELECT * FROM lightning_validation_records
     WHERE stormEventId = ?
     ORDER BY recordedAtMs ASC`,
    [stormEventId],
  );
}

/**
 * Retrieve the most recent validation record for a storm event.
 */
export async function getLatestValidationRecord(
  stormEventId: number,
): Promise<LightningValidationRecord | null> {
  const db = await getDatabase();
  const results = await db.getAllAsync<LightningValidationRecord>(
    `SELECT * FROM lightning_validation_records
     WHERE stormEventId = ?
     ORDER BY recordedAtMs DESC
     LIMIT 1`,
    [stormEventId],
  );
  return results.length > 0 ? results[0] : null;
}

/**
 * Retrieve all validation records (not filtered by storm event).
 */
export async function getAllValidationRecords(): Promise<LightningValidationRecord[]> {
  const db = await getDatabase();
  return await db.getAllAsync<LightningValidationRecord>(
    `SELECT * FROM lightning_validation_records
     ORDER BY recordedAtMs DESC`,
  );
}

/**
 * Snapshot StormLog's current lightning summary for a storm event.
 * Returns the summary data needed to populate a validation record's
 * stormlog* fields, or null if the storm event has no lightning data.
 */
export async function snapshotStormlogLightning(
  stormEventId: number,
  nowMs: number,
  nearbyRadiusKm?: number,
): Promise<LightningSummary | null> {
  try {
    const summary = await getLightningSummary(stormEventId, { nowMs, nearbyRadiusKm });
    if (summary.totalCount === 0) return null;
    return summary;
  } catch {
    return null;
  }
}
