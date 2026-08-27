// ============================================================
// Progressive Storm Development Assessment Engine
// ============================================================
//
// Combines four analysis layers into a progressive assessment:
//   Layer A — Environmental Tornado Potential
//   Layer B — Storm Structure (from real NEXRAD reflectivity)
//   Layer C — Rotation Analysis (surface + radar when available)
//   Layer D — Tornadic Evidence
//
// PROGRESSIVE RULES:
//   Environment alone → LOW (never higher)
//   Environment + organized storm → MODERATE
//   Environment + storm + rotation → HIGH
//   Environment + strong rotation + couplet → VERY HIGH
//   Debris signature → VERY HIGH with explicit evidence text
//
// CRITICAL:
//   - Missing data is NEVER treated as zero
//   - NWS warnings displayed SEPARATELY
//   - Safe language throughout
//   - No fake probability percentages

import type {
  AnalysisInput,
  StormAnalysisResult,
  AssessmentLevel,
  ConfidenceLevel,
  DataQuality,
  DataAvailability,
  NwsWarningStatus,
  StormMotion,
} from './types';
import { haversineDistance } from './windVector';

import { analyzeEnvironment } from './environmental';
import { analyzeStormStructure } from './stormStructure';
import { analyzeRotation } from './rotation';
import { analyzeTornadicEvidence } from './tornadicEvidence';

// ---- Level ordering ----

const LEVEL_ORDER: Record<AssessmentLevel, number> = {
  'VERY_LOW': 0,
  'LOW': 1,
  'MARGINAL': 2,
  'MODERATE': 3,
  'HIGH': 4,
  'VERY_HIGH': 5,
  'UNKNOWN': -1,
};

function levelValue(level: AssessmentLevel): number {
  return LEVEL_ORDER[level] ?? -1;
}

function maxLevel(a: AssessmentLevel, b: AssessmentLevel): AssessmentLevel {
  return levelValue(a) >= levelValue(b) ? a : b;
}

// ---- Display Helpers ----

export function getAssessmentEmoji(level: AssessmentLevel): string {
  switch (level) {
    case 'VERY_HIGH': return '🔴';
    case 'HIGH': return '🟠';
    case 'MODERATE': return '🟡';
    case 'MARGINAL': return '🟡';
    case 'LOW': return '🟢';
    case 'VERY_LOW': return '🟢';
    case 'UNKNOWN': return '⚪';
  }
}

export function getAssessmentColor(level: AssessmentLevel): string {
  switch (level) {
    case 'VERY_HIGH': return '#DC2626';
    case 'HIGH': return '#F85149';
    case 'MODERATE': return '#F0883E';
    case 'MARGINAL': return '#F0C000';
    case 'LOW': return '#3FB950';
    case 'VERY_LOW': return '#238636';
    case 'UNKNOWN': return '#8B949E';
  }
}

export function getAssessmentLabel(level: AssessmentLevel): string {
  switch (level) {
    case 'VERY_HIGH': return 'Very High';
    case 'HIGH': return 'High';
    case 'MODERATE': return 'Moderate';
    case 'MARGINAL': return 'Marginal';
    case 'LOW': return 'Low';
    case 'VERY_LOW': return 'Very Low';
    case 'UNKNOWN': return 'Unknown';
  }
}

// ---- NWS Status ----

function buildNwsStatus(input: AnalysisInput): NwsWarningStatus {
  const alerts = input.nwsAlerts ?? [];

  const tornadoWarning = alerts.some(a => a.event?.includes('Tornado Warning'));
  const tornadoWatch = alerts.some(a => a.event?.includes('Tornado Watch'));
  const severeWarning = alerts.some(a => a.event?.includes('Severe Thunderstorm Warning'));
  const severeWatch = alerts.some(a => a.event?.includes('Severe Thunderstorm Watch'));

  const activeAlerts = alerts.map(a => ({
    event: a.event,
    severity: a.severity,
    headline: a.headline,
  }));

  const parts: string[] = [];
  if (tornadoWarning) parts.push('Tornado Warning');
  else if (tornadoWatch) parts.push('Tornado Watch');
  if (severeWarning) parts.push('Severe Thunderstorm Warning');
  else if (severeWatch && !tornadoWatch) parts.push('Severe Thunderstorm Watch');
  if (parts.length === 0) parts.push('No active NWS watch/warning');

  return {
    tornadoWarning,
    tornadoWatch,
    severeWarning,
    severeWatch,
    activeAlerts,
    description: parts.join(' · '),
  };
}

