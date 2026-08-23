import { getDatabase } from './database';
import type { AnalysisSnapshot } from '../models/types';

export async function insertAnalysisSnapshot(
  snapshot: Omit<AnalysisSnapshot, 'id'>
): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(
    `INSERT INTO analysis_snapshots
     (stormEventId, timestamp, tornadoPossibilityLevel, rotationSignal,
      convergence, windShear, pressureTrend, windDirectionChange,
      lightningTrend, availableObservationCount, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      snapshot.stormEventId,
      snapshot.timestamp,
      snapshot.tornadoPossibilityLevel,
      snapshot.rotationSignal,
      snapshot.convergence,
      snapshot.windShear,
      snapshot.pressureTrend,
      snapshot.windDirectionChange,
      snapshot.lightningTrend,
      snapshot.availableObservationCount,
      snapshot.confidence,
    ]
  );
  return result.lastInsertRowId;
}

export async function getAnalysisSnapshotsByEvent(
  eventId: number
): Promise<AnalysisSnapshot[]> {
  const db = await getDatabase();
  return await db.getAllAsync<AnalysisSnapshot>(
    'SELECT * FROM analysis_snapshots WHERE stormEventId = ? ORDER BY timestamp ASC',
    [eventId]
  );
}

export async function getLatestAnalysisSnapshot(
  eventId: number
): Promise<AnalysisSnapshot | null> {
  const db = await getDatabase();
  const results = await db.getAllAsync<AnalysisSnapshot>(
    'SELECT * FROM analysis_snapshots WHERE stormEventId = ? ORDER BY timestamp DESC LIMIT 1',
    [eventId]
  );
  return results.length > 0 ? results[0] : null;
}
