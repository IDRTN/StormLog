import type { WeatherData, WeatherProvenance } from '../../models/types';
import { createRateLimitError, guardedRequest, isRateLimitError } from '../network/requestGuard';

export type FetchJson = typeof fetch;

export interface NwsObservationResult {
  success: boolean;
  data?: WeatherData;
  error?: string;
  fresh?: boolean;
  rateLimited?: boolean;
}

interface NwsStationCandidate {
  stationId: string;
  name: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
}

const OBSERVATION_MAX_AGE_MS = 45 * 60 * 1000;
const MAX_STATIONS_TO_TRY = 8;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (value: number) => value * Math.PI / 180;
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function qualityValue(container: any): number | null {
  const value = container?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function qualityConfidence(container: any): number {
  const control = container?.qualityControl;
  if (control === 'V') return 0.95;
  if (control === 'C') return 0.8;
  if (control === 'S') return 0.65;
  return 0.25;
}

function unitCode(container: any): string {
  return String(container?.unitCode ?? '').toLowerCase();
}

function temperatureF(container: any): number | null {
  const value = qualityValue(container);
  if (value == null) return null;
  const unit = unitCode(container);
  if (unit.includes('degf')) return value;
  if (unit.includes('degc') || !unit) return value * 9 / 5 + 32;
  return null;
}

function speedMph(container: any): number | null {
  const value = qualityValue(container);
  if (value == null) return null;
  const unit = unitCode(container);
  if (unit.includes('mi_h-1') || unit.includes('mph')) return value;
  if (unit.includes('m_s-1')) return value * 2.2369362921;
  if (unit.includes('kt') || unit.includes('knot')) return value * 1.150779448;
  if (unit.includes('km_h-1') || !unit) return value * 0.6213711922;
  return null;
}

function distanceMiles(container: any): number | null {
  const value = qualityValue(container);
  if (value == null) return null;
  const unit = unitCode(container);
  if (unit.includes('mi') && !unit.includes('m_s')) return value;
  if (unit.includes('km')) return value * 0.6213711922;
  if (unit.endsWith(':m') || unit.includes('wmoUnit:m') || !unit) return value * 0.0006213711922;
  return null;
}

function precipitationInches(container: any): number | null {
  const value = qualityValue(container);
  if (value == null) return null;
  const unit = unitCode(container);
  if (unit.includes('in')) return value;
  if (unit.includes('mm')) return value / 25.4;
  if (unit.endsWith(':m') || unit.includes('wmoUnit:m') || !unit) return value * 39.3700787402;
  return null;
}

function pressureValueInHg(container: any): number | null {
  const value = qualityValue(container);
  if (value == null) return null;
  const unit = unitCode(container);
  if (unit.includes('inhg')) return value;
  if (unit.includes('hpa')) return value * 0.0295299830714;
  if (unit.includes('pa') || !unit) return value * 0.000295299830714;
  return null;
}

function choosePressure(properties: any): { value: number | null; sourceContainer: any; kind: string } {
  const candidates = [
    ['sea-level pressure', properties.seaLevelPressure],
    ['altimeter setting', properties.altimeter],
    ['station pressure', properties.barometricPressure],
  ] as const;
  for (const [kind, container] of candidates) {
    const value = pressureValueInHg(container);
    if (value != null) return { value, sourceContainer: container, kind };
  }
  return { value: null, sourceContainer: null, kind: 'unavailable' };
}

function parseStationFeature(feature: any, observerLat: number, observerLon: number): NwsStationCandidate | null {
  const properties = feature?.properties ?? {};
  const coords = feature?.geometry?.coordinates;
  const longitude = Array.isArray(coords) && typeof coords[0] === 'number' ? coords[0] : null;
  const latitude = Array.isArray(coords) && typeof coords[1] === 'number' ? coords[1] : null;
  const stationId = String(
    properties.stationIdentifier
      ?? String(feature?.id ?? '').split('/').filter(Boolean).pop()
      ?? '',
  ).trim();
  if (!stationId || latitude == null || longitude == null) return null;
  return {
    stationId,
    name: String(properties.name ?? stationId),
    latitude,
    longitude,
    distanceKm: haversineKm(observerLat, observerLon, latitude, longitude),
  };
}

async function fetchNearbyStations(
  latitude: number,
  longitude: number,
  fetchJson: FetchJson,
): Promise<NwsStationCandidate[]> {
  const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  return guardedRequest<NwsStationCandidate[]>({
    service: 'NWS station discovery',
    key,
    cacheTtlMs: 10 * 60 * 1000,
    execute: async () => {
      const endpoint = `https://api.weather.gov/points/${latitude},${longitude}/stations`;
      const response = await fetchJson(endpoint, {
        headers: {
          Accept: 'application/geo+json',
          'User-Agent': 'StormLog/1.0 (weather@stormlog.example)',
        },
      });
      if (response.status === 429) throw createRateLimitError('NWS station discovery', response);
      if (!response.ok) throw new Error(`NWS station discovery HTTP ${response.status}`);
      const payload = await response.json();
      const stations = (Array.isArray(payload?.features) ? payload.features : [])
        .map((feature: any) => parseStationFeature(feature, latitude, longitude))
        .filter((station: NwsStationCandidate | null): station is NwsStationCandidate => station != null)
        .sort((a: NwsStationCandidate, b: NwsStationCandidate) => a.distanceKm - b.distanceKm);
      if (!stations.length) throw new Error('NWS returned no observation stations for this location');
      return stations;
    },
  });
}

function provenance(
  station: NwsStationCandidate,
  properties: any,
  referenceTimeMs: number,
  endpoint: string,
): WeatherProvenance {
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
    source: station.name,
    endpoint,
    stationId: station.stationId,
    latitude: station.latitude,
    longitude: station.longitude,
    distanceKm: station.distanceKm,
    dataKind: 'observed',
    observationTime: Number.isFinite(observationTime) ? observationTime : undefined,
    retrievedTime: referenceTimeMs,
    timezone: 'station-local',
    freshness: age >= 0 && age <= OBSERVATION_MAX_AGE_MS ? 'current' : 'stale',
    confidence: Math.min(0.95, available / populated.length),
    completeness: available / populated.length,
  };
}

