export interface StormEvent {
  id: number;
  startTime: number;
  endTime: number | null;
  startLatitude: number;
  startLongitude: number;
  endLatitude: number | null;
  endLongitude: number | null;
  eventName: string;
  notes: string;
}

export interface WeatherObservation {
  id: number;
  timestamp: number;
  latitude: number;
  longitude: number;
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  windGust: number | null;
  dewPoint: number | null;
  precipitation: number | null;
  weatherCondition: string | null;
  stormEventId: number;
}

export interface DailyWeatherRecord {
  id: number;
  timestamp: number;
  latitude: number;
  longitude: number;
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  windGust: number | null;
  dewPoint: number | null;
  precipitation: number | null;
  weatherCondition: string | null;
  nwsAlerts: string | null;
  provider?: string | null;
  product?: string | null;
  stationId?: string | null;
  gridId?: string | null;
  observationTime?: number | null;
  retrievedTime?: number | null;
  confidence?: number | null;
  completeness?: number | null;
}

export interface DailySummary {
  date: string;
  highTemp: number | null;
  lowTemp: number | null;
  avgTemp: number | null;
  maxWind: number | null;
  maxGust: number | null;
  avgHumidity: number | null;
  minPressure: number | null;
  maxPressure: number | null;
  totalPrecip: number | null;
  observationCount: number;
  alertCount: number;
  alertTypes: string[];
}

export type WeatherProviderName = 'NWS' | 'NOAA_MRMS' | 'OPEN_METEO' | 'RAINVIEWER' | 'UNKNOWN';
export type WeatherFreshness = 'current' | 'stale' | 'unavailable';

export interface WeatherProvenance {
  provider: WeatherProviderName;
  source: string;
  endpoint?: string;
  stationId?: string;
  gridId?: string;
  latitude?: number;
  longitude?: number;
  observationTime?: number;
  retrievedTime: number;
  timezone?: string;
  utcOffsetSeconds?: number;
  freshness: WeatherFreshness;
  confidence: number;
  completeness: number;
}

export interface FieldProvenance extends WeatherProvenance {
  field: string;
  unit?: string;
}

export interface WeatherData {
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  windGust: number | null;
  dewPoint: number | null;
  /**
   * Current precipitation — what Open-Meteo reports as "current.precipitation".
   * This is precipitation in the preceding hour. Useful for the main weather
   * display to show "is it raining right now?"
   */
  precipitation: number | null;
  /**
   * Observed accumulated precipitation for the current local calendar day.
   * Calculated by summing hourly precipitation values from local midnight
   * through the most recent hour. This is the value stored in daily records
   * and displayed in the Daily Log.
   */
  observedDailyPrecipitation: number | null;
  precipitationRateInchesPerHour?: number | null;
  /** True when all expected hourly observations were available */
  precipitationIsComplete?: boolean;
  /** Weather-location UTC offset at observation time (seconds) */
  utcOffsetSeconds?: number;
  /** Weather-location timezone identifier from API (e.g., 'America/New_York') */
  weatherTimezone?: string;
  weatherCondition: string | null;
  visibility?: number | null;
  presentWeather?: string[];
  cloudLayers?: { amount: string; baseFeet: number | null }[];
  currentConditionsSource?: WeatherProvenance;
  pressureSource?: WeatherProvenance;
  precipitationSource?: WeatherProvenance;
  rainRateSource?: WeatherProvenance;
  capeSource?: WeatherProvenance;
  forecastSource?: WeatherProvenance;
  forecast?: ForecastData;
  valueSources?: FieldProvenance[];
  observedDailyPrecipitationIsComplete?: boolean;
  observedDailyPrecipitationPartialHours?: number;
  currentPartialHourPrecipitation?: number | null;
  referenceTimeMs?: number;
  /**
   * Convective Available Potential Energy (CAPE) in J/kg.
   * Higher values indicate greater atmospheric instability and
   * severe weather potential. Typically:
   *   <500: minimal instability
   *   500-1000: marginal
   *   1000-2500: moderate
   *   2500+: high/significant
   */
  cape: number | null;
}

export interface ForecastPeriod {
  startTime: number;
  endTime: number;
  name: string | null;
  isDaytime: boolean | null;
  temperature: number | null;
  temperatureUnit: 'F' | 'C';
  probabilityOfPrecipitation: number | null;
  windSpeedMph: number | null;
  windDirection: number | null;
  condition: string | null;
  quantitativePrecipitationInches?: number | null;
}

export interface ForecastData {
  periods: ForecastPeriod[];
  hourlyPeriods: ForecastPeriod[];
  timezone: string;
  utcOffsetSeconds: number;
  source: WeatherProvenance;
}

export interface NwsAlert {
  id: string;
  event: string;
  headline: string | null;
  severity: string | null;
  urgency: string | null;
  onset: number | null;
  expires: number | null;
  areaDesc: string | null;
  certainty?: string | null;
}

export interface LocationData {
  latitude: number;
  longitude: number;
}

export interface WeatherObservationWithEvent extends WeatherObservation {
  eventName?: string;
}

export interface AnalysisSnapshot {
  id: number;
  stormEventId: number;
  timestamp: number;
  tornadoPossibilityLevel: string;
  rotationSignal: string;
  convergence: string;
  windShear: string;
  pressureTrend: string;
  windDirectionChange: number | null;
  lightningTrend: string;
  availableObservationCount: number;
  confidence: number;
}