// ---- Storm Motion & Distance ----

/**
 * Calculate initial bearing from point A to point B using proper
 * geographic formula (accounts for latitude convergence).
 */
function calculateBearing(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) -
            Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  let bearing = Math.atan2(y, x) * 180 / Math.PI;
  return (bearing + 360) % 360;
}

function buildStormMotion(
  input: AnalysisInput,
  stormCells?: any[]
): StormMotion | null {
  // Only use radar cell data — do NOT use user GPS movement as storm motion
  if (!stormCells || stormCells.length === 0) return null;

  let closestCell = stormCells[0];
  let minDist = Infinity;

  for (const cell of stormCells) {
    if (cell.latitude != null && cell.longitude != null) {
      const dist = haversineDistance(input.latitude, input.longitude, cell.latitude, cell.longitude);
      if (dist < minDist) {
        minDist = dist;
        closestCell = cell;
      }
    }
  }

  if (closestCell.latitude == null || closestCell.longitude == null) return null;

  // Proper geographic bearing from user to storm
  const bearingToStorm = calculateBearing(
    input.latitude, input.longitude,
    closestCell.latitude, closestCell.longitude
  );

  const distanceKm = haversineDistance(
    input.latitude, input.longitude,
    closestCell.latitude, closestCell.longitude
  );
  const speedMph = closestCell.speed ?? null;
  const motionDeg = closestCell.movement ?? null;

  // Determine if approaching: storm motion direction should be roughly
  // opposite to the bearing from user to storm (i.e., storm moving toward user)
  let approaching: boolean | null = null;
  if (motionDeg != null) {
    // The direction FROM storm TO user is roughly bearingToStorm + 180°
    const towardUserBearing = (bearingToStorm + 180) % 360;
    // Check if storm's motion is within ±90° of the toward-user direction
    let angleDiff = Math.abs(motionDeg - towardUserBearing) % 360;
    if (angleDiff > 180) angleDiff = 360 - angleDiff;
    approaching = angleDiff < 90;
  }

  let description: string;
  if (approaching === true) description = 'Toward user';
  else if (approaching === false) description = 'Away or crossing';
  else description = 'Direction unknown';

  if (speedMph != null) description += ` · ${speedMph.toFixed(0)} mph`;

  return {
    distanceMiles: distanceKm * 0.621371,
    bearingDegrees: bearingToStorm,
    speedMph,
    directionDegrees: motionDeg,
    approaching: approaching ?? false,
    description,
  };
}

// ---- Data Quality Assessment ----

