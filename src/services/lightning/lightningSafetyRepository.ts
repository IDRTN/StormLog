import { getDatabase } from '../../database/database';
import { calculateBearingDegrees } from './lightningSafety';

export type LightningSafetySnapshot = {
  nearestDistanceKm: number | null;
  nearestBearingDegrees: number | null;
  latestEventTimestampMs: number | null;
  recentCount5Min: number;
  previousCount5Min: number;
};

type NearestRow = {
  distanceToObserverKm: number | null;
  eventLatitude: number;
  eventLongitude: number;
  observerLatitude: number;
  observerLongitude: number;
  timestamp: number;
};

export async function getLightningSafetySnapshot(
  nowMs: number,
  lookbackMs: number = 30 * 60_000,
): Promise<LightningSafetySnapshot> {
  const db = await getDatabase();
  const sinceMs = nowMs - lookbackMs;
  const since5m = nowMs - 5 * 60_000;
  const since10m = nowMs - 10 * 60_000;

  const [nearest, latest, recent, previous] = await Promise.all([
    db.getFirstAsync<NearestRow>(
      `SELECT distanceToObserverKm, eventLatitude, eventLongitude, observerLatitude, observerLongitude, timestamp
       FROM lightning_events
       WHERE timestamp >= ? AND timestamp <= ?
       ORDER BY distanceToObserverKm ASC, timestamp DESC
       LIMIT 1`,
      [sinceMs, nowMs],
    ),
    db.getFirstAsync<{ latest: number | null }>(
      `SELECT MAX(timestamp) AS latest
       FROM lightning_events
       WHERE timestamp >= ? AND timestamp <= ?`,
      [sinceMs, nowMs],
    ),
    db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM lightning_events
       WHERE timestamp >= ? AND timestamp <= ?`,
      [since5m, nowMs],
    ),
    db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM lightning_events
       WHERE timestamp >= ? AND timestamp < ?`,
      [since10m, since5m],
    ),
  ]);

  return {
    nearestDistanceKm: nearest?.distanceToObserverKm ?? null,
    nearestBearingDegrees: nearest
      ? calculateBearingDegrees(
          nearest.observerLatitude,
          nearest.observerLongitude,
          nearest.eventLatitude,
          nearest.eventLongitude,
        )
      : null,
    latestEventTimestampMs: latest?.latest ?? null,
    recentCount5Min: recent?.count ?? 0,
    previousCount5Min: previous?.count ?? 0,
  };
}