async function fetchNwsObservation(
  station: NwsStationCandidate,
  referenceTimeMs: number,
  fetchJson: FetchJson,
): Promise<NwsObservationResult> {
  try {
    const endpoint = `https://api.weather.gov/stations/${station.stationId}/observations/latest`;
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

    const source = provenance(station, properties, referenceTimeMs, endpoint);
    if (source.freshness !== 'current') {
      return { success: false, fresh: false, error: `${station.stationId} observation is stale` };
    }

    const pressure = choosePressure(properties);
    const presentWeather = Array.isArray(properties.presentWeather)
      ? properties.presentWeather
          .map((item: any) => [item.intensity, item.weather, item.modifier].filter(Boolean).join(' '))
          .filter(Boolean)
      : [];
    const cloudLayers = Array.isArray(properties.cloudLayers)
      ? properties.cloudLayers.map((layer: any) => ({
          amount: String(layer.amount ?? 'UNKNOWN'),
          baseFeet: qualityValue(layer.base) != null
            ? Math.round((qualityValue(layer.base) as number) * 3.280839895)
            : null,
        }))
      : [];

    const stationPrecip1h = precipitationInches(properties.precipitationLastHour);
    const data: WeatherData = {
      temperature: temperatureF(properties.temperature),
      humidity: qualityValue(properties.relativeHumidity),
      pressure: pressure.value != null ? Math.round(pressure.value * 100) / 100 : null,
      windSpeed: speedMph(properties.windSpeed),
      windDirection: qualityValue(properties.windDirection),
      windGust: speedMph(properties.windGust),
      dewPoint: temperatureF(properties.dewpoint),
      precipitation: stationPrecip1h,
      observedDailyPrecipitation: null,
      stationPrecipitation1h: stationPrecip1h,
      weatherCondition: properties.textDescription ?? null,
      cape: null,
      visibility: distanceMiles(properties.visibility),
      presentWeather,
      cloudLayers,
      currentConditionsSource: source,
      pressureSource: { ...source, source: `${station.name} (${pressure.kind})` },
      stationPrecipitationSource: stationPrecip1h != null ? source : undefined,
      precipitationSource: stationPrecip1h != null ? source : undefined,
      valueSources: [
        { ...source, field: 'temperature', unit: 'degF', confidence: qualityConfidence(properties.temperature) },
        { ...source, field: 'humidity', unit: '%', confidence: qualityConfidence(properties.relativeHumidity) },
        { ...source, field: 'dewPoint', unit: 'degF', confidence: qualityConfidence(properties.dewpoint) },
        { ...source, field: 'windSpeed', unit: 'mph', confidence: qualityConfidence(properties.windSpeed) },
        { ...source, field: 'windGust', unit: 'mph', confidence: qualityConfidence(properties.windGust) },
        { ...source, field: 'pressure', unit: 'inHg', confidence: qualityConfidence(pressure.sourceContainer) },
        { ...source, field: 'visibility', unit: 'mi', confidence: qualityConfidence(properties.visibility) },
        { ...source, field: 'precipitationLastHour', unit: 'in', confidence: qualityConfidence(properties.precipitationLastHour) },
      ],
    };
    return { success: true, fresh: true, data };
  } catch (error: any) {
    if (isRateLimitError(error)) return { success: false, rateLimited: true, error: error.message };
    return { success: false, error: error?.message ?? 'NWS observation request failed' };
  }
}

export async function fetchBestNwsObservation(
  latitude: number,
  longitude: number,
  referenceTimeMs: number,
  fetchJson: FetchJson = fetch,
): Promise<NwsObservationResult> {
  let stations: NwsStationCandidate[];
  try {
    stations = await fetchNearbyStations(latitude, longitude, fetchJson);
  } catch (error: any) {
    if (isRateLimitError(error)) return { success: false, rateLimited: true, error: error.message };
    return { success: false, error: error?.message ?? 'NWS station discovery failed' };
  }

  const errors: string[] = [];
  for (const station of stations.slice(0, MAX_STATIONS_TO_TRY)) {
    const result = await fetchNwsObservation(station, referenceTimeMs, fetchJson);
    if (result.success) return result;
    if (result.rateLimited) return result;
    errors.push(result.error ?? `${station.stationId} unavailable`);
  }
  return {
    success: false,
    fresh: false,
    error: `No fresh usable NWS observation among ${Math.min(stations.length, MAX_STATIONS_TO_TRY)} nearest stations: ${errors.join('; ')}`,
  };
}
