import type { WeatherData, WeatherProvenance } from '../../models/types';
import {
  celsiusToFahrenheit,
  kmhToMph,
  metersToFeet,
  metersToStatuteMiles,
  pascalToInchesOfMercury,
} from './conversions';
import { createRateLimitError, guardedRequest, isRateLimitError } from '../network/requestGuard';

export const PRIMARY_NWS_STATION = 'KVTA';
export const BACKUP_NWS_STATION = 'KZZV';
const OBSERVATION_MAX_AGE_MS = 90 * 60 * 1000;

const STATION_METADATA: Record<string, { name: string; latitude: number; longitude: number; elevationMeters: number }> = {
  KVTA: { name: 'Newark, Newark Heath Airport', latitude: 40.02278, longitude: -82.4625, elevationMeters: 269.1384 },
  KZZV: { name: 'Zanesville Municipal Airport', latitude: 39.94609, longitude: -81.89315, elevationMeters: 274.32 },
};

export type FetchJson = typeof fetch;

export interface NwsObservationResult {
  success: boolean;
  data?: WeatherData;
  error?: string;
  fresh?: boolean;
  rateLimited?: boolean;
}

function qualityValue(container: any): number | null {
  const value = container?.value;
  return typeof value === 'number' ? value : null;
}

function qualityConfidence(container: any): number {
  const control = container?.qualityControl;
  if (control === 'V') return 0.95;
  if (control === 'C') return 0.8;
  if (control === 'S') return 0.65;
  return 0.25;
}

function pressureInHg(...containers: any[]): number | null {
  for (const container of containers) {
    const value = qualityValue(container);
    if (value != null) return Math.round(pascalToInchesOfMercury(value) * 100) / 100;
  }
  return null;
}

function provenance(
  stationId: string,
  properties: any,
  referenceTimeMs: number,
  endpoint: string,
): WeatherProvenance {
  const metadata = STATION_METADATA[stationId];
  const observationTime = Date.parse(properties.timestamp);
  const age = Number.isFinite(observationTime) ? referenceTimeMs - observationTime : Number.POSITIVE_INFINITY;
  const populated = [
    properties.temperature?.value,
    properties.relativeHumidity?.value,
    properties.dewpoint?.value,
    properties.windSpeed?.value,
    properties.windDirection?.value,
    properties.windGust?.value,
    properties.barometricPressure?.value,
    properties.seaLevelPressure?.value,
    properties.altimeter?.value,
    properties.visibility?.value,
  ];
  const available = populated.filter((value) => typeof value === 'number').length;

  return {
    provider: 'NWS',
    source: metadata?.name ?? stationId,
    endpoint,
    stationId,
    latitude: metadata?.latitude,
    longitude: metadata?.longitude,
    observationTime: Number.isFinite(observationTime) ? observationTime : undefined,
    retrievedTime: referenceTimeMs,
    timezone: 'station-local',
    freshness: age >= 0 && age <= OBSERVATION_MAX_AGE_MS ? 'current' : 'stale',
    confidence: Math.min(0.95, available / populated.length),
    completeness: available / populated.length,
  };
}

