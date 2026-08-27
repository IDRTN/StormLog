// ============================================================
// Lightning Summaries — Derived summary queries
//
// Phase 5: Summary/query primitives.
// All summaries are calculated from raw lightning_events.
// Trend logic is in lightningTrend.ts (pure, no database).
// ============================================================

import { getDatabase } from '../../database/database';
import { calculateTrend, type LightningTrend } from './lightningTrend';

export type { LightningTrend };

// ---- Summary result ----

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

// ---- SQL aggregation helpers ----

async function countByWhere(
  whereClause: string,
  params: any[],
): Promise<number> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM lightning_events WHERE ${whereClause}`,
    params,
  );
  return result?.count ?? 0;
}

async function minDistance(
  whereClause: string,
  params: any[],
): Promise<number | null> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ min_dist: number | null }>(
    `SELECT MIN(distanceToObserverKm) as min_dist FROM lightning_events WHERE ${whereClause}`,
    params,
  );
  return result?.min_dist ?? null;
}

// ---- Public summary function ----

/**
 * Calculate a lightning summary for a storm event.
 * All counts are derived from raw lightning_events via SQL aggregation.
 * Trend is calculated deterministically from two 5-minute windows.
 */
export async function getLightningSummary(
  stormEventId: number,
  options: {
    nowMs: number;
    nearbyRadiusKm?: number;
  },
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
