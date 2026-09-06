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

export const AUTOMATIC_NWS_TRIGGER_EVENTS = new Set([
  'Tornado Warning',
  'Severe Thunderstorm Warning',
  'Severe Thunderstorm Watch',
  'Flash Flood Warning',
]);

export type LightningProximityEvidence = {
  count: number;
  nearestDistanceKm: number | null;
};

export function kmToMiles(distanceKm: number | null): number | null {
  return distanceKm == null ? null : distanceKm / KM_PER_MILE;
}

export function hasEligibleAutomaticNwsSeverity(event: string, severity: string | null): boolean {
  if (severity === 'Extreme' || severity === 'Severe') return true;
  return event === 'Severe Thunderstorm Watch' && severity === 'Moderate';
}

export function isAutomaticNwsTrigger(input: {
  id: string | null | undefined;
  event: string;
  severity: string | null;
  status?: string | null;
  messageType?: string | null;
}): boolean {
  if (typeof input.id !== 'string' || input.id.trim().length === 0) return false;
  if (!AUTOMATIC_NWS_TRIGGER_EVENTS.has(input.event)) return false;
  if (!hasEligibleAutomaticNwsSeverity(input.event, input.severity)) return false;
  if (input.status != null && input.status !== 'Actual') return false;
  return (input.messageType ?? 'Alert').toUpperCase() !== 'CANCEL';
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