export async function fetchNwsObservation(
  stationId: string,
  referenceTimeMs: number,
  fetchJson: FetchJson = fetch,
): Promise<NwsObservationResult> {
  const key = stationId;
  try {
    return await guardedRequest<NwsObservationResult>({
      service: 'NWS observation',
      key,
      cacheTtlMs: 60 * 1000,
      cacheIf: (result) => result.success,
      execute: async () => {
        const endpoint = `https://api.weather.gov/stations/${stationId}/observations/latest`;
        const response = await fetchJson(endpoint, {
          headers: {
            Accept: 'application/geo+json',
            'User-Agent': 'StormLog/1.0 (weather@stormlog.example)',
          },
        });
        if (response.status === 429) throw createRateLimitError('NWS observation', response);
        if (!response.ok) throw new Error(`NWS observation HTTP ${response.status}`);

        const payload = await response.json();
        const properties = payload?.properties;
        if (!properties?.timestamp) throw new Error('Invalid NWS observation response');

        const source = provenance(stationId, properties, referenceTimeMs, endpoint);
        if (source.freshness !== 'current') {
          return { success: false, fresh: false, error: 'NWS observation is stale' };
        }

        const temperatureC = qualityValue(properties.temperature);
        const dewpointC = qualityValue(properties.dewpoint);
        const humidity = qualityValue(properties.relativeHumidity);
        const windSpeedKmh = qualityValue(properties.windSpeed);
        const gustKmh = qualityValue(properties.windGust);
        const visibilityMeters = qualityValue(properties.visibility);
        const pressure = pressureInHg(
          properties.barometricPressure,
          properties.seaLevelPressure,
          properties.altimeter,
        );

        const presentWeather = Array.isArray(properties.presentWeather)
          ? properties.presentWeather
              .map((item: any) => [item.intensity, item.weather, item.modifier].filter(Boolean).join(' '))
              .filter(Boolean)
          : [];
        const cloudLayers = Array.isArray(properties.cloudLayers)
          ? properties.cloudLayers.map((layer: any) => ({
              amount: String(layer.amount ?? 'UNKNOWN'),
              baseFeet: typeof layer.base?.value === 'number' ? Math.round(metersToFeet(layer.base.value)) : null,
            }))
          : [];

        const data: WeatherData = {
          temperature: temperatureC != null ? Math.round(celsiusToFahrenheit(temperatureC) * 10) / 10 : null,
          humidity,
          pressure,
          windSpeed: windSpeedKmh != null ? Math.round(kmhToMph(windSpeedKmh) * 10) / 10 : null,
          windDirection: qualityValue(properties.windDirection),
          windGust: gustKmh != null ? Math.round(kmhToMph(gustKmh) * 10) / 10 : null,
          dewPoint: dewpointC != null ? Math.round(celsiusToFahrenheit(dewpointC) * 10) / 10 : null,
          precipitation: null,
          observedDailyPrecipitation: null,
          weatherCondition: properties.textDescription ?? null,
          cape: null,
          visibility: visibilityMeters != null ? Math.round(metersToStatuteMiles(visibilityMeters) * 10) / 10 : null,
          presentWeather,
          cloudLayers,
          currentConditionsSource: source,
          pressureSource: source,
          utcOffsetSeconds: undefined,
          weatherTimezone: source.timezone,
          valueSources: [
            { ...source, field: 'temperature', unit: 'degF', confidence: qualityConfidence(properties.temperature) },
            { ...source, field: 'humidity', unit: '%', confidence: qualityConfidence(properties.relativeHumidity) },
            { ...source, field: 'dewPoint', unit: 'degF', confidence: qualityConfidence(properties.dewpoint) },
            { ...source, field: 'windSpeed', unit: 'mph', confidence: qualityConfidence(properties.windSpeed) },
            { ...source, field: 'windGust', unit: 'mph', confidence: qualityConfidence(properties.windGust) },
            { ...source, field: 'pressure', unit: 'inHg', confidence: qualityConfidence(properties.barometricPressure) },
            { ...source, field: 'visibility', unit: 'mi', confidence: qualityConfidence(properties.visibility) },
          ],
        };

        return { success: true, fresh: true, data };
      },
    });
  } catch (error: any) {
    if (isRateLimitError(error)) {
      return { success: false, rateLimited: true, error: error.message };
    }
    return { success: false, error: error?.message ?? 'NWS observation request failed' };
  }
}

export async function fetchBestNwsObservation(
  referenceTimeMs: number,
  fetchJson: FetchJson = fetch,
): Promise<NwsObservationResult> {
  const primary = await fetchNwsObservation(PRIMARY_NWS_STATION, referenceTimeMs, fetchJson);
  if (primary.success || primary.rateLimited) return primary;
  return fetchNwsObservation(BACKUP_NWS_STATION, referenceTimeMs, fetchJson);
}
