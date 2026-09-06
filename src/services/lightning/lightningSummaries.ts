// ============================================================
// Lightning Summaries — Derived summary queries
// ============================================================

import { getDatabase } from '../../database/database';
import { calculateTrend, type LightningTrend } from './lightningTrend';

export type { LightningTrend };

export type LightningSummary = {
  totalCount: number;
  flashCount: number;
  strikeCount: number;
  cgCount: number;
  icCount: number;
  nearbyCount: number;
  nearestDistanceKm: number | null;
  recentCount1Min: number;
  recentCount5Min: number;
  recentCount15Min: number;
  ratePerMinute: number;
  trend: LightningTrend;
};

export type RecentLightningProximity = {
  count: number;
  nearestDistanceKm: number | null;
  latestTimestampMs: number | null;
};

async function countByWhere(whereClause: string, params: any[]): Promise<number> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM lightning_events WHERE ${whereClause}`,
    params,
  );
  return result?.count ?? 0;
}

async function minDistance(whereClause: string, params: any[]): Promise<number | null> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ min_dist: number | null }>(
    `SELECT MIN(distanceToObserverKm) as min_dist FROM lightning_events WHERE ${whereClause}`,
    params,
  );
  return result?.min_dist ?? null;
}

export async function getLightningSummary(
  stormEventId: number,
  options: { nowMs: number; nearbyRadiusKm?: number },
): Promise<LightningSummary> {
  const { nowMs, nearbyRadiusKm = 50 } = options;
  const storm = 'stormEventId = ?';
  const stormParams = [stormEventId];
  const since1m = nowMs - 60_000;
  const since5m = nowMs - 300_000;
  const since10m = nowMs - 600_000;
  const since15m = nowMs - 900_000;

  const [
    totalCount, flashCount, strikeCount, cgCount, icCount,
    nearbyCount, nearest, recent1m, recent5m, recent15m,
    recentWindow, priorWindow,
  ] = await Promise.all([
    countByWhere(storm, stormParams),
    countByWhere(`${storm} AND providerTerminology = ?`, [...stormParams, 'flash']),
    countByWhere(`${storm} AND providerTerminology = ?`, [...stormParams, 'strike']),
    countByWhere(`${storm} AND classification = ?`, [...stormParams, 'CG']),
    countByWhere(`${storm} AND classification = ?`, [...stormParams, 'IC']),
    countByWhere(`${storm} AND distanceToObserverKm <= ?`, [...stormParams, nearbyRadiusKm]),
    minDistance(storm, stormParams),
    countByWhere(`${storm} AND timestamp >= ?`, [...stormParams, since1m]),
    countByWhere(`${storm} AND timestamp >= ?`, [...stormParams, since5m]),
    countByWhere(`${storm} AND timestamp >= ?`, [...stormParams, since15m]),
    countByWhere(`${storm} AND timestamp >= ? AND timestamp <= ?`, [...stormParams, since5m, nowMs]),
    countByWhere(`${storm} AND timestamp >= ? AND timestamp < ?`, [...stormParams, since10m, since5m]),
  ]);

  return {
    totalCount,
    flashCount,
    strikeCount,
    cgCount,
    icCount,
    nearbyCount,
    nearestDistanceKm: nearest,
    recentCount1Min: recent1m,
    recentCount5Min: recent5m,
    recentCount15Min: recent15m,
    ratePerMinute: recent5m / 5,
    trend: calculateTrend(recentWindow, priorWindow),
  };
}

/**
 * Read only recent lightning belonging to one event, or unassigned lightning
 * when stormEventId is null. This is the lifecycle primitive used for the
 * 20-mile auto-start / 30-mile clear hysteresis without mixing old storms.
 */
export async function getRecentLightningProximity(
  stormEventId: number | null,
  options: { nowMs: number; lookbackMs: number },
): Promise<RecentLightningProximity> {
  const db = await getDatabase();
  const sinceMs = options.nowMs - Math.max(0, options.lookbackMs);
  const ownership = stormEventId == null ? 'stormEventId IS NULL' : 'stormEventId = ?';
  const ownershipParams = stormEventId == null ? [] : [stormEventId];
  const row = await db.getFirstAsync<{
    count: number;
    nearest: number | null;
    latest: number | null;
  }>(
    `SELECT COUNT(*) AS count,
            MIN(distanceToObserverKm) AS nearest,
            MAX(timestamp) AS latest
       FROM lightning_events
      WHERE ${ownership}
        AND timestamp >= ?
        AND timestamp <= ?`,
    [...ownershipParams, sinceMs, options.nowMs],
  );
  return {
    count: row?.count ?? 0,
    nearestDistanceKm: row?.nearest ?? null,
    latestTimestampMs: row?.latest ?? null,
  };
}

/** Attach the detection window that caused an automatic lightning event. */
export async function attachRecentUnassignedLightningToStormEvent(
  stormEventId: number,
  sinceMs: number,
  untilMs: number,
): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(
    `UPDATE lightning_events
        SET stormEventId = ?
      WHERE stormEventId IS NULL
        AND timestamp >= ?
        AND timestamp <= ?`,
    [stormEventId, sinceMs, untilMs],
  );
  return result.changes;
}
