// ============================================================
// Wind Vector Analysis — convergence, rotation, shear
// ============================================================

import type { WindVector, ConvergenceLevel, RotationSignal } from './types';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

// ---- Vector math ----

/** Convert meteorological wind (FROM direction) to unit u/v components */
export function windToUV(speed: number, directionDeg: number): { u: number; v: number } {
  // Meteorological convention: direction is where wind comes FROM
  // u = eastward component, v = northward component
  // Wind FROM 0° (north) blows southward → v = -speed
  // Wind FROM 90° (east) blows westward → u = -speed
  const rad = directionDeg * DEG_TO_RAD;
  return {
    u: -speed * Math.sin(rad),
    v: -speed * Math.cos(rad),
  };
}

/** Convert u/v back to speed + direction (meteorological FROM) */
export function uvToWind(u: number, v: number): { speed: number; direction: number } {
  const speed = Math.sqrt(u * u + v * v);
  // atan2(-u, -v) gives direction wind comes FROM
  let dir = Math.atan2(-u, -v) * RAD_TO_DEG;
  if (dir < 0) dir += 360;
  return { speed, direction: dir };
}

/** Calculate Haversine distance between two points in km */
export function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---- Convergence ----

/**
 * Calculate wind convergence from surrounding station vectors.
 * Convergence = degree to which wind vectors point toward a common area.
 *
 * For each pair of stations, compute the angle between their u/v components
 * when normalized. If vectors point inward (toward a center), convergence is high.
 */
export function calculateConvergence(
  stations: WindVector[],
  centerLat: number,
  centerLon: number
): { score: number; level: ConvergenceLevel; details: { station: string; u: number; v: number; speed: number; dir: number }[] } {
  if (stations.length < 2) {
    return { score: 0, level: 'LOW', details: [] };
  }

  const details: { station: string; u: number; v: number; speed: number; dir: number }[] = [];

  // For each station, compute the u/v and also the direction of the vector
  // TOWARD the center point
  let convergenceSum = 0;
  let count = 0;

  for (const st of stations) {
    const { u, v } = windToUV(st.speed, st.direction);
    details.push({
      station: st.stationId || `${st.latitude.toFixed(2)},${st.longitude.toFixed(2)}`,
      u, v, speed: st.speed, dir: st.direction,
    });

    // Direction from station to center
    const toCenter = Math.atan2(
      centerLon - st.longitude,
      centerLat - st.latitude
    );
    // Direction wind is blowing TOWARD (opposite of FROM)
    const blowToward = (st.direction + 180) % 360;
    const blowRad = blowToward * DEG_TO_RAD;

    // How much the wind is blowing toward the center (1 = directly toward, -1 = directly away)
    const alignment = Math.cos(toCenter - blowRad);
    convergenceSum += alignment;
    count++;
  }

  if (count === 0) return { score: 0, level: 'LOW', details };

  const avgConvergence = convergenceSum / count;
  // Map from [-1, 1] to [0, 1] where 1 = all blowing toward center
  const normalized = (avgConvergence + 1) / 2;

  let level: ConvergenceLevel;
  if (normalized > 0.7) level = 'HIGH';
  else if (normalized > 0.5) level = 'MODERATE';
  else level = 'LOW';

  return { score: Math.min(1, Math.max(0, normalized)), level, details };
}

// ---- Rotation Signal ----

/**
 * Detect rotational wind patterns from surrounding stations.
 * Looks for cyclonic (counterclockwise in NH) or anticyclonic patterns.
 *
 * Cyclonic: stations on the east side have southerly winds,
 *           stations on the west side have northerly winds.
 */
