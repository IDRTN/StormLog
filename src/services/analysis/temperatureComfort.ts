import { calculateHeatIndex, type HeatIndexCategory } from './heatIndex';

export type FeelsLikeMethod = 'HEAT_INDEX' | 'WIND_CHILL' | 'AIR_TEMPERATURE' | 'UNAVAILABLE';

export interface TemperatureComfortResult {
  feelsLikeF: number | null;
  method: FeelsLikeMethod;
  heatIndexF: number | null;
  heatIndexCategory: HeatIndexCategory | null;
  heatIndexDescription: string;
  windChillF: number | null;
  windChillDescription: string;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function calculateWindChill(
  temperatureF: number | null,
  windSpeedMph: number | null,
): { windChillF: number | null; description: string } {
  if (!Number.isFinite(temperatureF) || !Number.isFinite(windSpeedMph)) {
    return {
      windChillF: null,
      description: 'Wind chill unavailable — temperature and wind speed are required',
    };
  }

  const t = temperatureF as number;
  const v = windSpeedMph as number;
  if (t > 50 || v <= 3) {
    return {
      windChillF: null,
      description: 'Wind chill not applicable — requires 50°F or colder and wind above 3 mph',
    };
  }

  const v16 = Math.pow(v, 0.16);
  const wc = 35.74 + 0.6215 * t - 35.75 * v16 + 0.4275 * t * v16;
  const rounded = round1(wc);
  return {
    windChillF: rounded,
    description: `Wind chill ${rounded.toFixed(1)}°F`,
  };
}

export function calculateTemperatureComfort(
  temperatureF: number | null,
  relativeHumidity: number | null,
  windSpeedMph: number | null,
): TemperatureComfortResult {
  if (!Number.isFinite(temperatureF)) {
    return {
      feelsLikeF: null,
      method: 'UNAVAILABLE',
      heatIndexF: null,
      heatIndexCategory: null,
      heatIndexDescription: 'Heat index unavailable — temperature is required',
      windChillF: null,
      windChillDescription: 'Wind chill unavailable — temperature is required',
    };
  }

  const heat = calculateHeatIndex(temperatureF, relativeHumidity);
  const windChill = calculateWindChill(temperatureF, windSpeedMph);

  if (heat.heatIndexF != null) {
    return {
      feelsLikeF: heat.heatIndexF,
      method: 'HEAT_INDEX',
      heatIndexF: heat.heatIndexF,
      heatIndexCategory: heat.category,
      heatIndexDescription: heat.description,
      windChillF: windChill.windChillF,
      windChillDescription: windChill.description,
    };
  }

  if (windChill.windChillF != null) {
    return {
      feelsLikeF: windChill.windChillF,
      method: 'WIND_CHILL',
      heatIndexF: null,
      heatIndexCategory: null,
      heatIndexDescription: heat.description,
      windChillF: windChill.windChillF,
      windChillDescription: windChill.description,
    };
  }

  return {
    feelsLikeF: round1(temperatureF as number),
    method: 'AIR_TEMPERATURE',
    heatIndexF: null,
    heatIndexCategory: null,
    heatIndexDescription: heat.description,
    windChillF: null,
    windChillDescription: windChill.description,
  };
}
