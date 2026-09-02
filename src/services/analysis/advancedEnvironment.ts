// ============================================================
// Advanced Tornado Environment Calculations
// ============================================================
// Provider-agnostic calculations for upper-air / model profiles.
// This module never invents missing meteorological values. NOAA
// providers (HRRR/IGRA) can populate the profile later.
// ============================================================

export interface SoundingLevel {
  pressureHpa: number;
  heightM: number;
  temperatureC: number;
  dewPointC: number;
  windSpeedKt: number;
  windDirectionDeg: number;
}

export interface AdvancedEnvironmentInput {
  levels: SoundingLevel[];
  capeJkg?: number | null;
  cinJkg?: number | null;
  stormMotionDirectionDeg?: number | null;
  stormMotionSpeedKt?: number | null;
}

export interface AdvancedEnvironmentResult {
  sourceLevelCount: number;
  lowLevelShear01KmKt: number | null;
  lowLevelShear03KmKt: number | null;
  deepLayerShear06KmKt: number | null;
  srh01M2s2: number | null;
  srh03M2s2: number | null;
  lclHeightM: number | null;
  capeJkg: number | null;
  cinJkg: number | null;
  significantTornadoParameter: number | null;
  supercellCompositeParameter: number | null;
  availability: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
  limitations: string[];
}

interface WindVector {
  u: number;
  v: number;
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function windVector(speedKt: number, directionDeg: number): WindVector {
  const direction = (normalizeDegrees(directionDeg) * Math.PI) / 180;
  // Meteorological direction is where wind comes FROM.
  return {
    u: -speedKt * Math.sin(direction),
    v: -speedKt * Math.cos(direction),
  };
}

function magnitude(vector: WindVector): number {
  return Math.hypot(vector.u, vector.v);
}

function interpolate(a: number, b: number, fraction: number): number {
  return a + (b - a) * fraction;
}

function vectorAtHeight(levels: SoundingLevel[], targetHeightM: number): WindVector | null {
  if (levels.length === 0) return null;
  const sorted = [...levels].sort((a, b) => a.heightM - b.heightM);

  if (targetHeightM < sorted[0].heightM || targetHeightM > sorted[sorted.length - 1].heightM) {
    return null;
  }

  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    if (current.heightM === targetHeightM) {
      return windVector(current.windSpeedKt, current.windDirectionDeg);
    }
    const next = sorted[i + 1];
    if (!next || targetHeightM > next.heightM) continue;

    const fraction = (targetHeightM - current.heightM) / (next.heightM - current.heightM);
    const a = windVector(current.windSpeedKt, current.windDirectionDeg);
    const b = windVector(next.windSpeedKt, next.windDirectionDeg);
    return {
      u: interpolate(a.u, b.u, fraction),
      v: interpolate(a.v, b.v, fraction),
    };
  }

  return null;
}

function bulkShear(levels: SoundingLevel[], topKm: number): number | null {
  const surface = vectorAtHeight(levels, 0);
  const top = vectorAtHeight(levels, topKm * 1000);
  if (!surface || !top) return null;

  return magnitude({ u: top.u - surface.u, v: top.v - surface.v });
}

function stormMotionVector(directionDeg: number, speedKt: number): WindVector {
  const direction = (normalizeDegrees(directionDeg) * Math.PI) / 180;
  return {
    u: speedKt * Math.sin(direction),
    v: speedKt * Math.cos(direction),
  };
}

/**
 * Integrates storm-relative helicity using the standard hodograph area
 * formulation over the supplied height interval. The result is converted
 * from kt·m/s to m²/s².
 */
function stormRelativeHelicity(
  levels: SoundingLevel[],
  bottomM: number,
  topM: number,
  motionDirectionDeg: number | null,
  motionSpeedKt: number | null,
): number | null {
  if (motionDirectionDeg == null || motionSpeedKt == null) return null;
  const bottom = vectorAtHeight(levels, bottomM);
  const top = vectorAtHeight(levels, topM);
  if (!bottom || !top) return null;

  const motion = stormMotionVector(motionDirectionDeg, motionSpeedKt);
  const srBottom = { u: bottom.u - motion.u, v: bottom.v - motion.v };
  const srTop = { u: top.u - motion.u, v: top.v - motion.v };

  // A single layer gives a secant approximation. With intermediate levels,
  // integrate each segment using trapezoidal hodograph area.
  const selected = [...levels]
    .filter(level => level.heightM >= bottomM && level.heightM <= topM)
    .sort((a, b) => a.heightM - b.heightM);

  const points: Array<{ heightM: number; vector: WindVector }> = [
    { heightM: bottomM, vector: srBottom },
    ...selected.map(level => ({
      heightM: level.heightM,
      vector: (() => {
        const raw = windVector(level.windSpeedKt, level.windDirectionDeg);
        return { u: raw.u - motion.u, v: raw.v - motion.v };
      })(),
    })),
    { heightM: topM, vector: srTop },
  ];

  points.sort((a, b) => a.heightM - b.heightM);

  let areaKtM = 0;
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1].vector;
    const current = points[i].vector;
    areaKtM += current.u * previous.v - current.v * previous.u;
  }

  // 1 kt = 0.514444 m/s; the vertical coordinate is already represented by
  // the hodograph integral, so the conversion is kt² -> (m/s)².
  return areaKtM * 0.514444 * 0.514444;
}

