import type { WeatherProvenance } from '../../models/types';
import { mmToInches, mmPerHourToInchesPerHour } from './conversions';
import { createRateLimitError, guardedRequest } from '../network/requestGuard';

export type FetchJson = typeof fetch;

const NOAA_MRMS_IMAGE_SERVICE = 'https://mapservices.weather.noaa.gov/raster/rest/services/obs/mrms_qpe/ImageServer';

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
  radarPrecipitation1hInches?: number | null;
  radarPrecipitation3hInches?: number | null;
  radarPrecipitation6hInches?: number | null;
  radarPrecipitation12hInches?: number | null;
  radarPrecipitation24hInches?: number | null;
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
    if (!bucket || bucket.valueMm == null) {
      missingHours.push(`${localDate}T${formatHourFromMs(start)}:00`);
      continue;
    }
    total += mmToInches(bucket.valueMm);
    hasValue = true;
    usedHours.push(`${localDate}T${formatHourFromMs(start)}:00`);
  }

  return {
    observedDailyPrecipitationInches: !hasValue ? null : total,
    observedDailyIsComplete: missingHours.length === 0,
    dataAvailable: hasValue || missingHours.length === 0,
    missingHours,
    usedHours,
    weatherLocalDate: localDate,
  };
}

function customBackendSource(
  payload: MrmsProviderPayload,
  latitude: number,
  longitude: number,
  referenceTimeMs: number,
): WeatherProvenance {
  const retrievedTime = payload.retrievedTime ?? referenceTimeMs;
  const age = Math.max(0, referenceTimeMs - retrievedTime);
  return {
    provider: 'NOAA_MRMS',
    source: 'NOAA MRMS hourly QPE service',
    latitude: payload.latitude ?? latitude,
    longitude: payload.longitude ?? longitude,
    gridId: payload.gridCellId,
    dataKind: 'radar_estimated',
    observationTime: payload.currentOneHour?.endMs ?? retrievedTime,
    retrievedTime,
    freshness: age <= 15 * 60 * 1000 ? 'current' : 'stale',
    confidence: age <= 15 * 60 * 1000 ? 0.9 : 0.6,
    completeness: (payload.hourlyBuckets ?? []).filter((bucket) => bucket.complete && bucket.valueMm != null).length
      / Math.max(1, (payload.hourlyBuckets ?? []).length),
  };
}

function parseMrmsPixel(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return numeric;
}

