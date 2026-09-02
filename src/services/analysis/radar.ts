// ============================================================
// Radar Data Provider Facade
// ============================================================
//
// This module exposes the radar contract used by the analysis engine.
// The current mobile provider uses a RainViewer radar composite plus
// NWS radar-site metadata. It is NOT a raw NEXRAD Level-II decoder.
//
// Doppler velocity, dual-pol fields, quantitative dBZ, and derived
// storm-cell/couplet data remain unavailable until a real radar
// processing path is connected.

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

/**
 * Fetches the current radar composite and NWS radar-site metadata.
 * The result explicitly reports unsupported Level-II products as unavailable.
 */
export async function getRadarData(
  latitude: number,
  longitude: number
): Promise<{
  velocityPoints: RadarVelocityPoint[];
  couplets: RotationCouplet[];
  cells: StormCell[];
  available: boolean;
  stationId?: string;
  latestFrameTime?: number;
  hasPrecipitation?: boolean;
  maxReflectivityDbz?: number | null;
  unavailableReason?: string;
}> {
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
      unavailableReason: result.unavailableReason,
    };
  } catch (error) {
    console.warn('[Radar] Failed to fetch radar data:', error);
    return {
      velocityPoints: [],
      couplets: [],
      cells: [],
      available: false,
      unavailableReason: `Radar fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
