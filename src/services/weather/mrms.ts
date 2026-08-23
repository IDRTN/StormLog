import type { WeatherProvenance } from '../../models/types';
import { mmToInches, mmPerHourToInchesPerHour } from './conversions';

export type FetchJson = typeof fetch;

export interface MrmsBucketInput {
  startMs: number;
  endMs: number;
  valueMm: number | null;
  complete: boolean;
}

export interface MrmsProviderPayload {
  currentOneHour?: MrmsBucketInput | null;
  currentPartialHour?: MrmsBucketInput | null;
  precipRateMmPerHour?: number | null;
  hourlyBuckets?: MrmsBucketInput[];
  latitude?: number;
  longitude?: number;
  gridCellId?: string;
  retrievedTime?: number;
}

export interface MrmsPrecipitation {
  currentOneHourInches: number | null;
  currentPartialHourInches: number | null;
  precipitationRateInchesPerHour: number | null;
  observedDailyPrecipitationInches: number | null;
  observedDailyIsComplete: boolean;
  dataAvailable: boolean;
  missingHours: string[];
  usedHours: string[];
  weatherLocalDate: string;
  source: WeatherProvenance;
}

export interface MrmsProvider {
  getPrecipitation(
    latitude: number,
    longitude: number,
    referenceTimeMs: number,
    utcOffsetSeconds: number,
  ): Promise<MrmsPrecipitation | null>;
}

export function formatHourFromMs(value: number): string {
  return new Date(value).toISOString().substring(11, 13);
}

function localDateAndBoundary(referenceTimeMs: number, utcOffsetSeconds: number) {
  const localMidnight = Math.floor((referenceTimeMs + utcOffsetSeconds * 1000) / 86400000) * 86400000 - utcOffsetSeconds * 1000;
  const localDate = new Date(localMidnight + utcOffsetSeconds * 1000).toISOString().substring(0, 10);
  return { localDate, localMidnight };
}

function isValidBucket(bucket: MrmsBucketInput): boolean {
  return Number.isFinite(bucket.startMs)
    && Number.isFinite(bucket.endMs)
    && bucket.endMs > bucket.startMs
    && (bucket.valueMm == null || typeof bucket.valueMm === 'number');
}

export function accumulateMrmsDailyPrecipitation(
  buckets: MrmsBucketInput[],
  referenceTimeMs: number,
  utcOffsetSeconds: number,
): Pick<
  MrmsPrecipitation,
  'observedDailyPrecipitationInches' | 'observedDailyIsComplete' | 'dataAvailable' |
  'missingHours' | 'usedHours' | 'weatherLocalDate'
> {
  const { localDate, localMidnight } = localDateAndBoundary(referenceTimeMs, utcOffsetSeconds);
  const completedHourCount = Math.max(0, Math.floor((referenceTimeMs - localMidnight) / 3600000));
  const expectedStarts = Array.from({ length: completedHourCount }, (_, index) => localMidnight + index * 3600000);
  const byStart = new Map<number, MrmsBucketInput>();

  for (const bucket of buckets) {
    if (!isValidBucket(bucket)) continue;
    if (bucket.startMs < localMidnight || bucket.startMs >= localMidnight + 86400000) continue;
    if (!bucket.complete || bucket.endMs > referenceTimeMs || bucket.valueMm == null) continue;

    const existing = byStart.get(bucket.startMs);
    if (!existing || bucket.endMs > existing.endMs) byStart.set(bucket.startMs, bucket);
  }

  let total = 0;
  let hasValue = false;
  const usedHours: string[] = [];
  const missingHours: string[] = [];

  for (const start of expectedStarts) {
    const bucket = byStart.get(start);
    if (!bucket) {
      missingHours.push(`${localDate}T${formatHourFromMs(start)}:00`);
      continue;
    }
    const valueMm = bucket.valueMm;
    if (valueMm == null) {
      missingHours.push(`${localDate}T${formatHourFromMs(start)}:00`);
      continue;
    }
    total += mmToInches(valueMm);
    hasValue = true;
    usedHours.push(`${localDate}T${formatHourFromMs(start)}:00`);
  }

  const isComplete = missingHours.length === 0;
  return {
    observedDailyPrecipitationInches: !hasValue ? null : total,
    observedDailyIsComplete: isComplete,
    dataAvailable: hasValue || missingHours.length === 0,
    missingHours,
    usedHours,
    weatherLocalDate: localDate,
  };
}

function provenance(
  payload: MrmsProviderPayload,
  latitude: number,
  longitude: number,
  referenceTimeMs: number,
  source: string,
): WeatherProvenance {
  const retrievedTime = payload.retrievedTime ?? referenceTimeMs;
  const age = Math.max(0, referenceTimeMs - retrievedTime);
  return {
    provider: 'NOAA_MRMS',
    source,
    latitude: payload.latitude ?? latitude,
    longitude: payload.longitude ?? longitude,
    observationTime: payload.currentOneHour?.endMs ?? retrievedTime,
    retrievedTime,
    freshness: age <= 15 * 60 * 1000 ? 'current' : 'stale',
    confidence: age <= 15 * 60 * 1000 ? 0.85 : 0.55,
    completeness: (payload.hourlyBuckets ?? []).filter((bucket) => bucket.complete && bucket.valueMm != null).length
      / Math.max(1, (payload.hourlyBuckets ?? []).length),
  };
}

export function createHttpMrmsProvider(
  serviceUrl: string | undefined,
  fetchJson: FetchJson = fetch,
): MrmsProvider {
  return {
    async getPrecipitation(latitude, longitude, referenceTimeMs, utcOffsetSeconds) {
      if (!serviceUrl) return null;
      const endpoint = `${serviceUrl.replace(/\/$/, '')}/mrms?latitude=${latitude}&longitude=${longitude}&referenceTimeMs=${referenceTimeMs}&utcOffsetSeconds=${utcOffsetSeconds}`;
      try {
        const response = await fetchJson(endpoint, { headers: { Accept: 'application/json' } });
        if (!response.ok) return null;
        const payload: MrmsProviderPayload = await response.json();
        const daily = accumulateMrmsDailyPrecipitation(payload.hourlyBuckets ?? [], referenceTimeMs, utcOffsetSeconds);
        if (!daily.dataAvailable && payload.precipRateMmPerHour == null && payload.currentOneHour?.valueMm == null) {
          return null;
        }

        const source = provenance(payload, latitude, longitude, referenceTimeMs, 'MRMS service/cache');
        const currentEnd = payload.currentOneHour?.endMs;
        const currentAge = currentEnd ? referenceTimeMs - currentEnd : Number.POSITIVE_INFINITY;

        return {
          currentOneHourInches: payload.currentOneHour?.valueMm != null && currentAge <= 15 * 60 * 1000
            ? mmToInches(payload.currentOneHour.valueMm)
            : null,
          currentPartialHourInches: payload.currentPartialHour?.valueMm != null
            ? mmToInches(payload.currentPartialHour.valueMm)
            : null,
          precipitationRateInchesPerHour: payload.precipRateMmPerHour != null
            ? mmPerHourToInchesPerHour(payload.precipRateMmPerHour)
            : null,
          ...daily,
          source,
        };
      } catch {
        return null;
      }
    },
  };
}
