import type { WeatherData } from '../../models/types';
import type { WeatherResult } from './types';
import { fetchBestNwsObservation, type FetchJson } from './nwsObservations';
import { fetchNwsForecast, type FetchJson as ForecastFetchJson } from './nwsForecast';
import { fetchOpenMeteoSnapshot } from './openMeteo';
import { createHttpMrmsProvider, type MrmsPrecipitation, type MrmsProvider } from './mrms';
import { guardedRequest } from '../network/requestGuard';

export interface WeatherFeatureFlags {
  NWS_CURRENT_CONDITIONS: boolean;
  NWS_PRESSURE: boolean;
  NWS_FORECAST: boolean;
  MRMS_PRECIPITATION: boolean;
}

export const WEATHER_FEATURE_FLAGS = {
  NWS_CURRENT_CONDITIONS: true,
  NWS_PRESSURE: true,
  NWS_FORECAST: true,
  MRMS_PRECIPITATION: true,
} as const satisfies WeatherFeatureFlags;

// Optional custom service can provide exact hourly MRMS buckets. When absent,
// mrms.ts now uses the public NOAA/NWS MRMS QPE ImageServer directly.
const MRMS_SERVICE_URL = process.env.EXPO_PUBLIC_STORMLOG_MRMS_URL;

type ObservationFetchJson = FetchJson & ForecastFetchJson;

export interface StormLogProviderDependencies {
  mrmsProvider?: MrmsProvider;
  fetchJson?: ObservationFetchJson;
  features?: Partial<WeatherFeatureFlags>;
}

function markOpenMeteoModeled(data: WeatherData): WeatherData {
  const source = data.precipitationSource
    ? { ...data.precipitationSource, dataKind: 'modeled' as const }
    : undefined;
  const currentSource = data.currentConditionsSource
    ? { ...data.currentConditionsSource, dataKind: 'modeled' as const }
    : source;
  const pressureSource = data.pressureSource
    ? { ...data.pressureSource, dataKind: 'modeled' as const }
    : undefined;

  return {
    ...data,
    // Open-Meteo hourly forecast-grid precipitation is useful as a fallback,
    // but it is NOT an observed local-day accumulation. Never expose it as one.
    observedDailyPrecipitation: null,
    observedDailyPrecipitationIsComplete: undefined,
    observedDailyPrecipitationPartialHours: undefined,
    precipitationIsComplete: false,
    precipitationSource: source,
    currentConditionsSource: currentSource,
    pressureSource,
  };
}

function mergeWeatherData(
  openMeteo: WeatherData,
  nws: WeatherData,
  features: WeatherFeatureFlags,
): WeatherData {
  const useCurrentConditions = features.NWS_CURRENT_CONDITIONS;
  const usePressure = features.NWS_PRESSURE;
  const merged: WeatherData = {
    ...openMeteo,
    temperature: useCurrentConditions ? nws.temperature ?? openMeteo.temperature : openMeteo.temperature,
    humidity: useCurrentConditions ? nws.humidity ?? openMeteo.humidity : openMeteo.humidity,
    pressure: usePressure ? nws.pressure ?? openMeteo.pressure : openMeteo.pressure,
    windSpeed: useCurrentConditions ? nws.windSpeed ?? openMeteo.windSpeed : openMeteo.windSpeed,
    windDirection: useCurrentConditions ? nws.windDirection ?? openMeteo.windDirection : openMeteo.windDirection,
    windGust: useCurrentConditions ? nws.windGust ?? openMeteo.windGust : openMeteo.windGust,
    dewPoint: useCurrentConditions ? nws.dewPoint ?? openMeteo.dewPoint : openMeteo.dewPoint,
    visibility: useCurrentConditions ? nws.visibility ?? null : undefined,
    presentWeather: useCurrentConditions ? nws.presentWeather ?? [] : undefined,
    cloudLayers: useCurrentConditions ? nws.cloudLayers ?? [] : undefined,
    currentConditionsSource: useCurrentConditions ? nws.currentConditionsSource : openMeteo.currentConditionsSource,
    pressureSource: usePressure ? nws.pressureSource ?? openMeteo.pressureSource : openMeteo.pressureSource,
    stationPrecipitation1h: nws.stationPrecipitation1h ?? null,
    stationPrecipitationSource: nws.stationPrecipitationSource,
    valueSources: [...(nws.valueSources ?? []), ...(openMeteo.valueSources ?? [])],
  };

  if (merged.currentConditionsSource) {
    merged.currentConditionsSource.timezone = openMeteo.weatherTimezone;
    merged.currentConditionsSource.utcOffsetSeconds = openMeteo.utcOffsetSeconds;
  }
  if (merged.pressureSource) {
    merged.pressureSource.timezone = openMeteo.weatherTimezone;
    merged.pressureSource.utcOffsetSeconds = openMeteo.utcOffsetSeconds;
  }
  return merged;
}

