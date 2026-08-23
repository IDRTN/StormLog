import type { WeatherData } from '../../models/types';

export interface WeatherProvider {
  getCurrentWeather(latitude: number, longitude: number): Promise<WeatherResult>;
}

export type WeatherResult =
  | { success: true; data: WeatherData }
  | { success: false; error: string; noConnection?: boolean };
