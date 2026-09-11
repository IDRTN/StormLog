// ============================================================
// Radar Data Provider Facade
// ============================================================
//
// Preferred path: a quantitative NEXRAD backend that exposes decoded
// Level-II velocity/dual-pol/couplet products. If it is not configured or
// temporarily fails, StormLog falls back to the existing RainViewer/NWS
// composite path and clearly reports quantitative products as unavailable.

export interface RadarVelocityPoint {
  latitude: number;
  longitude: number;
  /** Base radar velocity in knots (+ away, - toward) */
  velocity: number;
  /** Storm-relative velocity in knots */
  stormRelativeVelocity: number;
  /** Reflectivity in dBZ */
  reflectivity: number;
  /** Altitude in meters AGL */
  altitude: number;
}

export interface RotationCouplet {
  latitude: number;
  longitude: number;
  /** Max gate-to-gate shear in knots */
  shear: number;
  /** Rotation strength classification */
  strength: 'WEAK' | 'MODERATE' | 'STRONG' | 'EXTREME';
  /** Distance from user in km */
  distanceKm: number;
  /** Heading toward user? */
  headingTowardUser: boolean;
  /** Optional normalized azimuthal shear from the backend */
  azimuthalShear?: number;
  /** Optional couplet altitude in meters AGL */
  altitude?: number;
  /** Explicit low-level flag when altitude is unavailable */
  lowLevel?: boolean;
  /** Provider-validated independent scan count */
  scanCount?: number;
}

export interface StormCell {
  id: string;
  latitude: number;
  longitude: number;
  /** Maximum reflectivity dBZ */
  maxReflectivity: number;
  /** Top of storm in km */
  top: number;
  /** Movement direction in degrees */
  movement: number;
  /** Movement speed in mph */
  speed: number;
}

export interface RadarVelocityProvider {
  getVelocityNearPoint(
    latitude: number,
    longitude: number,
    radiusKm: number
  ): Promise<RadarVelocityPoint[]>;

  getRotationCouplets(
    latitude: number,
    longitude: number,
    radiusKm: number
  ): Promise<RotationCouplet[]>;

  getStormCells(
    latitude: number,
    longitude: number,
    radiusKm: number
  ): Promise<StormCell[]>;

  isAvailable(): Promise<boolean>;
}

export { fetchNexradData, NexradVelocityProvider } from './nexrad';
export type { NexradProviderResult, NexradStationInfo, NexradReflectivityResult } from './nexrad';
export { fetchQuantitativeRadarData, parseQuantitativeRadarPayload } from './quantitativeRadarBackend';
export type { QuantitativeRadarResponse } from './quantitativeRadarBackend';

export interface RadarDataResult {
  velocityPoints: RadarVelocityPoint[];
  couplets: RotationCouplet[];
  cells: StormCell[];
  available: boolean;
  stationId?: string;
  latestFrameTime?: number;
  hasPrecipitation?: boolean;
  maxReflectivityDbz?: number | null;
  correlationCoefficient?: number | null;
  differentialReflectivity?: number | null;
  scanCount?: number;
  trend?: string | null;
  source?: 'QUANTITATIVE_LEVEL2' | 'COMPOSITE_FALLBACK';
  unavailableReason?: string;
}

/**
 * Fetches radar data for the analysis engine. Quantitative backend data is
 * preferred because velocity/dual-pol are safety-critical for tornado claims.
 * The composite provider remains a non-quantitative fallback only.
 */
export async function getRadarData(
  latitude: number,
  longitude: number
): Promise<RadarDataResult> {
  try {
    const { fetchQuantitativeRadarData } = await import('./quantitativeRadarBackend');
    const quantitative = await fetchQuantitativeRadarData(latitude, longitude);
    if (quantitative?.available) {
      return {
        velocityPoints: quantitative.velocityPoints,
        couplets: quantitative.couplets,
        cells: quantitative.stormCells,
        available: true,
        stationId: quantitative.stationId ?? undefined,
        latestFrameTime: quantitative.latestFrameTime ?? undefined,
        hasPrecipitation: quantitative.hasPrecipitation,
        maxReflectivityDbz: quantitative.maxReflectivityDbz,
        correlationCoefficient: quantitative.correlationCoefficient,
        differentialReflectivity: quantitative.differentialReflectivity,
        scanCount: quantitative.scanCount,
        trend: quantitative.trend,
        source: 'QUANTITATIVE_LEVEL2',
        unavailableReason: quantitative.unavailableReason,
      };
    }
  } catch (error) {
    console.warn('[Radar] Quantitative backend unavailable, using composite fallback:', error);
  }

  try {
    const { fetchNexradData } = await import('./nexrad');
    const result = await fetchNexradData(latitude, longitude);

    return {
      velocityPoints: result.velocityPoints,
      couplets: result.couplets,
      cells: result.stormCells,
      available: result.available,
      stationId: result.station?.stationId,
      latestFrameTime: result.latestFrame?.time,
      hasPrecipitation: result.reflectivity?.hasPrecipitation,
      maxReflectivityDbz: result.reflectivity?.maxReflectivityDbz ?? null,
      source: 'COMPOSITE_FALLBACK',
      unavailableReason: result.unavailableReason,
    };
  } catch (error) {
    console.warn('[Radar] Failed to fetch radar data:', error);
    return {
      velocityPoints: [],
      couplets: [],
      cells: [],
      available: false,
      source: 'COMPOSITE_FALLBACK',
      unavailableReason: `Radar fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