function hasUsableCurrentConditions(data: WeatherData | undefined): data is WeatherData {
  if (!data) return false;
  return [data.temperature, data.humidity, data.pressure, data.windSpeed, data.dewPoint]
    .some((value) => typeof value === 'number' && Number.isFinite(value));
}

function providerError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error ?? 'unknown provider error');
}

function selectPartialMrmsAccumulation(
  mrmsResult: MrmsPrecipitation,
  referenceTimeMs: number,
  utcOffsetSeconds: number,
): { value: number; hours: number } | null {
  const localMidnight = Math.floor((referenceTimeMs + utcOffsetSeconds * 1000) / 86400000) * 86400000 - utcOffsetSeconds * 1000;
  const elapsedHours = Math.max(0, (referenceTimeMs - localMidnight) / 3600000);
  const candidates = [
    { hours: 24, value: mrmsResult.radarPrecipitation24hInches },
    { hours: 12, value: mrmsResult.radarPrecipitation12hInches },
    { hours: 6, value: mrmsResult.radarPrecipitation6hInches },
    { hours: 3, value: mrmsResult.radarPrecipitation3hInches },
    { hours: 1, value: mrmsResult.radarPrecipitation1hInches ?? mrmsResult.currentOneHourInches },
  ].filter((candidate): candidate is { hours: number; value: number } =>
    typeof candidate.value === 'number' && Number.isFinite(candidate.value));

  if (!candidates.length) return null;

  // Use the largest rolling window that fits inside the local day so the value
  // updates during rain without pretending that a rolling 24h total is today's
  // midnight-to-now total. Before the first full local hour, a 1h rolling value
  // is still useful as long as the UI marks it partial.
  return candidates.find((candidate) => candidate.hours <= Math.max(1, elapsedHours))
    ?? candidates[candidates.length - 1]
    ?? null;
}