function assessDataQuality(input: AnalysisInput, hasVelocity: boolean, scanCount: number): DataQuality {
  const limitations: string[] = [];

  // Radar coverage
  const hasRadarData = input.radarData?.available === true;
  const radarCoverage: DataAvailability = hasRadarData ? 'AVAILABLE' : 'UNAVAILABLE';

  if (!hasRadarData) {
    limitations.push('Radar not connected');
  }

  // Velocity availability — critical for rotation assessment
  const velocityData: DataAvailability = hasVelocity ? 'AVAILABLE' : 'UNAVAILABLE';
  if (!hasVelocity && hasRadarData) {
    limitations.push('Doppler velocity unavailable through public REST APIs');
    limitations.push('Rotation assessment limited to surface observations');
  }

  // Environmental data
  const hasCape = input.cape != null;
  const hasPressure = input.pressure != null;
  const hasWind = input.windSpeed != null;
  const envScore = (hasCape ? 1 : 0) + (hasPressure ? 1 : 0) + (hasWind ? 1 : 0);
  const environmentalData: DataAvailability =
    envScore >= 2 ? 'AVAILABLE' : envScore >= 1 ? 'PARTIAL' : 'UNAVAILABLE';

  if (!hasCape) limitations.push('CAPE unavailable — instability assessment limited');

  // Surface stations
  const stationCount = input.nearbyStations?.length ?? 0;
  const surfaceStations: DataAvailability =
    stationCount >= 4 ? 'AVAILABLE' : stationCount >= 2 ? 'PARTIAL' : 'UNAVAILABLE';

  if (stationCount < 4) {
    limitations.push(`Only \${stationCount} nearby surface station\${stationCount === 1 ? '' : 's'} available`);
  }

  // Scan count for vertical continuity / trend
  if (scanCount <= 1) {
    limitations.push('Single radar scan — trend and persistence cannot be determined');
  }

  // Dual-pol availability
  const radarAny = input.radarData as any;
  const hasDualPol = radarAny?.correlationCoefficient != null || radarAny?.cc != null;
  if (!hasDualPol) {
    limitations.push('Dual-pol data unavailable — debris signature cannot be assessed');
  }

  // NWS data
  const nwsAvailable = (input.nwsAlerts?.length ?? 0) > 0 ||
    input.nwsAlerts != null; // Even empty array means we checked

  // ---- Calculate overall confidence ----
  let score = 0;

  // Radar reflectivity: +1
  if (radarCoverage === 'AVAILABLE') score += 1;

  // Velocity: +2 (most critical)
  if (velocityData === 'AVAILABLE') score += 2;

  // Multiple scans: +1
  if (scanCount >= 3) score += 1;

  // Environmental data: +1
  if (environmentalData === 'AVAILABLE') score += 1;

  // Surface stations: +0.5
  if (surfaceStations !== 'UNAVAILABLE') score += 0.5;

  // Dual-pol: +0.5
  if (hasDualPol) score += 0.5;

  let level: ConfidenceLevel;
  if (score >= 5) level = 'HIGH';
  else if (score >= 3) level = 'MODERATE';
  else if (score >= 1.5) level = 'LOW';
  else level = 'UNKNOWN';

  return {
    level,
    radarCoverage,
    environmentalData,
    surfaceStations,
    velocityData,
    description: `\${level} confidence — \${hasVelocity ? 'radar velocity available' : 'no radar velocity'}`,
    limitations,
  };
}

// ---- Progressive Overall Assessment ----

interface OverallResult {
  level: AssessmentLevel;
  text: string;
  why: string;
}

