// ============================================================
// NOAA Tornado-Analysis Data Source Contracts
// ============================================================
// Keeps provider transport separate from the analysis engine.
// No source is allowed to silently substitute missing values.
// ============================================================

export type NoaaSourceId = 'HRRR' | 'IGRA' | 'NEXRAD_LEVEL2' | 'NEXRAD_LEVEL3' | 'SPC_MD' | 'GOES_GLM' | 'NWS';

export interface NoaaSourceStatus {
  source: NoaaSourceId;
  available: boolean;
  observedAt: number | null;
  fetchedAt: number;
  latencyMs: number | null;
  error: string | null;
}

export interface HrrrEnvironmentData {
  runTime: number;
  validTime: number;
  latitude: number;
  longitude: number;
  capeJkg: number | null;
  cinJkg: number | null;
  lclHeightM: number | null;
  lowLevelShear01KmKt: number | null;
  lowLevelShear03KmKt: number | null;
  deepLayerShear06KmKt: number | null;
  srh01M2s2: number | null;
  srh03M2s2: number | null;
  significantTornadoParameter: number | null;
  supercellCompositeParameter: number | null;
}

export interface IgraSoundingData {
  stationId: string;
  stationName: string;
  latitude: number;
  longitude: number;
  observationTime: number;
  levels: Array<{
    pressureHpa: number;
    heightM: number;
    temperatureC: number;
    dewPointC: number;
    windSpeedKt: number;
    windDirectionDeg: number;
  }>;
}

export interface SpcMesoscaleDiscussion {
  id: string;
  issuedAt: number;
  expiresAt: number | null;
  number: number;
  headline: string;
  url: string;
}

export interface NexradAdvancedData {
  stationId: string;
  observedAt: number;
  reflectivityDbz: number | null;
  velocityAvailable: boolean;
  dualPolAvailable: boolean;
  velocityPoints: Array<{
    latitude: number;
    longitude: number;
    velocityKt: number;
    reflectivityDbz: number | null;
    altitudeM: number;
  }>;
  correlationCoefficient: number | null;
  differentialReflectivity: number | null;
}

export interface GoesGlmSummary {
  observedAt: number;
  flashCount5Min: number;
  flashRatePerMinute: number;
  flashExtentDensity: number | null;
  nearestFlashDistanceKm: number | null;
}

/**
 * This registry is deliberately declarative. Providers are wired in one at a
 * time after transport, latency, parsing, and mobile resource usage are proven.
 */
export const NOAA_TORNADO_SOURCES: readonly NoaaSourceId[] = [
  'HRRR',
  'IGRA',
  'NEXRAD_LEVEL2',
  'NEXRAD_LEVEL3',
  'SPC_MD',
  'GOES_GLM',
  'NWS',
];
