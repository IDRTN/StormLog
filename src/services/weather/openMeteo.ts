import type { WeatherProvider, WeatherResult } from './types';
import type { ForecastPeriod, WeatherData, WeatherProvenance } from '../../models/types';
import { getLocalDateString } from '../../util/dateUtils';
import { createRateLimitError, guardedRequest } from '../network/requestGuard';

const WMO_CODES: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  56: 'Freezing drizzle', 57: 'Dense freezing drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Heavy freezing rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
  85: 'Slight snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail',
};

function calculateDewPoint(tempF: number, humidity: number): number | null {
  if (humidity <= 0 || humidity > 100) return null;
  const tempC = (tempF - 32) * (5 / 9);
  const a = 17.27, b = 237.7;
  const alpha = (a * tempC) / (b + tempC) + Math.log(humidity / 100);
  const dewC = (b * alpha) / (a - alpha);
  return dewC * (9 / 5) + 32;
}

/**
 * Get the current date and hour in the weather location's local timezone.
 *
 * Uses utc_offset_seconds from the API response to compute the correct
 * local time at the observation coordinates, NOT the device timezone.
 */
function getWeatherLocationDateTime(utcOffsetSeconds: number, referenceTimeMs?: number): {
  dateString: string;
  hour: number;
} {
  // Use explicit reference time (no hidden Date.now())
  // Deterministic: requires explicit referenceTimeMs
  if (referenceTimeMs == null) {
    throw new Error('referenceTimeMs is required for deterministic precipitation calculation');
  }
  const utcMs = referenceTimeMs;
  const localMs = utcMs + utcOffsetSeconds * 1000;
  // Create a Date from that adjusted timestamp (in UTC terms)
  const localDate = new Date(localMs);

  // Extract components using UTC getters (since we already adjusted)
  const year = localDate.getUTCFullYear();
  const month = String(localDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(localDate.getUTCDate()).padStart(2, '0');
  const hour = localDate.getUTCHours();

  return {
    dateString: `${year}-${month}-${day}`,
    hour,
  };
}

export interface PrecipitationSumResult {
  total: number;
  hourlyValuesUsed: { time: string; value: number }[];
  nullValuesSkipped: { time: string }[];
  isComplete: boolean;
  weatherLocalDate: string;
  weatherLocalHour: number;
}

export interface OpenMeteoSnapshot {
  data: WeatherData;
  payload: any;
}

function provenance(
  latitude: number,
  longitude: number,
  referenceTimeMs: number,
  timezone: string,
  utcOffsetSeconds: number,
): WeatherProvenance {
  return {
    provider: 'OPEN_METEO',
    source: 'Open-Meteo forecast grid',
    endpoint: 'https://api.open-meteo.com/v1/forecast',
    latitude,
    longitude,
    observationTime: referenceTimeMs,
    retrievedTime: referenceTimeMs,
    timezone,
    utcOffsetSeconds,
    freshness: 'current',
    confidence: 0.7,
    completeness: 0.9,
  };
}

function wmoCondition(code: unknown): string | null {
  return typeof code === 'number' && WMO_CODES[code] != null ? WMO_CODES[code] : null;
}

function buildOpenMeteoForecast(payload: any, source: WeatherProvenance): import('../../models/types').ForecastData | undefined {
  const hourlyTimes: string[] = payload.hourly?.time ?? [];
  const dailyTimes: string[] = payload.daily?.time ?? [];
  if (!hourlyTimes.length && !dailyTimes.length) return undefined;

  const periods: ForecastPeriod[] = dailyTimes.slice(0, 7).map((time, index) => ({
    startTime: Date.parse(`${time}T00:00:00Z`) - (payload.utc_offset_seconds ?? 0) * 1000,
    endTime: Date.parse(`${time}T00:00:00Z`) - (payload.utc_offset_seconds ?? 0) * 1000 + 86400000,
    name: time,
    isDaytime: null,
    temperature: payload.daily?.temperature_2m_max?.[index] ?? null,
    temperatureUnit: 'F',
    probabilityOfPrecipitation: payload.daily?.precipitation_probability_max?.[index] ?? null,
    windSpeedMph: payload.daily?.wind_speed_10m_max?.[index] ?? null,
    windDirection: payload.daily?.wind_direction_10m_dominant?.[index] ?? null,
    condition: wmoCondition(payload.daily?.weather_code?.[index]),
  }));

  const currentTimeIndex = Math.max(0, hourlyTimes.findIndex((time) => Date.parse(`${time}:00Z`) - source.utcOffsetSeconds! * 1000 >= source.observationTime!));
  const hourlyPeriods: ForecastPeriod[] = hourlyTimes.slice(currentTimeIndex, currentTimeIndex + 24).map((time, index) => {
    const absoluteIndex = currentTimeIndex + index;
    return {
      startTime: Date.parse(`${time}:00Z`),
      endTime: Date.parse(`${time}:00Z`) + 3600000,
      name: null,
      isDaytime: null,
      temperature: payload.hourly?.temperature_2m?.[absoluteIndex] ?? null,
      temperatureUnit: 'F',
      probabilityOfPrecipitation: payload.hourly?.precipitation_probability?.[absoluteIndex] ?? null,
      windSpeedMph: null,
      windDirection: null,
      condition: wmoCondition(payload.hourly?.weather_code?.[absoluteIndex]),
    };
  });

  return { periods, hourlyPeriods, timezone: source.timezone ?? 'unknown', utcOffsetSeconds: source.utcOffsetSeconds ?? 0, source };
}

export async function fetchOpenMeteoSnapshot(
  latitude: number,
  longitude: number,
  referenceTimeMs: number,
  fetchJson: typeof fetch = fetch,
): Promise<OpenMeteoSnapshot> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${latitude}&longitude=${longitude}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,precipitation,surface_pressure,pressure_msl` +
    `&hourly=precipitation,cape,temperature_2m,precipitation_probability,weather_code` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant` +
    `&past_days=1&forecast_days=8` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` +
    `&timezone=auto`;
  const cacheKey = `${latitude.toFixed(3)},${longitude.toFixed(3)},${Math.floor(referenceTimeMs / 60000)}`;

  return guardedRequest<OpenMeteoSnapshot>({
    service: 'Open-Meteo',
    key: cacheKey,
    cacheTtlMs: 60 * 1000,
    execute: async () => {
      const response = await fetchJson(url);
      if (response.status === 429) throw createRateLimitError('Open-Meteo', response);
      if (!response.ok) throw new Error(`Weather API error: ${response.status}`);
      const payload = await response.json();
      const current = payload.current;
      if (!current) throw new Error('Invalid weather API response');

      const utcOffsetSeconds = payload.utc_offset_seconds ?? 0;
      const apiTimezone = payload.timezone ?? 'unknown';
      const source = provenance(latitude, longitude, referenceTimeMs, apiTimezone, utcOffsetSeconds);
      const hourlyTimes: string[] = payload.hourly?.time ?? [];
      const hourlyPrecip: (number | null)[] = payload.hourly?.precipitation ?? [];
      const hourlyCape: (number | null)[] = payload.hourly?.cape ?? [];

      let observedDailyPrecip: number | null = null;
      let observedDailyComplete = false;
      let observedDailyPartialHours = 0;
      if (hourlyTimes.length > 0 && hourlyPrecip.length > 0) {
        const result = calculateObservedDailyPrecip(hourlyTimes, hourlyPrecip, utcOffsetSeconds, referenceTimeMs);
        observedDailyPrecip = result.total;
        observedDailyComplete = result.isComplete;
        observedDailyPartialHours = result.nullValuesSkipped.length;
      }

      const mslPressurePa = current.pressure_msl ?? null;
      const pressureHpa = mslPressurePa ?? current.surface_pressure ?? null;
      const pressureInHg = pressureHpa != null ? pressureHpa * 0.02953 : null;
      const temp = current.temperature_2m ?? null;
      const humidity = current.relative_humidity_2m ?? null;
      const dewPoint = temp != null && humidity != null ? calculateDewPoint(temp, humidity) : null;
      const cape = getCurrentHourCape(hourlyTimes, hourlyCape, utcOffsetSeconds, referenceTimeMs);
      const forecast = buildOpenMeteoForecast(payload, source);

      return {
        payload,
        data: {
          temperature: temp,
          humidity,
          pressure: pressureInHg != null ? Math.round(pressureInHg * 100) / 100 : null,
          windSpeed: current.wind_speed_10m ?? null,
          windDirection: current.wind_direction_10m ?? null,
          windGust: current.wind_gusts_10m ?? null,
          dewPoint: dewPoint != null ? Math.round(dewPoint * 10) / 10 : null,
          precipitation: current.precipitation ?? null,
          observedDailyPrecipitation: observedDailyPrecip,
          observedDailyPrecipitationIsComplete: observedDailyPrecip == null ? undefined : observedDailyComplete,
          observedDailyPrecipitationPartialHours: observedDailyPartialHours,
          weatherCondition: WMO_CODES[current.weather_code] ?? `Unknown (${current.weather_code})`,
          cape,
          utcOffsetSeconds,
          weatherTimezone: apiTimezone,
          referenceTimeMs,
          pressureSource: source,
          precipitationSource: source,
          capeSource: source,
          forecastSource: source,
          forecast,
        },
      };
    },
  });
}

/**
 * Calculate observed accumulated precipitation for the weather-location's
 * local calendar day by summing hourly values from midnight through
 * the current hour at the observation location.
 *
 * NULL HANDLING: Null precipitation values are tracked separately and
 * NOT included in the sum. A null means "measurement unavailable," not "no rain."
 * If any values are null, the total is still calculated from available data,
 * but `isComplete` reflects whether we had full coverage.
 *
 * UNITS: API is requested with precipitation_unit=inch, so all values
 * are already in inches. No additional conversion needed.
 */
export function calculateObservedDailyPrecip(
  hourlyTimes: string[],
  hourlyPrecip: (number | null)[],
  utcOffsetSeconds: number,
  referenceTimeMs?: number,
): PrecipitationSumResult {
  const { dateString: weatherLocalDate, hour: weatherLocalHour } =
    getWeatherLocationDateTime(utcOffsetSeconds, referenceTimeMs);

  let total = 0;
  let foundCurrentHour = false;
  const hourlyValuesUsed: { time: string; value: number }[] = [];
  const nullValuesSkipped: { time: string }[] = [];

  for (let i = 0; i < hourlyTimes.length; i++) {
    const timeStr = hourlyTimes[i];
    if (!timeStr || timeStr.length < 13) continue;

    const datePart = timeStr.substring(0, 10);
    const hourPart = parseInt(timeStr.substring(11, 13), 10);

    if (datePart === weatherLocalDate && hourPart <= weatherLocalHour) {
      const precipVal = hourlyPrecip[i];

      if (precipVal != null && typeof precipVal === 'number') {
        total += precipVal;
        hourlyValuesUsed.push({ time: timeStr, value: precipVal });
      } else {
        nullValuesSkipped.push({ time: timeStr });
      }

      if (hourPart === weatherLocalHour) foundCurrentHour = true;
    }
  }
  
  const expectedHours = weatherLocalHour + 1;
  const isComplete = hourlyValuesUsed.length >= expectedHours && foundCurrentHour;

  console.log(
    `[PRECIP] Weather-local date=${weatherLocalDate}, hour=${weatherLocalHour}\n` +
    `[PRECIP] Hours summed: ${hourlyValuesUsed.length}, nulls skipped: ${nullValuesSkipped.length}\n` +
    `[PRECIP] Values: [${hourlyValuesUsed.map(h => `${h.time.substring(11)}=${h.value.toFixed(2)}"`).join(', ')}]\n` +
    (nullValuesSkipped.length > 0
      ? `[PRECIP] Null hours: [${nullValuesSkipped.map(n => n.time.substring(11)).join(', ')}]\n`
      : '') +
    `[PRECIP] Total=${total.toFixed(4)}", currentHourFound=${foundCurrentHour}`
  );

  return {
    total: Math.round(total * 100) / 100,
    hourlyValuesUsed,
    nullValuesSkipped,
    isComplete,
    weatherLocalDate,
    weatherLocalHour,
  };
}