function calculateProgressiveAssessment(
  environment: AssessmentLevel,
  stormStructure: AssessmentLevel,
  rotation: AssessmentLevel,
  tornadicEvidence: AssessmentLevel,
  hasRadar: boolean,
  hasVelocity: boolean,
  hasPrecipitation: boolean,
  debrisSignature: boolean,
  hasCouplet: boolean,
  hasStrongRotation: boolean,
  scanCount: number,
  envFavorable: boolean,
): OverallResult {
  const envVal = levelValue(environment);
  const structVal = levelValue(stormStructure);
  const rotVal = levelValue(rotation);
  const evidVal = levelValue(tornadicEvidence);

  const increasingFactors: string[] = [];
  const limitingFactors: string[] = [];

  let score = 0;

  // Factor 1: Environment (max contribution: 2)
  if (envVal >= levelValue('VERY_HIGH')) {
    score += 2;
    increasingFactors.push('Highly favorable tornado environment');
  } else if (envVal >= levelValue('MODERATE')) {
    score += 1.5;
    increasingFactors.push('Favorable environment for tornado development');
  } else if (envVal >= levelValue('MARGINAL')) {
    score += 0.5;
    increasingFactors.push('Marginally favorable environment');
  } else if (envVal >= 0) {
    limitingFactors.push('Environment not particularly favorable for tornadoes');
  }

  // Factor 2: Storm presence/structure (max contribution: 2)
  if (structVal >= levelValue('HIGH')) {
    score += 2;
    increasingFactors.push('Organized storm structure detected');
  } else if (structVal >= levelValue('MODERATE')) {
    score += 1.5;
    increasingFactors.push('Strong storm present');
  } else if (structVal >= levelValue('MARGINAL')) {
    score += 1;
    increasingFactors.push('Convective activity detected');
  } else if (hasPrecipitation) {
    score += 0.5;
    increasingFactors.push('Precipitation shown on radar');
  } else {
    limitingFactors.push('No organized storm detected on radar');
  }

  // Factor 3: Rotation (max contribution: 2) — HARD GATE: requires velocity
  if (!hasVelocity) {
    // Without velocity, surface observations contribute very little
    if (rotVal >= levelValue('MODERATE')) {
      score += 0.5; // Surface-only evidence is weak supporting signal
      increasingFactors.push('Surface convergence pattern noted (not radar-confirmed)');
    }
    limitingFactors.push('Doppler velocity unavailable — rotation cannot be verified');
  } else if (rotVal >= levelValue('VERY_HIGH')) {
    score += 2;
    increasingFactors.push('Extreme rotation detected in radar velocity data');
  } else if (rotVal >= levelValue('HIGH')) {
    score += 1.5;
    increasingFactors.push('Strong rotation signals in radar velocity');
  } else if (rotVal >= levelValue('MODERATE')) {
    score += 1;
    increasingFactors.push('Moderate rotation indicators');
  } else if (rotVal >= levelValue('MARGINAL')) {
    score += 0.5;
    increasingFactors.push('Weak rotation indicators');
  } else {
    limitingFactors.push('No significant rotation detected in radar data');
  }

  // Factor 4: Tornadic evidence — HARD GATE: requires velocity + dual-pol for debris
  if (!hasVelocity) {
    limitingFactors.push('Tornadic evidence not assessable without radar velocity');
  } else if (debrisSignature) {
    score += 2;
    increasingFactors.push('Debris signature consistent with tornadic circulation');
  } else if (evidVal >= levelValue('HIGH')) {
    score += 1.5;
    increasingFactors.push('Strong tornadic evidence in radar data');
  } else if (evidVal >= levelValue('MODERATE')) {
    score += 1;
    increasingFactors.push('Moderate tornadic indicators');
  }

  // ---- HARD GATING RULES ----

  // GATE 1: No organized storm → cap at MARGINAL
  if (structVal < levelValue('LOW') && !hasPrecipitation) {
    score = Math.min(score, 1.0);
    limitingFactors.push('GATE: No organized storm — assessment capped at LOW/MARGINAL');
  }

  // GATE 2: Environment alone (no storm, no rotation) → cap at LOW
  if (structVal < levelValue('LOW') && rotVal < levelValue('MARGINAL') && !debrisSignature) {
    score = Math.min(score, 0.8);
  }

  // GATE 3: Radar velocity unavailable → cap at MODERATE
  if (!hasVelocity) {
    score = Math.min(score, 2.5);
    limitingFactors.push('GATE: Velocity unavailable — assessment capped at MODERATE');
  }

  // GATE 4: Single scan → cannot claim persistence/strengthening bonus
  if (scanCount <= 1 && hasCouplet) {
    limitingFactors.push('Only one radar scan — trend/persistence cannot be determined');
  }

  // GATE 5: No dual-pol → debris signature already false from evidence layer

  // Determine level from score
  let level: AssessmentLevel;
  if (score >= 6) level = 'VERY_HIGH';
  else if (score >= 4.5) level = 'HIGH';
  else if (score >= 3) level = 'MODERATE';
  else if (score >= 1.5) level = 'MARGINAL';
  else if (score >= 0.5) level = 'LOW';
  else level = 'VERY_LOW';

  // Build assessment text with specific details
  let text: string;
  if (debrisSignature) {
    text = 'Strong radar evidence consistent with tornadic circulation. Possible debris signature detected.';
  } else if (level === 'VERY_HIGH') {
    text = 'Highly favorable environment combined with organized storm and strong verified rotation.';
  } else if (level === 'HIGH') {
    text = 'Favorable environment with developing rotation. Tornadic development possible.';
  } else if (level === 'MODERATE') {
    text = hasVelocity
      ? 'Organized storm in favorable environment. Monitor for rotation development.'
      : 'Organized storm in favorable environment. Doppler velocity unavailable — rotation cannot be verified.';
  } else if (level === 'MARGINAL') {
    text = 'Some favorable factors present but insufficient evidence for elevated concern.';
  } else if (level === 'LOW') {
    text = 'Limited tornado-favorable signals in current data.';
  } else {
    text = 'Conditions not currently supportive of tornado development.';
  }

  // Build WHY explanation with specific data references
  const whyParts: string[] = [];
  if (increasingFactors.length > 0) {
    whyParts.push(`Factors increasing concern:\n${increasingFactors.map(f => `• \${f}`).join('\n')}`);
  }
  if (limitingFactors.length > 0) {
    whyParts.push(`Limiting factors:\n${limitingFactors.map(f => `• \${f}`).join('\n')}`);
  }
  whyParts.push('This is an analytical estimate and NOT an official tornado warning.');

  return { level, text, why: whyParts.join('\n\n') };
}

