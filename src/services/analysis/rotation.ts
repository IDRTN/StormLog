// ============================================================
// Layer C — Rotation Analysis (Radar + Surface)
// ============================================================
//
// Three modes:
//   1. Radar velocity available → analyze validated couplets
//   2. Radar connected but velocity unavailable → surface fallback
//      with clear "Radar rotation unavailable" label
//   3. No radar → surface observations only
//
// CRITICAL: Surface station data alone CANNOT confirm rotation.
// Missing velocity is NEVER treated as "no rotation."

import type {
  AnalysisInput,
  RotationAssessment,
  AssessmentLevel,
  TrendDirection,
  SurfaceRotationData,
} from './types';
import {
  calculateConvergence,
  calculateRotation,
  calculateWindShift,
  haversineDistance,
} from './windVector';

// ---- Radar-based rotation (when velocity data exists) ----

function analyzeRadarRotation(input: AnalysisInput): {
  hasCouplet: boolean;
  coupletStrength: string;
  gateToGateShear: number | null;
  rotationalVelocity: number | null;
  coupletDiameter: number | null;
  azimuthalShear: number | null;
  lowLevelRotation: boolean;
  verticalContinuity: number;
  level: AssessmentLevel;
  factors: string[];
} {
  const radar = input.radarData!;
  const factors: string[] = [];

  if (!radar.couplets || radar.couplets.length === 0) {
    return {
      hasCouplet: false, coupletStrength: 'NONE',
      gateToGateShear: null, rotationalVelocity: null,
      coupletDiameter: null, azimuthalShear: null,
      lowLevelRotation: false, verticalContinuity: 0,
      level: 'LOW',
      factors: ['No rotation couplets detected in radar velocity data'],
    };
  }

  // Never let a missing/non-finite shear value become zero. A couplet
  // without a valid gate-to-gate shear measurement is not quantitative
  // enough to score as radar-confirmed rotation.
  const validCouplets = radar.couplets.filter(c =>
    Number.isFinite(c?.shear) && c.shear >= 0 &&
    Number.isFinite(c?.latitude) && Number.isFinite(c?.longitude)
  );

  if (validCouplets.length === 0) {
    return {
      hasCouplet: false, coupletStrength: 'UNAVAILABLE',
      gateToGateShear: null, rotationalVelocity: null,
      coupletDiameter: null, azimuthalShear: null,
      lowLevelRotation: false, verticalContinuity: 0,
      level: 'UNKNOWN',
      factors: ['Radar velocity returned no quantitatively valid rotation couplet measurements'],
    };
  }

  let maxShear = -Infinity;
  let maxCouplet: any = null;
  for (const couplet of validCouplets) {
    if (couplet.shear > maxShear) { maxShear = couplet.shear; maxCouplet = couplet; }
  }

  if (!maxCouplet || !Number.isFinite(maxShear)) {
    return {
      hasCouplet: false, coupletStrength: 'UNAVAILABLE',
      gateToGateShear: null, rotationalVelocity: null,
      coupletDiameter: null, azimuthalShear: null,
      lowLevelRotation: false, verticalContinuity: 0,
      level: 'UNKNOWN', factors: ['No valid quantitative couplet measurement'],
    };
  }

  const gateToGateShear = maxShear;
  const strength: string = maxCouplet.strength ?? 'WEAK';
  const rotationalVelocity = gateToGateShear / 2;
  const coupletDiameter = Number.isFinite(maxCouplet.distanceKm) && maxCouplet.distanceKm > 0
    ? maxCouplet.distanceKm * 2
    : null;
  const azimuthalShear = Number.isFinite(maxCouplet.azimuthalShear) ? maxCouplet.azimuthalShear : null;
  const lowLevelRotation = Number.isFinite(maxCouplet.altitude)
    ? maxCouplet.altitude < 3000
    : maxCouplet.lowLevel === true;
  const validatedScanCount = Number.isFinite(maxCouplet.scanCount) &&
    Number.isInteger(maxCouplet.scanCount) && maxCouplet.scanCount >= 1
    ? maxCouplet.scanCount
    : 1;
  const verticalContinuity = validatedScanCount;

  let level: AssessmentLevel;
  if (strength === 'EXTREME') { level = 'VERY_HIGH'; factors.push('Extreme rotation detected'); }
  else if (strength === 'STRONG') { level = 'HIGH'; factors.push(`Strong rotation (${gateToGateShear.toFixed(0)} kt G2G)`); }
  else if (strength === 'MODERATE') { level = 'MARGINAL'; factors.push(`Moderate rotation (${gateToGateShear.toFixed(0)} kt G2G)`); }
  else { level = 'MARGINAL'; factors.push(`Weak rotation (${gateToGateShear.toFixed(0)} kt G2G)`); }

  if (lowLevelRotation) factors.push('Low-level rotation present');
  if (verticalContinuity > 1) factors.push(`Persistent across ${verticalContinuity} scans`);

  return {
    hasCouplet: true, coupletStrength: strength,
    gateToGateShear, rotationalVelocity, coupletDiameter,
    azimuthalShear, lowLevelRotation, verticalContinuity,
    level, factors,
  };
}

// ---- Surface station rotation (fallback/supporting) ----