/** Bolton-style LCL estimate from surface temperature/dewpoint. */
function calculateLclHeightM(temperatureC: number, dewPointC: number): number {
  const tK = temperatureC + 273.15;
  const tdK = dewPointC + 273.15;
  const lclK = 1 / (1 / (tdK - 56) + Math.log(tK / tdK) / 800) + 56;
  return Math.max(0, (tK - lclK) / 0.0098);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function deriveCompositeParameters(
  capeJkg: number | null,
  cinJkg: number | null,
  srh01: number | null,
  shear06: number | null,
  lclM: number | null,
): { stp: number | null; scp: number | null } {
  if (capeJkg == null || srh01 == null || shear06 == null || lclM == null) {
    return { stp: null, scp: null };
  }

  const capeTerm = capeJkg / 1500;
  const srhTerm = srh01 / 150;
  const shearTerm = shear06 / 20;
  const lclTerm = clamp((2000 - lclM) / 1000, 0, 1.5);
  const cinTerm = cinJkg == null ? null : clamp((200 + cinJkg) / 150, 0, 1.33);

  const stp = cinTerm == null
    ? null
    : clamp(capeTerm * srhTerm * shearTerm * lclTerm * cinTerm, -10, 10);

  // SCP is intentionally only calculated when the core ingredients exist.
  const scp = clamp((capeJkg / 1000) * (shear06 / 20) * Math.max(0, srh01 / 50), 0, 20);

  return { stp, scp };
}

export function analyzeAdvancedEnvironment(input: AdvancedEnvironmentInput): AdvancedEnvironmentResult {
  const levels = input.levels
    .filter(level => Number.isFinite(level.heightM) && Number.isFinite(level.windSpeedKt) && Number.isFinite(level.windDirectionDeg))
    .sort((a, b) => a.heightM - b.heightM);

  const limitations: string[] = [];
  if (levels.length === 0) limitations.push('No vertical wind profile supplied');
  if (levels.length > 0 && !vectorAtHeight(levels, 0)) limitations.push('Profile does not reach the surface');
  if (levels.length > 0 && !vectorAtHeight(levels, 1000)) limitations.push('0–1 km wind shear unavailable');
  if (levels.length > 0 && !vectorAtHeight(levels, 3000)) limitations.push('0–3 km wind shear unavailable');
  if (levels.length > 0 && !vectorAtHeight(levels, 6000)) limitations.push('0–6 km bulk shear unavailable');
  if (input.stormMotionDirectionDeg == null || input.stormMotionSpeedKt == null) {
    limitations.push('Storm motion unavailable — SRH cannot be calculated');
  }

  const surface = levels.length > 0 ? levels[0] : null;
  const lclHeightM = surface ? calculateLclHeightM(surface.temperatureC, surface.dewPointC) : null;
  const lowLevelShear01KmKt = bulkShear(levels, 1);
  const lowLevelShear03KmKt = bulkShear(levels, 3);
  const deepLayerShear06KmKt = bulkShear(levels, 6);
  const srh01M2s2 = stormRelativeHelicity(levels, 0, 1000, input.stormMotionDirectionDeg ?? null, input.stormMotionSpeedKt ?? null);
  const srh03M2s2 = stormRelativeHelicity(levels, 0, 3000, input.stormMotionDirectionDeg ?? null, input.stormMotionSpeedKt ?? null);
  const { stp, scp } = deriveCompositeParameters(
    input.capeJkg ?? null,
    input.cinJkg ?? null,
    srh01M2s2,
    deepLayerShear06KmKt,
    lclHeightM,
  );

  const availableValues = [lowLevelShear01KmKt, lowLevelShear03KmKt, deepLayerShear06KmKt, srh01M2s2, srh03M2s2, lclHeightM]
    .filter(value => value != null).length;

  const availability = levels.length === 0
    ? 'UNAVAILABLE'
    : availableValues >= 5 ? 'AVAILABLE' : 'PARTIAL';

  return {
    sourceLevelCount: levels.length,
    lowLevelShear01KmKt,
    lowLevelShear03KmKt,
    deepLayerShear06KmKt,
    srh01M2s2,
    srh03M2s2,
    lclHeightM,
    capeJkg: input.capeJkg ?? null,
    cinJkg: input.cinJkg ?? null,
    significantTornadoParameter: stp,
    supercellCompositeParameter: scp,
    availability,
    limitations,
  };
}