// ---- What Would Increase Concern ----

function buildWhatWouldIncreaseConcern(
  hasVelocity: boolean,
  hasPrecipitation: boolean,
  scanCount: number,
  debrisSignature: boolean,
): string[] {
  const suggestions: string[] = [];

  if (!hasPrecipitation) {
    suggestions.push('Organized storm develops in your area');
  }
  if (!hasVelocity) {
    suggestions.push('Doppler velocity data becomes available');
    suggestions.push('Low-level velocity couplet develops');
  } else {
    if (scanCount <= 1) {
      suggestions.push('Rotation persists across multiple radar scans');
    }
    if (!debrisSignature) {
      suggestions.push('Dual-pol debris signature appears');
    }
  }
  suggestions.push('Storm moves into stronger low-level shear');

  return suggestions;
}

// ---- Surface vs Atmospheric Environment Separation ----

function buildSurfaceEnvironment(input: AnalysisInput, env: any): {
  level: AssessmentLevel;
  description: string;
  capeAvailable: boolean;
  pressureTrendAvailable: boolean;
  factors: string[];
} {
  const factors: string[] = [];
  const capeAvailable = input.cape != null;
  const pressureAvailable = input.pressure != null;

  if (capeAvailable) factors.push(`CAPE: ${input.cape!.toFixed(0)} J/kg (observed)`);
  if (input.dewPoint != null) factors.push(`Dewpoint: ${input.dewPoint.toFixed(0)}°F (observed)`);
  if (pressureAvailable && env.pressureChange60Min != null) {
    factors.push(`Pressure trend: ${env.pressureTrend} (${env.pressureChange60Min.toFixed(3)} inHg/60min)`);
  }

  let level: AssessmentLevel = 'UNKNOWN';
  let description = 'Insufficient surface data';

  if (capeAvailable || pressureAvailable) {
    if (levelValue(env.level) >= levelValue('MODERATE')) {
      level = 'MODERATE';
      description = 'Surface environment appears favorable';
    } else if (levelValue(env.level) >= levelValue('MARGINAL')) {
      level = 'MARGINAL';
      description = 'Surface environment marginally favorable';
    } else {
      level = 'LOW';
      description = 'Surface environment not particularly favorable';
    }
  }

  return { level, description, capeAvailable, pressureTrendAvailable: pressureAvailable, factors };
}

function buildAtmosphericEnvironment(input: AnalysisInput): {
  level: AssessmentLevel;
  description: string;
  shearAvailable: boolean;
  srhAvailable: boolean;
  stpScpAvailable: boolean;
  factors: string[];
} {
  // Upper-air parameters (shear, SRH, STP, SCP) are NOT available
  // from surface observations or Open-Meteo current weather.
  return {
    level: 'UNKNOWN',
    description: 'Upper-air data unavailable — cannot assess full tornado environment',
    shearAvailable: false,
    srhAvailable: false,
    stpScpAvailable: false,
    factors: [
      '0-1 km shear: UNAVAILABLE',
      '0-6 km bulk shear: UNAVAILABLE',
      'Storm-relative helicity: UNAVAILABLE',
      'Significant Tornado Parameter: UNAVAILABLE',
      'Supercell Composite Parameter: UNAVAILABLE',
      'Requires sounding/profile data or a severe weather API',
    ],
  };
}

