export type LightningUsageHeaders = {
  costTokens: number | null;
  periodLimit: number | null;
  periodRemaining: number | null;
  periodResetAtMs: number | null;
  periodType: string | null;
};

export type LightningUsageSnapshot = {
  periodLimit: number | null;
  periodRemaining: number | null;
  periodResetAtMs: number | null;
  periodType: string | null;
  lastCostTokens: number;
  locallyTrackedTokens: number;
  lastUpdatedAtMs: number | null;
  nextAllowedAtMs: number;
};

export type LightningUsageDecision = {
  allowed: boolean;
  reason: 'ok' | 'soft_throttle' | 'reserve_protected';
  retryAfterMs: number;
  reserveTokens: number;
};

export const DEFAULT_LIGHTNING_PERIOD_LIMIT = 15_000;
export const DEFAULT_LIGHTNING_REQUEST_COST = 10;
export const LIGHTNING_HARD_RESERVE_FRACTION = 0.10;
export const LIGHTNING_SOFT_RESERVE_FRACTION = 0.20;
export const LIGHTNING_SOFT_THROTTLE_MS = 15 * 60_000;

export function createEmptyLightningUsageSnapshot(): LightningUsageSnapshot {
  return {
    periodLimit: null,
    periodRemaining: null,
    periodResetAtMs: null,
    periodType: null,
    lastCostTokens: DEFAULT_LIGHTNING_REQUEST_COST,
    locallyTrackedTokens: 0,
    lastUpdatedAtMs: null,
    nextAllowedAtMs: 0,
  };
}

function finiteNonNegative(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function normalizeUsageSnapshotForTime(
  snapshot: LightningUsageSnapshot,
  nowMs: number,
): LightningUsageSnapshot {
  if (snapshot.periodResetAtMs != null && nowMs >= snapshot.periodResetAtMs) {
    return createEmptyLightningUsageSnapshot();
  }
  return snapshot;
}

export function getEffectiveRemaining(snapshot: LightningUsageSnapshot): number {
  const serverRemaining = finiteNonNegative(snapshot.periodRemaining);
  if (serverRemaining != null) return serverRemaining;

  const limit = finiteNonNegative(snapshot.periodLimit) ?? DEFAULT_LIGHTNING_PERIOD_LIMIT;
  return Math.max(0, limit - Math.max(0, snapshot.locallyTrackedTokens));
}

export function evaluateLightningUsage(
  rawSnapshot: LightningUsageSnapshot,
  nowMs: number,
): LightningUsageDecision {
  const snapshot = normalizeUsageSnapshotForTime(rawSnapshot, nowMs);
  const limit = finiteNonNegative(snapshot.periodLimit) ?? DEFAULT_LIGHTNING_PERIOD_LIMIT;
  const remaining = getEffectiveRemaining(snapshot);
  const estimatedCost = Math.max(1, finiteNonNegative(snapshot.lastCostTokens) ?? DEFAULT_LIGHTNING_REQUEST_COST);
  const hardReserve = Math.ceil(limit * LIGHTNING_HARD_RESERVE_FRACTION);
  const softReserve = Math.ceil(limit * LIGHTNING_SOFT_RESERVE_FRACTION);

  if (remaining <= hardReserve + estimatedCost) {
    const retryAfterMs = snapshot.periodResetAtMs != null
      ? Math.max(60_000, snapshot.periodResetAtMs - nowMs)
      : 6 * 60 * 60_000;
    return {
      allowed: false,
      reason: 'reserve_protected',
      retryAfterMs,
      reserveTokens: hardReserve,
    };
  }

  if (nowMs < snapshot.nextAllowedAtMs) {
    return {
      allowed: false,
      reason: 'soft_throttle',
      retryAfterMs: snapshot.nextAllowedAtMs - nowMs,
      reserveTokens: hardReserve,
    };
  }

  if (remaining <= softReserve) {
    return {
      allowed: true,
      reason: 'soft_throttle',
      retryAfterMs: 0,
      reserveTokens: hardReserve,
    };
  }

  return { allowed: true, reason: 'ok', retryAfterMs: 0, reserveTokens: hardReserve };
}

export function applyLightningUsageResponse(
  rawSnapshot: LightningUsageSnapshot,
  headers: LightningUsageHeaders,
  nowMs: number,
): LightningUsageSnapshot {
  const snapshot = normalizeUsageSnapshotForTime(rawSnapshot, nowMs);
  const cost = Math.max(0, finiteNonNegative(headers.costTokens) ?? snapshot.lastCostTokens ?? DEFAULT_LIGHTNING_REQUEST_COST);
  const periodLimit = finiteNonNegative(headers.periodLimit) ?? snapshot.periodLimit;
  const periodRemaining = finiteNonNegative(headers.periodRemaining) ?? snapshot.periodRemaining;
  const periodResetAtMs = finiteNonNegative(headers.periodResetAtMs) ?? snapshot.periodResetAtMs;
  const effectiveLimit = periodLimit ?? DEFAULT_LIGHTNING_PERIOD_LIMIT;
  const effectiveRemaining = periodRemaining ?? Math.max(0, effectiveLimit - (snapshot.locallyTrackedTokens + cost));
  const softReserve = Math.ceil(effectiveLimit * LIGHTNING_SOFT_RESERVE_FRACTION);

  return {
    periodLimit,
    periodRemaining,
    periodResetAtMs,
    periodType: headers.periodType ?? snapshot.periodType,
    lastCostTokens: cost > 0 ? cost : snapshot.lastCostTokens,
    locallyTrackedTokens: snapshot.locallyTrackedTokens + cost,
    lastUpdatedAtMs: nowMs,
    nextAllowedAtMs: effectiveRemaining <= softReserve
      ? Math.max(snapshot.nextAllowedAtMs, nowMs + LIGHTNING_SOFT_THROTTLE_MS)
      : 0,
  };
}

export function parseXweatherReset(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    if (numeric > 10_000_000_000) return numeric;
    if (numeric > 1_000_000_000) return numeric * 1000;
    return nowMs + numeric * 1000;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
