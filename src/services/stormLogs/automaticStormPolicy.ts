const KM_PER_MILE = 1.609344;

export const LIGHTNING_AUTO_START_RADIUS_MILES = 20;
export const LIGHTNING_AUTO_STOP_RADIUS_MILES = 30;
export const LIGHTNING_AUTO_START_RADIUS_KM = LIGHTNING_AUTO_START_RADIUS_MILES * KM_PER_MILE;
export const LIGHTNING_AUTO_STOP_RADIUS_KM = LIGHTNING_AUTO_STOP_RADIUS_MILES * KM_PER_MILE;
export const LIGHTNING_AUTO_START_LOOKBACK_MS = 15 * 60_000;
export const LIGHTNING_CLEAR_LOOKBACK_MS = 30 * 60_000;
export const AUTO_STOP_REVIEW_GRACE_MS = 30 * 60_000;
export const KEEP_RECORDING_SUPPRESS_MS = 60 * 60_000;
export const NWS_SNAPSHOT_MAX_AGE_MS = 20 * 60_000;

export type LightningProximityEvidence = {
  count: number;
  nearestDistanceKm: number | null;
};

export function kmToMiles(distanceKm: number | null): number | null {
  return distanceKm == null ? null : distanceKm / KM_PER_MILE;
}

export function isLightningAutoStartCandidate(evidence: LightningProximityEvidence): boolean {
  return evidence.count > 0
    && evidence.nearestDistanceKm != null
    && evidence.nearestDistanceKm <= LIGHTNING_AUTO_START_RADIUS_KM;
}

export function isLightningStillRelevant(evidence: LightningProximityEvidence): boolean {
  return evidence.count > 0
    && evidence.nearestDistanceKm != null
    && evidence.nearestDistanceKm <= LIGHTNING_AUTO_STOP_RADIUS_KM;
}

export function classifyAutomaticStormEvidence(input: {
  nwsFresh: boolean;
  nwsActive: boolean;
  lightningFresh: boolean;
  lightningRelevant: boolean;
}): 'active' | 'unknown' | 'clear' {
  if ((input.nwsFresh && input.nwsActive) || (input.lightningFresh && input.lightningRelevant)) {
    return 'active';
  }
  if (!input.nwsFresh || !input.lightningFresh) return 'unknown';
  return 'clear';
}

export function isStopReviewGraceExpired(requestedAtMs: number, nowMs: number): boolean {
  return nowMs - requestedAtMs >= AUTO_STOP_REVIEW_GRACE_MS;
}
