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
export type WeatherDataKind = 'observed' | 'radar_estimated' | 'modeled';

export interface WeatherProvenance {
  provider: WeatherProviderName;
  source: string;
  endpoint?: string;
  stationId?: string;
  gridId?: string;
  latitude?: number;
  longitude?: number;
  /** Distance from the phone/sample point to a point-observation station. */
  distanceKm?: number;
  /** Whether this value came from a sensor observation, radar estimate, or model grid. */
  dataKind?: WeatherDataKind;
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
  /** Best current/one-hour precipitation amount for the active source. */
  precipitation: number | null;
  /**
   * Accumulation from local midnight to now. This field must only be populated
   * when the upstream product actually represents that period. A forecast-grid
   * accumulation must never be presented as an observed daily total.
   */
  observedDailyPrecipitation: number | null;
  /** NOAA MRMS radar-only rolling QPE amounts at the phone coordinates. */
  radarPrecipitation1h?: number | null;
  radarPrecipitation3h?: number | null;
  radarPrecipitation6h?: number | null;
  radarPrecipitation12h?: number | null;
  radarPrecipitation24h?: number | null;
  /** Nearby physical observation-station precipitation for the last hour, when reported. */
  stationPrecipitation1h?: number | null;
  precipitationRateInchesPerHour?: number | null;
  /** True only when the daily-accumulation period is complete/trustworthy. */
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
  stationPrecipitationSource?: WeatherProvenance;
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

export interface LightningEvent {
  id: number;
  stormEventId: number | null;
  providerName: string;
  providerEventId: string | null;
  timestamp: number;
  eventLatitude: number;
  eventLongitude: number;
  providerTerminology: string;
  classification: string | null;
  polarity: string | null;
  peakCurrentAmperes: number | null;
  multiplicity: number | null;
  sensorCount: number | null;
  accuracyKm: number | null;
  distanceToObserverKm: number;
  observerLatitude: number;
  observerLongitude: number;
  ingestedAt: number;
  rawProviderPayload: string | null;
}
