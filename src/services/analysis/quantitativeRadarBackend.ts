import type { RadarVelocityPoint, RotationCouplet, StormCell } from './radar';

export interface QuantitativeDualPolEvidence {
  available: boolean;
  debrisSignature: boolean;
  confidence: number | null;
  reason?: string;
  cc?: number | null;
  zdr?: number | null;
  reflectivityDbz?: number | null;
}

export interface QuantitativeRadarResponse {
  available: boolean;
  stationId: string | null;
  latestFrameTime: number | null;
  hasPrecipitation: boolean;
  maxReflectivityDbz: number | null;
  velocityPoints: RadarVelocityPoint[];
  couplets: RotationCouplet[];
  stormCells: StormCell[];
  correlationCoefficient: number | null;
  differentialReflectivity: number | null;
  scanCount: number;
  trend: string | null;
  dualPolEvidence: QuantitativeDualPolEvidence | null;
  unavailableReason?: string;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseDualPolEvidence(value: any): QuantitativeDualPolEvidence | null {
  if (!value || typeof value !== 'object') return null;
  return {
    available: value.available === true,
    debrisSignature: value.debrisSignature === true,
    confidence: finiteOrNull(value.confidence),
    reason: typeof value.reason === 'string' ? value.reason : undefined,
    cc: finiteOrNull(value.cc),
    zdr: finiteOrNull(value.zdr),
    reflectivityDbz: finiteOrNull(value.reflectivityDbz),
  };
}

export function parseQuantitativeRadarPayload(payload: any): QuantitativeRadarResponse {
  const rawVelocity = Array.isArray(payload?.velocityPoints) ? payload.velocityPoints : [];
  const velocityPoints: RadarVelocityPoint[] = rawVelocity
    .filter((p: any) => finite(p?.latitude) && finite(p?.longitude) && finite(p?.velocity))
    .map((p: any) => ({
      latitude: p.latitude,
      longitude: p.longitude,
      velocity: p.velocity,
      stormRelativeVelocity: finite(p.stormRelativeVelocity) ? p.stormRelativeVelocity : p.velocity,
      reflectivity: finite(p.reflectivity) ? p.reflectivity : 0,
      altitude: finite(p.altitude) ? p.altitude : 0,
    }));

  const rawCouplets = Array.isArray(payload?.couplets) ? payload.couplets : [];
  const couplets: RotationCouplet[] = rawCouplets
    .filter((c: any) => finite(c?.latitude) && finite(c?.longitude) && finite(c?.shear) && c.shear >= 0)
    .map((c: any) => ({
      latitude: c.latitude,
      longitude: c.longitude,
      shear: c.shear,
      strength: ['WEAK', 'MODERATE', 'STRONG', 'EXTREME'].includes(c.strength) ? c.strength : 'WEAK',
      distanceKm: finite(c.distanceKm) ? c.distanceKm : 0,
      headingTowardUser: c.headingTowardUser === true,
      ...(finite(c.azimuthalShear) ? { azimuthalShear: c.azimuthalShear } : {}),
      ...(finite(c.altitude) ? { altitude: c.altitude } : {}),
      ...(typeof c.lowLevel === 'boolean' ? { lowLevel: c.lowLevel } : {}),
      ...(Number.isInteger(c.scanCount) && c.scanCount >= 1 ? { scanCount: c.scanCount } : {}),
    })) as RotationCouplet[];

  const rawCells = Array.isArray(payload?.stormCells) ? payload.stormCells : [];
  const stormCells: StormCell[] = rawCells
    .filter((c: any) => finite(c?.latitude) && finite(c?.longitude))
    .map((c: any, index: number) => ({
      id: typeof c.id === 'string' ? c.id : `cell-${index}`,
      latitude: c.latitude,
      longitude: c.longitude,
      maxReflectivity: finite(c.maxReflectivity) ? c.maxReflectivity : 0,
      top: finite(c.top) ? c.top : 0,
      movement: finite(c.movement) ? c.movement : 0,
      speed: finite(c.speed) ? c.speed : 0,
    }));

  const scanCount = Number.isInteger(payload?.scanCount) && payload.scanCount >= 0
    ? payload.scanCount
    : couplets.reduce((max, c: any) => Math.max(max, Number.isInteger(c.scanCount) ? c.scanCount : 0), 0);

  const available = payload?.available === true && velocityPoints.length > 0;

  return {
    available,
    stationId: typeof payload?.stationId === 'string' ? payload.stationId : null,
    latestFrameTime: finiteOrNull(payload?.latestFrameTime),
    hasPrecipitation: payload?.hasPrecipitation === true,
    maxReflectivityDbz: finiteOrNull(payload?.maxReflectivityDbz),
    velocityPoints,
    couplets,
    stormCells,
    correlationCoefficient: finiteOrNull(payload?.correlationCoefficient ?? payload?.cc),
    differentialReflectivity: finiteOrNull(payload?.differentialReflectivity ?? payload?.zdr),
    scanCount,
    trend: typeof payload?.trend === 'string' ? payload.trend : null,
    dualPolEvidence: parseDualPolEvidence(payload?.dualPolEvidence),
    unavailableReason: typeof payload?.unavailableReason === 'string' ? payload.unavailableReason : undefined,
  };
}

export async function fetchQuantitativeRadarData(
  latitude: number,
  longitude: number,
  baseUrl?: string,
): Promise<QuantitativeRadarResponse | null> {
  const configured = baseUrl ?? process.env.EXPO_PUBLIC_STORMLOG_RADAR_API_URL;
  if (!configured) return null;

  const url = `${configured.replace(/\/$/, '')}/radar?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Quantitative radar backend HTTP ${response.status}`);
  return parseQuantitativeRadarPayload(await response.json());
}