export function createStormLogWeatherProvider(
  dependencies: StormLogProviderDependencies = {},
) {
  const fetchJson = dependencies.fetchJson ?? fetch;
  const features: WeatherFeatureFlags = { ...WEATHER_FEATURE_FLAGS, ...dependencies.features };
  const mrms = dependencies.mrmsProvider ?? createHttpMrmsProvider(MRMS_SERVICE_URL, fetchJson);

  return {
    async getCurrentWeather(
      latitude: number,
      longitude: number,
      explicitReferenceTimeMs?: number,
    ): Promise<WeatherResult> {
      const referenceTimeMs = explicitReferenceTimeMs ?? Date.now();
      try {
        return await guardedRequest<WeatherResult>({
          service: 'Weather refresh',
          key: `${latitude.toFixed(3)},${longitude.toFixed(3)}:${Math.floor(referenceTimeMs / 60000)}`,
          cacheTtlMs: 60 * 1000,
          cacheIf: (result) => result.success,
          execute: async () => {
            const openMeteoPromise = fetchOpenMeteoSnapshot(
              latitude,
              longitude,
              referenceTimeMs,
              fetchJson,
            ).then(
              (value) => ({ success: true as const, value }),
              (error) => ({ success: false as const, error }),
            );

            // Current observations must follow the PHONE location. The NWS helper
            // discovers nearby stations for this point and walks outward until it
            // finds a fresh usable observation.
            const nwsPromise = features.NWS_CURRENT_CONDITIONS || features.NWS_PRESSURE
              ? fetchBestNwsObservation(latitude, longitude, referenceTimeMs, fetchJson)
              : Promise.resolve({ success: false as const, error: 'disabled' });

            const forecastPromise = features.NWS_FORECAST
              ? fetchNwsForecast(latitude, longitude, referenceTimeMs, fetchJson)
              : Promise.resolve({ success: false as const, error: 'disabled' });

            const [openMeteoResult, nwsResult, forecastResult] = await Promise.all([
              openMeteoPromise,
              nwsPromise,
              forecastPromise,
            ]);

            let weatherData: WeatherData | null = null;
            let openMeteoAvailable = false;

            if (openMeteoResult.success) {
              weatherData = markOpenMeteoModeled(openMeteoResult.value.data);
              openMeteoAvailable = true;
            }

            if (nwsResult.success && hasUsableCurrentConditions(nwsResult.data)) {
              weatherData = weatherData
                ? mergeWeatherData(weatherData, nwsResult.data, features)
                : {
                    ...nwsResult.data,
                    referenceTimeMs,
                    weatherTimezone: forecastResult.success
                      ? forecastResult.timezone ?? nwsResult.data.weatherTimezone
                      : nwsResult.data.weatherTimezone,
                  };
            }

            if (!weatherData) {
              const openError = openMeteoResult.success
                ? 'Open-Meteo returned no usable weather data'
                : providerError(openMeteoResult.error);
              const nwsError = nwsResult.error ?? 'NWS observation unavailable';
              return {
                success: false,
                error: `Weather sources unavailable — Open-Meteo: ${openError}; NWS: ${nwsError}`,
                noConnection: /network|fetch|timeout|connection/i.test(`${openError} ${nwsError}`),
              };
            }

            if (forecastResult.success && forecastResult.source) {
              weatherData.forecast = {
                periods: forecastResult.periods ?? [],
                hourlyPeriods: forecastResult.hourlyPeriods ?? [],
                timezone: forecastResult.timezone ?? weatherData.weatherTimezone ?? 'unknown',
                utcOffsetSeconds: weatherData.utcOffsetSeconds ?? 0,
                source: forecastResult.source,
              };
              weatherData.forecastSource = forecastResult.source;
            }

            if (features.MRMS_PRECIPITATION && openMeteoAvailable) {
              try {
                const utcOffsetSeconds = weatherData.utcOffsetSeconds ?? 0;
                const mrmsResult = await mrms.getPrecipitation(
                  latitude,
                  longitude,
                  referenceTimeMs,
                  utcOffsetSeconds,
                );

                if (mrmsResult && mrmsResult.source.freshness !== 'stale') {
                  weatherData.precipitation = mrmsResult.currentOneHourInches;
                  weatherData.radarPrecipitation1h = mrmsResult.radarPrecipitation1hInches ?? mrmsResult.currentOneHourInches;
                  weatherData.radarPrecipitation3h = mrmsResult.radarPrecipitation3hInches ?? null;
                  weatherData.radarPrecipitation6h = mrmsResult.radarPrecipitation6hInches ?? null;
                  weatherData.radarPrecipitation12h = mrmsResult.radarPrecipitation12hInches ?? null;
                  weatherData.radarPrecipitation24h = mrmsResult.radarPrecipitation24hInches ?? null;
                  weatherData.precipitationRateInchesPerHour = mrmsResult.precipitationRateInchesPerHour;
                  weatherData.currentPartialHourPrecipitation = mrmsResult.currentPartialHourInches;
                  weatherData.precipitationSource = mrmsResult.source;

                  // A complete midnight-to-now accumulation remains preferred.
                  // When direct NOAA MRMS only supplies rolling products, retain
                  // the best measured rolling accumulation as an explicitly
                  // partial value instead of erasing it and rendering --".
                  if (mrmsResult.observedDailyIsComplete && mrmsResult.observedDailyPrecipitationInches != null) {
                    weatherData.observedDailyPrecipitation = mrmsResult.observedDailyPrecipitationInches;
                    weatherData.observedDailyPrecipitationIsComplete = true;
                    weatherData.observedDailyPrecipitationPartialHours = undefined;
                    weatherData.precipitationIsComplete = true;
                  } else {
                    const partial = selectPartialMrmsAccumulation(mrmsResult, referenceTimeMs, utcOffsetSeconds);
                    weatherData.observedDailyPrecipitation = partial?.value ?? null;
                    weatherData.observedDailyPrecipitationIsComplete = false;
                    weatherData.observedDailyPrecipitationPartialHours = partial?.hours;
                    weatherData.precipitationIsComplete = false;
                  }

                  if (mrmsResult.precipitationRateInchesPerHour != null) {
                    weatherData.rainRateSource = mrmsResult.source;
                  }
                }
              } catch (error) {
                console.warn('[WEATHER] MRMS unavailable; preserving lower-tier precipitation data:', providerError(error));
              }
            }

            // If MRMS is unavailable, prefer an actual nearby station's 1-hour
            // gauge report to the model grid only when the station is reasonably
            // close. The provenance keeps that distance visible to the UI.
            if (weatherData.precipitationSource?.provider !== 'NOAA_MRMS'
              && weatherData.stationPrecipitation1h != null
              && (weatherData.stationPrecipitationSource?.distanceKm ?? Number.POSITIVE_INFINITY) <= 25) {
              weatherData.precipitation = weatherData.stationPrecipitation1h;
              weatherData.precipitationSource = weatherData.stationPrecipitationSource;
            }

            if (!openMeteoAvailable) {
              console.warn('[WEATHER] Open-Meteo unavailable; using degraded NWS-only weather data');
            }
            if (!nwsResult.success) {
              console.warn('[WEATHER] NWS observation unavailable; using modeled Open-Meteo current conditions');
            }
            if (!forecastResult.success) {
              console.warn('[WEATHER] NWS forecast unavailable; current conditions remain usable');
            }

            return { success: true, data: weatherData };
          },
        });
      } catch (error: any) {
        const message = error?.message || String(error);
        const noConnection = /network|fetch|timeout|connection/i.test(message);
        return {
          success: false,
          error: noConnection ? 'No internet connection' : `Weather fetch failed: ${message}`,
          noConnection,
        };
      }
    },
  };
}
