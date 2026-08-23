import type { WeatherData } from '../../models/types';
import type { WeatherResult } from './types';
import { fetchBestNwsObservation, type FetchJson } from './nwsObservations';
import { fetchNwsForecast, type FetchJson as ForecastFetchJson } from './nwsForecast';
import { fetchOpenMeteoSnapshot } from './openMeteo';
import { createHttpMrmsProvider, type MrmsProvider } from './mrms';

export const WEATHER_FEATURE_FLAGS = {
  NWS_CURRENT_CONDITIONS: true,
  NWS_PRESSURE: true,
  NWS_FORECAST: true,
  MRMS_PRECIPITATION: true,
} as const;

const MRMS_SERVICE_URL = process.env.EXPO_PUBLIC_STORMLOG_MRMS_URL;

type ObservationFetchJson = FetchJson & ForecastFetchJson;

export interface StormLogProviderDependencies {
  mrmsProvider?: MrmsProvider;
  fetchJson?: ObservationFetchJson;
  features?: Partial<typeof WEATHER_FEATURE_FLAGS>;
}

function mergeWeatherData(
  openMeteo: WeatherData,
  nws: WeatherData,
): WeatherData {
  const useCurrentConditions = WEATHER_FEATURE_FLAGS.NWS_CURRENT_CONDITIONS;
  const usePressure = WEATHER_FEATURE_FLAGS.NWS_PRESSURE;
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
    currentConditionsSource: useCurrentConditions ? nws.currentConditionsSource : undefined,
    pressureSource: usePressure ? nws.pressureSource : openMeteo.pressureSource,
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

export function createStormLogWeatherProvider(
  dependencies: StormLogProviderDependencies = {},
) {
  const fetchJson = dependencies.fetchJson ?? fetch;
  const features = { ...WEATHER_FEATURE_FLAGS, ...dependencies.features };
  const mrms = dependencies.mrmsProvider ?? createHttpMrmsProvider(MRMS_SERVICE_URL, fetchJson);

  return {
    async getCurrentWeather(
      latitude: number,
      longitude: number,
      explicitReferenceTimeMs?: number,
    ): Promise<WeatherResult> {
      const referenceTimeMs = explicitReferenceTimeMs ?? Date.now();
      try {
        const openMeteoResult = await fetchOpenMeteoSnapshot(
          latitude,
          longitude,
          referenceTimeMs,
          fetchJson,
        );
        const utcOffsetSeconds = openMeteoResult.data.utcOffsetSeconds ?? 0;
        const [nwsResult, forecastResult, mrmsResult] = await Promise.all([
          features.NWS_CURRENT_CONDITIONS || features.NWS_PRESSURE
            ? fetchBestNwsObservation(referenceTimeMs, fetchJson)
            : Promise.resolve({ success: false as const, error: 'disabled' }),
          features.NWS_FORECAST
            ? fetchNwsForecast(latitude, longitude, referenceTimeMs, fetchJson)
            : Promise.resolve({ success: false as const, error: 'disabled' }),
          features.MRMS_PRECIPITATION
            ? mrms.getPrecipitation(latitude, longitude, referenceTimeMs, utcOffsetSeconds)
            : Promise.resolve(null),
        ]);

        let weatherData = openMeteoResult.data;
        if (nwsResult.success && nwsResult.data) weatherData = mergeWeatherData(weatherData, nwsResult.data);

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

        return { success: true, data: weatherData };
      } catch (error: any) {
        const message = error?.message || String(error);
        const noConnection = message.includes('Network') || message.includes('fetch') || message.includes('timeout');
        return {
          success: false,
          error: noConnection ? 'No internet connection' : `Weather fetch failed: ${message}`,
          noConnection,
        };
      }
    },
  };
}
