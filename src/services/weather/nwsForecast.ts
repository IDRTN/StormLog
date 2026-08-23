import type { ForecastPeriod, WeatherProvenance } from '../../models/types';

export type FetchJson = typeof fetch;

export interface NwsForecastResult {
  success: boolean;
  periods?: ForecastPeriod[];
  hourlyPeriods?: ForecastPeriod[];
  timezone?: string;
  source?: WeatherProvenance;
  error?: string;
}

const DIRECTIONS: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

function parseNumber(value: any): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseWindSpeedMph(value: any): number | null {
  if (typeof value === 'number') return value;
  const match = typeof value === 'string' ? value.match(/(\d+(?:\.\d+)?)/g) : null;
  if (!match?.length) return null;
  const speeds = match.map(Number);
  return Math.max(...speeds);
}

function mapPeriod(period: any): ForecastPeriod {
  const directionText = String(period.windDirection ?? '').toUpperCase();
  return {
    startTime: Date.parse(period.startTime),
    endTime: Date.parse(period.endTime),
    name: period.name ?? null,
    isDaytime: typeof period.isDaytime === 'boolean' ? period.isDaytime : null,
    temperature: parseNumber(period.temperature),
    temperatureUnit: period.temperatureUnit === 'C' ? 'C' : 'F',
    probabilityOfPrecipitation: parseNumber(period.probabilityOfPrecipitation?.value),
    windSpeedMph: parseWindSpeedMph(period.windSpeed),
    windDirection: DIRECTIONS[directionText] ?? null,
    condition: period.shortForecast ?? null,
  };
}

async function fetchPeriods(url: string, fetchJson: FetchJson): Promise<any[]> {
  const response = await fetchJson(url, {
    headers: {
      Accept: 'application/geo+json',
      'User-Agent': 'StormLog/1.0 (weather@stormlog.example)',
    },
  });
  if (!response.ok) throw new Error(`NWS forecast HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.properties?.periods) ? payload.properties.periods : [];
}

export async function fetchNwsForecast(
  latitude: number,
  longitude: number,
  referenceTimeMs: number,
  fetchJson: FetchJson = fetch,
): Promise<NwsForecastResult> {
  const pointEndpoint = `https://api.weather.gov/points/${latitude},${longitude}`;
  try {
    const response = await fetchJson(pointEndpoint, {
      headers: {
        Accept: 'application/geo+json',
        'User-Agent': 'StormLog/1.0 (weather@stormlog.example)',
      },
    });
    if (!response.ok) return { success: false, error: `NWS point HTTP ${response.status}` };
    const point = await response.json();
    const forecastEndpoint = point?.properties?.forecast;
    const hourlyEndpoint = point?.properties?.forecastHourly;
    const gridId = point?.properties?.gridId;
    const gridX = point?.properties?.gridX;
    const gridY = point?.properties?.gridY;
    if (!forecastEndpoint || !hourlyEndpoint || !gridId || gridX == null || gridY == null) {
      return { success: false, error: 'Incomplete NWS point response' };
    }

    const [periodJson, hourlyJson] = await Promise.all([
      fetchPeriods(forecastEndpoint, fetchJson),
      fetchPeriods(hourlyEndpoint, fetchJson),
    ]);
    const periods = periodJson.map(mapPeriod).filter((period) => Number.isFinite(period.startTime));
    const hourlyPeriods = hourlyJson.map(mapPeriod).filter((period) => Number.isFinite(period.startTime));
    if (!periods.length && !hourlyPeriods.length) {
      return { success: false, error: 'NWS forecast has no periods' };
    }

    return {
      success: true,
      periods,
      hourlyPeriods,
      timezone: point.properties.timezone ?? 'unknown',
      source: {
        provider: 'NWS',
        source: `NWS ${gridId} ${gridX},${gridY}`,
        endpoint: pointEndpoint,
        gridId: `${gridId}/${gridX},${gridY}`,
        latitude,
        longitude,
        observationTime: referenceTimeMs,
        retrievedTime: referenceTimeMs,
        timezone: point.properties.timezone,
        freshness: 'current',
        confidence: 0.9,
        completeness: (periods.length ? 0.5 : 0) + (hourlyPeriods.length ? 0.5 : 0),
      },
    };
  } catch (error: any) {
    return { success: false, error: error?.message ?? 'NWS forecast request failed' };
  }
}
