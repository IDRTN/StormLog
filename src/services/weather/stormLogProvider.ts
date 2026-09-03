import type { WeatherData } from '../../models/types';
import type { WeatherResult } from './types';
import { fetchBestNwsObservation, type FetchJson } from './nwsObservations';
import { fetchNwsForecast, type FetchJson as ForecastFetchJson } from './nwsForecast';
import { fetchOpenMeteoSnapshot } from './openMeteo';
import { createHttpMrmsProvider, type MrmsProvider } from './mrms';
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

const MRMS_SERVICE_URL = process.env.EXPO_PUBLIC_STORMLOG_MRMS_URL;

type ObservationFetchJson = FetchJson & ForecastFetchJson;

export interface StormLogProviderDependencies {
  mrmsProvider?: MrmsProvider;
  fetchJson?: ObservationFetchJson;
  features?: Partial<WeatherFeatureFlags>;
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
  return [
    data.temperature,
    data.humidity,
    data.pressure,
    data.windSpeed,
    data.dewPoint,
  ].some((value) => typeof value === 'number' && Number.isFinite(value));
}

function providerError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error ?? 'unknown provider error');
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
            // Provider isolation is intentional. A malformed or unavailable response
            // from one upstream source must not erase valid data from another source.
            const openMeteoPromise = fetchOpenMeteoSnapshot(
              latitude,
              longitude,
              referenceTimeMs,
              fetchJson,
            ).then(
              (value) => ({ success: true as const, value }),
              (error) => ({ success: false as const, error }),
            );

            const nwsPromise = features.NWS_CURRENT_CONDITIONS || features.NWS_PRESSURE
              ? fetchBestNwsObservation(referenceTimeMs, fetchJson)
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
              weatherData = openMeteoResult.value.data;
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

            // MRMS daily accumulation depends on the weather-location UTC offset.
            // If Open-Meteo is unavailable, skip MRMS instead of guessing an offset.
            if (features.MRMS_PRECIPITATION && openMeteoAvailable) {
              try {
                const utcOffsetSeconds = weatherData.utcOffsetSeconds ?? 0;
                const mrmsResult = await mrms.getPrecipitation(
                  latitude,
                  longitude,
                  referenceTimeMs,
                  utcOffsetSeconds,
                );

                if (mrmsResult) {
                  weatherData.precipitation = mrmsResult.currentOneHourInches;
                  weatherData.precipitationRateInchesPerHour = mrmsResult.precipitationRateInchesPerHour;
                  weatherData.observedDailyPrecipitation = mrmsResult.observedDailyPrecipitationInches;
                  weatherData.observedDailyPrecipitationIsComplete = mrmsResult.observedDailyIsComplete;
                  weatherData.precipitationIsComplete = mrmsResult.observedDailyIsComplete;
                  weatherData.currentPartialHourPrecipitation = mrmsResult.currentPartialHourInches;
                  weatherData.precipitationSource = mrmsResult.source;
                  if (mrmsResult.precipitationRateInchesPerHour != null) {
                    weatherData.rainRateSource = mrmsResult.source;
                  }
                }
              } catch (error) {
                console.warn('[WEATHER] MRMS unavailable; preserving other weather data:', providerError(error));
              }
            }

            if (!openMeteoAvailable) {
              console.warn('[WEATHER] Open-Meteo unavailable; using degraded NWS-only weather data');
            }
            if (!nwsResult.success) {
              console.warn('[WEATHER] NWS observation unavailable; using Open-Meteo current conditions');
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