function analyzeSurfaceRotation(input: AnalysisInput): {
  surfaceData: SurfaceRotationData;
  level: AssessmentLevel;
  factors: string[];
} {
  const factors: string[] = [];

  const convergence = calculateConvergence(input.nearbyStations, input.latitude, input.longitude);
  const rotationPattern = calculateRotation(input.nearbyStations, input.latitude, input.longitude);

  const windRecords = input.recentObservations
    .filter(o => o.windDirection != null)
    .map(o => ({ direction: o.windDirection!, timestamp: o.timestamp }));

  const windShift = calculateWindShift(windRecords);

  const surfaceData: SurfaceRotationData = {
    convergenceLevel: convergence.level,
    rotationSignal: rotationPattern.signal,
    confidencePercent: rotationPattern.confidence,
    stationCount: input.nearbyStations.length,
    windShiftDegrees: windShift?.degrees ?? null,
    windShiftMinutes: windShift?.durationMinutes ?? null,
  };

  const surfaceScore = (convergence.score + rotationPattern.score) / 2;

  let level: AssessmentLevel;
  if (surfaceScore > 0.7) {
    level = 'MARGINAL';
    factors.push('Moderate surface wind convergence (supporting evidence only)');
  } else if (surfaceScore > 0.4) {
    level = 'MARGINAL';
    factors.push('Weak-moderate surface wind convergence');
  } else if (surfaceScore > 0.2) {
    level = 'LOW';
    factors.push('Slight surface wind convergence');
  } else {
    level = 'VERY_LOW';
    factors.push('No significant surface wind convergence detected');
  }

  if (windShift && windShift.degrees >= 30) {
    factors.push(`Wind shift of ${windShift.degrees}° over ${windShift.durationMinutes} min`);
  }
  factors.push('Surface wind pattern — supporting evidence only, NOT radar-confirmed rotation');

  return { surfaceData, level, factors };
}

// ---- Trend detection from previous analyses ----

function detectTrend(
  current: RotationAssessment,
  previous: RotationAssessment[]
): TrendDirection {
  if (!previous || previous.length === 0) return 'UNKNOWN';

  const recent = previous.slice(-5);
  const currentVal = current.gateToGateShear ?? 0;

  if (recent.length < 2) {
    const prevShear = recent[recent.length - 1]?.gateToGateShear ?? 0;
    if (currentVal > prevShear * 1.5 && currentVal > 20) return 'NEWLY_DEVELOPING';
    return 'PERSISTENT';
  }

  const firstShear = recent[0]?.gateToGateShear ?? 0;
  const lastShear = recent[recent.length - 1]?.gateToGateShear ?? 0;

  if (lastShear === 0 && firstShear === 0) return 'UNKNOWN';

  const changeRatio = lastShear > 0 ? currentVal / lastShear : 0;

  if (changeRatio > 1.5) return 'RAPIDLY_INTENSIFYING';
  if (changeRatio > 1.15) return 'STRENGTHENING';
  if (changeRatio < 0.6) return 'WEAKENING';
  return 'PERSISTENT';
}

// ============================================================
// MAIN FUNCTION
// ============================================================

export function analyzeRotation(
  input: AnalysisInput,
  previousAnalyses?: RotationAssessment[]
): RotationAssessment {
  const radarConnected = input.radarData?.available === true;
  const hasVelocityData = input.radarData?.velocityPoints != null &&
    input.radarData.velocityPoints.length > 0;

  // Mode 1: Radar velocity data available — full couplet analysis
  if (radarConnected && hasVelocityData) {
    const radarResult = analyzeRadarRotation(input);
    const baseAssessment: RotationAssessment = {
      ...radarResult,
      radarAvailable: true,
      velocityDataAvailable: true,
      trend: 'UNKNOWN',
      surfaceWindPattern: null,
      description: radarResult.factors.join('. '),
    };

    if (previousAnalyses && previousAnalyses.length > 0) {
      baseAssessment.trend = detectTrend(baseAssessment, previousAnalyses);
    }

    return baseAssessment;
  }

  // Mode 2: Radar connected but velocity unavailable
  if (radarConnected && !hasVelocityData) {
    const surfaceResult = analyzeSurfaceRotation(input);

    return {
      level: surfaceResult.level,
      radarAvailable: true,
      velocityDataAvailable: false,
      hasCouplet: false,
      coupletStrength: 'UNAVAILABLE',
      gateToGateShear: null,
      rotationalVelocity: null,
      coupletDiameter: null,
      azimuthalShear: null,
      lowLevelRotation: false,
      verticalContinuity: 0,
      trend: 'UNKNOWN',
      surfaceWindPattern: surfaceResult.surfaceData,
      description: 'Radar rotation unavailable — Doppler velocity requires backend processing. Surface observations provide supporting indicators only.',
      factors: [
        'RADAR ROTATION UNAVAILABLE',
        ...surfaceResult.factors,
      ],
    };
  }

  // Mode 3: No radar connection at all
  const surfaceResult = analyzeSurfaceRotation(input);

  return {
    level: surfaceResult.level,
    radarAvailable: false,
    velocityDataAvailable: false,
    hasCouplet: false,
    coupletStrength: 'UNAVAILABLE',
    gateToGateShear: null,
    rotationalVelocity: null,
    coupletDiameter: null,
    azimuthalShear: null,
    lowLevelRotation: false,
    verticalContinuity: 0,
    trend: 'UNKNOWN',
    surfaceWindPattern: surfaceResult.surfaceData,
    description: 'Radar unavailable — surface observations only. Cannot assess Doppler rotation.',
    factors: [
      'RADAR UNAVAILABLE',
      ...surfaceResult.factors,
    ],
  };
}