export function calculateRotation(
  stations: WindVector[],
  centerLat: number,
  centerLon: number
): { score: number; signal: RotationSignal; confidence: number } {
  if (stations.length < 3) {
    return { score: 0, signal: 'NONE', confidence: 0 };
  }

  let cyclonicScore = 0;
  let anticyclonicScore = 0;
  let count = 0;

  for (const st of stations) {
    const { u, v } = windToUV(st.speed, st.direction);
    const dLon = st.longitude - centerLon;
    const dLat = st.latitude - centerLat;

    // For cyclonic rotation in NH:
    // Stations east of center (dLon > 0) should have southward component (v < 0)
    // Stations north of center (dLat > 0) should have westward component (u < 0)
    // Stations west of center (dLon < 0) should have northward component (v > 0)
    // Stations south of center (dLat < 0) should have eastward component (u > 0)

    // Cyclonic contribution: cross product of position × velocity
    const cross = dLon * v - dLat * u;
    cyclonicScore += cross;
    anticyclonicScore -= cross;
    count++;
  }

  if (count === 0) return { score: 0, signal: 'NONE', confidence: 0 };

  // Normalize by typical wind speed and distance scale
  const avgSpeed = stations.reduce((s, st) => s + st.speed, 0) / stations.length;
  const avgDist = stations.reduce((s, st) => {
    return s + haversineDistance(centerLat, centerLon, st.latitude, st.longitude);
  }, 0) / stations.length;
  const scale = Math.max(avgSpeed * avgDist, 1);

  const cyclNorm = Math.abs(cyclonicScore) / scale;
  const antiNorm = Math.abs(anticyclonicScore) / scale;
  const dominant = Math.max(cyclNorm, antiNorm);

  // Confidence based on number of stations and their spatial distribution
  const stationConfidence = Math.min(count / 6, 1);
  const spreadConfidence = avgDist > 5 ? 1 : avgDist / 5; // stations should be spread out
  const confidence = Math.round(stationConfidence * spreadConfidence * 100);

  let signal: RotationSignal;
  if (dominant > 0.8) signal = 'STRONG';
  else if (dominant > 0.5) signal = 'MODERATE';
  else if (dominant > 0.2) signal = 'WEAK';
  else signal = 'NONE';

  return {
    score: Math.min(1, dominant),
    signal,
    confidence: Math.max(0, Math.min(100, confidence)),
  };
}

// ---- Wind Shear ----

/**
 * Calculate directional wind shear from a series of observations.
 * Large changes in direction over short time = high shear.
 */
export function calculateDirectionalShear(
  observations: { windDirection: number | null; windSpeed: number | null; timestamp: number }[]
): { shearDegrees: number; shearRate: number; level: 'NONE' | 'WEAK' | 'MODERATE' | 'STRONG' } {
  const valid = observations.filter(o => o.windDirection != null && o.windSpeed != null && o.windSpeed > 0);
  if (valid.length < 2) {
    return { shearDegrees: 0, shearRate: 0, level: 'NONE' };
  }

  let totalShear = 0;
  for (let i = 1; i < valid.length; i++) {
    let diff = (valid[i].windDirection! - valid[i - 1].windDirection!) % 360;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    totalShear += Math.abs(diff);
  }

  const timeSpanMinutes = (valid[valid.length - 1].timestamp - valid[0].timestamp) / 60000;
  const shearRate = timeSpanMinutes > 0 ? totalShear / timeSpanMinutes : 0;

  let level: 'NONE' | 'WEAK' | 'MODERATE' | 'STRONG';
  if (totalShear > 90) level = 'STRONG';
  else if (totalShear > 45) level = 'MODERATE';
  else if (totalShear > 15) level = 'WEAK';
  else level = 'NONE';

  return { shearDegrees: totalShear, shearRate, level };
}

// ---- Wind Shift ----

/**
 * Calculate the largest wind direction change in a time window.
 */
export function calculateWindShift(
  records: { direction: number; timestamp: number }[],
  windowMinutes: number = 60
): { degrees: number; durationMinutes: number } | null {
  if (records.length < 2) return null;

  // Sort by timestamp
  const sorted = [...records].sort((a, b) => a.timestamp - b.timestamp);

  let maxShift = 0;
  let maxShiftDuration = 0;

  for (let i = 1; i < sorted.length; i++) {
    const dt = (sorted[i].timestamp - sorted[i - 1].timestamp) / 60000;
    if (dt > windowMinutes) continue;

    let diff = (sorted[i].direction - sorted[i - 1].direction) % 360;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    const absDiff = Math.abs(diff);

    if (absDiff > maxShift) {
      maxShift = absDiff;
      maxShiftDuration = dt;
    }
  }

  // Also check cumulative shift from first to last within window
  const withinWindow = sorted.filter(
    s => (sorted[sorted.length - 1].timestamp - s.timestamp) / 60000 <= windowMinutes
  );
  if (withinWindow.length >= 2) {
    let cumDiff = (withinWindow[withinWindow.length - 1].direction - withinWindow[0].direction) % 360;
    if (cumDiff > 180) cumDiff -= 360;
    if (cumDiff < -180) cumDiff += 360;
    const cumAbs = Math.abs(cumDiff);
    if (cumAbs > maxShift) {
      maxShift = cumAbs;
      maxShiftDuration = (withinWindow[withinWindow.length - 1].timestamp - withinWindow[0].timestamp) / 60000;
    }
  }

  return maxShift > 0 ? { degrees: Math.round(maxShift), durationMinutes: Math.round(maxShiftDuration) } : null;
}
