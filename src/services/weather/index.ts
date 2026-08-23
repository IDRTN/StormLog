import type { WeatherProvider, WeatherResult } from './types';
import { createOpenMeteoProvider } from './openMeteo';
import { createStormLogWeatherProvider } from './stormLogProvider';

export type { WeatherProvider, WeatherResult };

let provider: WeatherProvider | null = null;

export function getWeatherProvider(): WeatherProvider {
  if (!provider) {
    provider = createStormLogWeatherProvider() as WeatherProvider;
  }
  return provider;
}

export async function fetchWeather(
  latitude: number,
  longitude: number
): Promise<WeatherResult> {
  return getWeatherProvider().getCurrentWeather(latitude, longitude);
}