function extractValidTime(payload: any): number | undefined {
  const features = payload?.catalogItems?.features;
  if (!Array.isArray(features)) return undefined;
  for (const feature of features) {
    const raw = feature?.attributes?.idp_validendtime ?? feature?.attributes?.IDP_VALIDENDTIME;
    const value = typeof raw === 'number' ? raw : Date.parse(String(raw ?? ''));
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

async function identifyRollingQpe(
  hours: 1 | 3 | 6 | 12 | 24,
  latitude: number,
  longitude: number,
  referenceTimeMs: number,
  fetchJson: FetchJson,
): Promise<{ value: number | null; validTime?: number }> {
  const geometry = JSON.stringify({ x: longitude, y: latitude, spatialReference: { wkid: 4326 } });
  const renderingRule = JSON.stringify({ rasterFunction: `rft_${hours}hr` });
  const endpoint = `${NOAA_MRMS_IMAGE_SERVICE}/identify`
    + `?geometry=${encodeURIComponent(geometry)}`
    + '&geometryType=esriGeometryPoint'
    + `&renderingRule=${encodeURIComponent(renderingRule)}`
    + '&returnGeometry=false&returnCatalogItems=true&f=json';
  const response = await fetchJson(endpoint, { headers: { Accept: 'application/json' } });
  if (response.status === 429) throw createRateLimitError('NOAA MRMS QPE', response);
  if (!response.ok) throw new Error(`NOAA MRMS QPE HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.error) throw new Error(`NOAA MRMS QPE error: ${payload.error.message ?? 'unknown error'}`);
  return { value: parseMrmsPixel(payload?.value), validTime: extractValidTime(payload) };
}

async function fetchDirectNoaaMrms(
  latitude: number,
  longitude: number,
  referenceTimeMs: number,
  utcOffsetSeconds: number,
  fetchJson: FetchJson,
): Promise<MrmsPrecipitation | null> {
  const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}:${Math.floor(referenceTimeMs / (5 * 60000))}`;
  return guardedRequest<MrmsPrecipitation | null>({
    service: 'NOAA MRMS QPE',
    key,
    cacheTtlMs: 5 * 60 * 1000,
    cacheIf: (value) => value != null,
    execute: async () => {
      const [h1, h3, h6, h12, h24] = await Promise.all([
        identifyRollingQpe(1, latitude, longitude, referenceTimeMs, fetchJson),
        identifyRollingQpe(3, latitude, longitude, referenceTimeMs, fetchJson),
        identifyRollingQpe(6, latitude, longitude, referenceTimeMs, fetchJson),
        identifyRollingQpe(12, latitude, longitude, referenceTimeMs, fetchJson),
        identifyRollingQpe(24, latitude, longitude, referenceTimeMs, fetchJson),
      ]);
      if ([h1.value, h3.value, h6.value, h12.value, h24.value].every((value) => value == null)) return null;
      const validTime = [h1.validTime, h3.validTime, h6.validTime, h12.validTime, h24.validTime]
        .filter((value): value is number => value != null)
        .sort((a, b) => b - a)[0];
      const age = validTime != null ? Math.max(0, referenceTimeMs - validTime) : 0;
      const { localDate } = localDateAndBoundary(referenceTimeMs, utcOffsetSeconds);
      const source: WeatherProvenance = {
        provider: 'NOAA_MRMS',
        source: 'NOAA/NWS MRMS radar-only QPE',
        endpoint: NOAA_MRMS_IMAGE_SERVICE,
        latitude,
        longitude,
        dataKind: 'radar_estimated',
        observationTime: validTime,
        retrievedTime: referenceTimeMs,
        freshness: age <= 75 * 60 * 1000 ? 'current' : 'stale',
        confidence: validTime == null ? 0.8 : age <= 75 * 60 * 1000 ? 0.9 : 0.6,
        completeness: 1,
      };
      return {
        currentOneHourInches: h1.value,
        currentPartialHourInches: null,
        precipitationRateInchesPerHour: null,
        observedDailyPrecipitationInches: null,
        observedDailyIsComplete: false,
        radarPrecipitation1hInches: h1.value,
        radarPrecipitation3hInches: h3.value,
        radarPrecipitation6hInches: h6.value,
        radarPrecipitation12hInches: h12.value,
        radarPrecipitation24hInches: h24.value,
        dataAvailable: true,
        missingHours: [],
        usedHours: [],
        weatherLocalDate: localDate,
        source,
      };
    },
  });
}

async function fetchCustomBackend(
  serviceUrl: string,
  latitude: number,
  longitude: number,
  referenceTimeMs: number,
  utcOffsetSeconds: number,
  fetchJson: FetchJson,
): Promise<MrmsPrecipitation | null> {
  const cacheKey = `${latitude.toFixed(3)},${longitude.toFixed(3)}:${Math.floor(referenceTimeMs / 60000)}`;
  return guardedRequest<MrmsPrecipitation | null>({
    service: 'MRMS',
    key: cacheKey,
    cacheTtlMs: 30 * 1000,
    cacheIf: (value) => value != null,
    execute: async () => {
      const endpoint = `${serviceUrl.replace(/\/$/, '')}/mrms?latitude=${latitude}&longitude=${longitude}&referenceTimeMs=${referenceTimeMs}&utcOffsetSeconds=${utcOffsetSeconds}`;
      const response = await fetchJson(endpoint, { headers: { Accept: 'application/json' } });
      if (response.status === 429) throw createRateLimitError('MRMS', response);
      if (!response.ok) return null;
      const payload: MrmsProviderPayload = await response.json();
      const daily = accumulateMrmsDailyPrecipitation(payload.hourlyBuckets ?? [], referenceTimeMs, utcOffsetSeconds);
      if (!daily.dataAvailable && payload.precipRateMmPerHour == null && payload.currentOneHour?.valueMm == null) return null;
      const source = customBackendSource(payload, latitude, longitude, referenceTimeMs);
      const currentEnd = payload.currentOneHour?.endMs;
      const currentAge = currentEnd ? referenceTimeMs - currentEnd : Number.POSITIVE_INFINITY;
      return {
        currentOneHourInches: payload.currentOneHour?.valueMm != null && currentAge <= 75 * 60 * 1000
          ? mmToInches(payload.currentOneHour.valueMm)
          : null,
        currentPartialHourInches: payload.currentPartialHour?.valueMm != null
          ? mmToInches(payload.currentPartialHour.valueMm)
          : null,
        precipitationRateInchesPerHour: payload.precipRateMmPerHour != null
          ? mmPerHourToInchesPerHour(payload.precipRateMmPerHour)
          : null,
        radarPrecipitation1hInches: payload.currentOneHour?.valueMm != null ? mmToInches(payload.currentOneHour.valueMm) : null,
        ...daily,
        source,
      };
    },
  });
}

export function createHttpMrmsProvider(
  serviceUrl: string | undefined,
  fetchJson: FetchJson = fetch,
): MrmsProvider {
  return {
    async getPrecipitation(latitude, longitude, referenceTimeMs, utcOffsetSeconds) {
      try {
        if (serviceUrl) {
          const custom = await fetchCustomBackend(serviceUrl, latitude, longitude, referenceTimeMs, utcOffsetSeconds, fetchJson);
          if (custom) return custom;
        }
        return await fetchDirectNoaaMrms(latitude, longitude, referenceTimeMs, utcOffsetSeconds, fetchJson);
      } catch (error) {
        console.warn('[MRMS] QPE unavailable:', error instanceof Error ? error.message : String(error));
        return null;
      }
    },
  };
}