function getCurrentHourCape(
  hourlyTimes: string[],
  hourlyCape: (number | null)[],
  utcOffsetSeconds: number,
  referenceTimeMs?: number
): number | null {
  const { dateString: weatherLocalDate, hour: weatherLocalHour } =
    getWeatherLocationDateTime(utcOffsetSeconds, referenceTimeMs);

  for (let i = 0; i < hourlyTimes.length; i++) {
    const timeStr = hourlyTimes[i];
    if (!timeStr || timeStr.length < 13) continue;
    const datePart = timeStr.substring(0, 10);
    const hourPart = parseInt(timeStr.substring(11, 13), 10);
    if (datePart === weatherLocalDate && hourPart === weatherLocalHour) {
      return hourlyCape[i] ?? null;
    }
  }

  for (let i = 0; i < hourlyTimes.length; i++) {
    const timeStr = hourlyTimes[i];
    if (!timeStr || timeStr.length < 13) continue;
    const datePart = timeStr.substring(0, 10);
    const hourPart = parseInt(timeStr.substring(11, 13), 10);
    if (datePart === weatherLocalDate && hourPart <= weatherLocalHour) {
      const capeVal = hourlyCape[i];
      if (capeVal != null && capeVal >= 0) return capeVal;
    }
  }

  return null;
}

export function createOpenMeteoProvider(): WeatherProvider {
  return {
    async getCurrentWeather(latitude: number, longitude: number): Promise<WeatherResult> {
        const referenceTimeMs = Date.now();
      try {
        const snapshot = await fetchOpenMeteoSnapshot(latitude, longitude, referenceTimeMs);
        return { success: true, data: snapshot.data };
      } catch (error: any) {
        const msg = error?.message || String(error);
        const noConnection = msg.includes('Network') || msg.includes('fetch') || msg.includes('timeout');
        return {
          success: false,
          error: noConnection ? 'No internet connection' : `Weather fetch failed: ${msg}`,
          noConnection,
        };
      }
    },
  };
}
