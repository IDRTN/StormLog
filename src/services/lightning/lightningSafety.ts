export type LightningSafetyLevel =
  | 'VERY_CLOSE'
  | 'NEARBY'
  | 'IN_AREA'
  | 'CLEAR'
  | 'STALE'
  | 'WAITING'
  | 'UNAVAILABLE';

export type LightningSafetyInput = {
  nowMs: number;
  providerConfigured: boolean;
  nearestDistanceKm: number | null;
  nearestBearingDegrees: number | null;
  latestEventTimestampMs: number | null;
  lastSuccessfulCollectionMs: number | null;
  lastAttemptMs: number | null;
  lastError?: string | null;
};

export type LightningSafetyState = {
  level: LightningSafetyLevel;
  title: string;
  detail: string;
  nearestDistanceMiles: number | null;
  direction: string | null;
  dataAgeMs: number | null;
  isFresh: boolean;
};

const KM_PER_MILE = 1.609344;
const VERY_CLOSE_KM = 5 * KM_PER_MILE;
const NEARBY_KM = 10 * KM_PER_MILE;
const IN_AREA_KM = 25 * KM_PER_MILE;
const MAX_COLLECTION_AGE_MS = 20 * 60_000;
const MAX_EVENT_AGE_MS = 30 * 60_000;

export function bearingToCompass(degrees: number | null): string | null {
  if (degrees == null || !Number.isFinite(degrees)) return null;
  const normalized = ((degrees % 360) + 360) % 360;
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return directions[Math.round(normalized / 45) % 8];
}

export function calculateBearingDegrees(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
): number | null {
  if (![fromLatitude, fromLongitude, toLatitude, toLongitude].every(Number.isFinite)) return null;
  const toRadians = (value: number) => value * Math.PI / 180;
  const lat1 = toRadians(fromLatitude);
  const lat2 = toRadians(toLatitude);
  const deltaLon = toRadians(toLongitude - fromLongitude);
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  const bearing = Math.atan2(y, x) * 180 / Math.PI;
  return ((bearing % 360) + 360) % 360;
}

export function getLightningSafetyState(input: LightningSafetyInput): LightningSafetyState {
  const collectionAgeMs = input.lastSuccessfulCollectionMs == null
    ? null
    : Math.max(0, input.nowMs - input.lastSuccessfulCollectionMs);
  const eventAgeMs = input.latestEventTimestampMs == null
    ? null
    : Math.max(0, input.nowMs - input.latestEventTimestampMs);
  const direction = bearingToCompass(input.nearestBearingDegrees);
  const nearestDistanceMiles = input.nearestDistanceKm == null
    ? null
    : input.nearestDistanceKm / KM_PER_MILE;

  if (!input.providerConfigured) {
    return {
      level: 'UNAVAILABLE',
      title: 'Lightning data unavailable',
      detail: 'Live lightning provider is not configured.',
      nearestDistanceMiles,
      direction,
      dataAgeMs: collectionAgeMs,
      isFresh: false,
    };
  }

  if (input.lastSuccessfulCollectionMs == null) {
    const failed = input.lastAttemptMs != null && input.lastError;
    return {
      level: failed ? 'UNAVAILABLE' : 'WAITING',
      title: failed ? 'Lightning data unavailable' : 'Waiting for lightning data',
      detail: failed ? 'The latest lightning refresh failed.' : 'No successful lightning refresh yet.',
      nearestDistanceMiles,
      direction,
      dataAgeMs: null,
      isFresh: false,
    };
  }

  if (collectionAgeMs != null && collectionAgeMs > MAX_COLLECTION_AGE_MS) {
    return {
      level: 'STALE',
      title: 'Lightning data stale',
      detail: 'Do not treat stale lightning data as an all-clear.',
      nearestDistanceMiles,
      direction,
      dataAgeMs: collectionAgeMs,
      isFresh: false,
    };
  }

  const recentEvent = eventAgeMs != null && eventAgeMs <= MAX_EVENT_AGE_MS;
  if (!recentEvent || input.nearestDistanceKm == null) {
    return {
      level: 'CLEAR',
      title: 'No nearby lightning detected',
      detail: 'No recent lightning was detected in the monitored area.',
      nearestDistanceMiles: null,
      direction: null,
      dataAgeMs: collectionAgeMs,
      isFresh: true,
    };
  }

  if (input.nearestDistanceKm <= VERY_CLOSE_KM) {
    return {
      level: 'VERY_CLOSE',
      title: 'Lightning very close',
      detail: 'Lightning detected within about 5 miles.',
      nearestDistanceMiles,
      direction,
      dataAgeMs: collectionAgeMs,
      isFresh: true,
    };
  }

  if (input.nearestDistanceKm <= NEARBY_KM) {
    return {
      level: 'NEARBY',
      title: 'Lightning nearby',
      detail: 'Lightning detected within about 10 miles.',
      nearestDistanceMiles,
      direction,
      dataAgeMs: collectionAgeMs,
      isFresh: true,
    };
  }

  if (input.nearestDistanceKm <= IN_AREA_KM) {
    return {
      level: 'IN_AREA',
      title: 'Lightning in the area',
      detail: 'Lightning detected within about 25 miles.',
      nearestDistanceMiles,
      direction,
      dataAgeMs: collectionAgeMs,
      isFresh: true,
    };
  }

  return {
    level: 'CLEAR',
    title: 'No nearby lightning detected',
    detail: 'Recent lightning is outside the 25-mile safety indicator range.',
    nearestDistanceMiles,
    direction,
    dataAgeMs: collectionAgeMs,
    isFresh: true,
  };
}