function buildDataFreshness(input: AnalysisInput): {
  weatherAgeMinutes: number | null;
  radarAgeMinutes: number | null;
  nwsAgeMinutes: number | null;
  isStale: boolean;
  description: string;
} {
  const now = Date.now();
  const radarTime = input.radarData?.latestFrameTime;
  const radarAgeMin = radarTime ? Math.round((now - radarTime * 1000) / 60000) : null;

  const isStale = radarAgeMin != null && radarAgeMin > 30;

  const parts: string[] = [];
  if (radarAgeMin != null) {
    parts.push(`Radar: ${radarAgeMin} min old`);
    if (radarAgeMin > 30) parts.push('(STALE)');
  } else {
    parts.push('Radar: no timestamp');
  }

  return {
    weatherAgeMinutes: null,
    radarAgeMinutes: radarAgeMin,
    nwsAgeMinutes: null,
    isStale,
    description: parts.join(' '),
  };
}

// ============================================================
// MAIN ANALYSIS FUNCTION
// ============================================================

export function analyzeStorm(
  input: AnalysisInput,
  previousAnalyses?: StormAnalysisResult[]
): StormAnalysisResult {
  const now = Date.now();

  // Layer A: Environmental Potential
  const environment = analyzeEnvironment(input);

  // Layer B: Storm Structure
  const stormStructure = analyzeStormStructure(input);

  // Layer C: Rotation Analysis
  const prevRotationAnalyses = previousAnalyses?.map(p => p.rotation) ?? [];
  const rotation = analyzeRotation(input, prevRotationAnalyses);

  // Layer D: Tornadic Evidence
  const tornadicEvidence = analyzeTornadicEvidence(input, rotation);

  // Extract key flags
  const hasRadar = input.radarData != null;
  const hasPrecipitation = input.radarData?.hasPrecipitation === true ||
    (input.radarData?.maxReflectivityDbz != null && input.radarData.maxReflectivityDbz > 20);
  const debrisSignature = tornadicEvidence.debrisSignature;
  const hasCouplet = rotation.hasCouplet;
  const hasStrongRotation = rotation.gateToGateShear != null && rotation.gateToGateShear > 60;

  const envFavorable = levelValue(environment.level) >= levelValue('MODERATE');

  // Progressive overall assessment
  const hasVelocity = input.radarData?.velocityPoints != null && input.radarData.velocityPoints.length > 0;
  const scanCount = rotation.verticalContinuity ?? 0;

  const overall = calculateProgressiveAssessment(
    environment.level,
    stormStructure.level,
    rotation.level,
    tornadicEvidence.level,
    hasRadar,
    hasVelocity,
    hasPrecipitation,
    debrisSignature,
    hasCouplet,
    hasStrongRotation,
    scanCount,
    envFavorable,
  );

  // NWS Status (separate)
  const nwsStatus = buildNwsStatus(input);

  // Storm Motion
  const radarData = input.radarData as any;
  const stormMotion = buildStormMotion(input, radarData?.stormCells);

  // Data Quality
  const dataQuality = assessDataQuality(input, hasVelocity, scanCount);

  const surfaceEnv = buildSurfaceEnvironment(input, environment);
  const atmosphericEnv = buildAtmosphericEnvironment(input);
  const freshness = buildDataFreshness(input);

  return {
    surfaceEnvironment: surfaceEnv,
    atmosphericEnvironment: atmosphericEnv,
    environment,
    stormStructure,
    rotation,
    tornadicEvidence,
    stormMotion,
    nwsStatus,
    dataQuality,
    overallAssessment: overall.level,
    assessmentText: overall.text,
    whyExplanation: overall.why,
    whatWouldIncreaseConcern: buildWhatWouldIncreaseConcern(hasVelocity, hasPrecipitation, scanCount, debrisSignature),
    dataFreshness: freshness,
    timestamp: now,
    latitude: input.latitude,
    longitude: input.longitude,
    lightningTrend: input.lightning?.trend ?? 'NONE',
  };
}
