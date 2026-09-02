// ============================================================
// Progressive Storm Development Assessment Engine
// ============================================================
//
// Safety rule: this layer may only claim what the supplied data can
// actually support. Missing/unsupported radar products remain unknown.
// NWS watches/warnings are displayed separately from StormLog analysis.

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

const LEVEL_ORDER: Record<AssessmentLevel, number> = {
  VERY_LOW: 0, LOW: 1, MARGINAL: 2, MODERATE: 3, HIGH: 4, VERY_HIGH: 5, UNKNOWN: -1,
};

function levelValue(level: AssessmentLevel): number { return LEVEL_ORDER[level] ?? -1; }

export function getAssessmentEmoji(level: AssessmentLevel): string {
  switch (level) {
    case 'VERY_HIGH': return '🔴';
    case 'HIGH': return '🟠';
    case 'MODERATE': case 'MARGINAL': return '🟡';
    case 'LOW': case 'VERY_LOW': return '🟢';
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

function buildNwsStatus(input: AnalysisInput): NwsWarningStatus {
  const alerts = input.nwsAlerts ?? [];
  const tornadoWarning = alerts.some(a => a.event?.includes('Tornado Warning'));
  const tornadoWatch = alerts.some(a => a.event?.includes('Tornado Watch'));
  const severeWarning = alerts.some(a => a.event?.includes('Severe Thunderstorm Warning'));
  const severeWatch = alerts.some(a => a.event?.includes('Severe Thunderstorm Watch'));
  const activeAlerts = alerts.map(a => ({ event: a.event, severity: a.severity, headline: a.headline }));
  const parts: string[] = [];
  if (tornadoWarning) parts.push('Tornado Warning');
  else if (tornadoWatch) parts.push('Tornado Watch');
  if (severeWarning) parts.push('Severe Thunderstorm Warning');
  else if (severeWatch && !tornadoWatch) parts.push('Severe Thunderstorm Watch');
  if (!parts.length) parts.push('No active NWS watch/warning');
  return { tornadoWarning, tornadoWatch, severeWarning, severeWatch, activeAlerts, description: parts.join(' · ') };
}

function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dl = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function buildStormMotion(input: AnalysisInput, stormCells: any[] | undefined): StormMotion | null {
  // Storm motion is only valid when an actual tracked cell supplies motion.
  if (!stormCells?.length) return null;
  let closest: any = null;
  let minDistance = Infinity;
  for (const cell of stormCells) {
    if (!Number.isFinite(cell?.latitude) || !Number.isFinite(cell?.longitude)) continue;
    const distance = haversineDistance(input.latitude, input.longitude, cell.latitude, cell.longitude);
    if (distance < minDistance) { minDistance = distance; closest = cell; }
  }
  if (!closest) return null;

  const bearing = calculateBearing(input.latitude, input.longitude, closest.latitude, closest.longitude);
  const motion = Number.isFinite(closest.movement) ? closest.movement : null;
  const speed = Number.isFinite(closest.speed) ? closest.speed : null;
  let approaching: boolean | null = null;
  if (motion != null) {
    const towardUser = (bearing + 180) % 360;
    let diff = Math.abs(motion - towardUser) % 360;
    if (diff > 180) diff = 360 - diff;
    approaching = diff < 90;
  }
  let description = approaching === true ? 'Toward user' : approaching === false ? 'Away or crossing' : 'Direction unknown';
  if (speed != null) description += ` · ${speed.toFixed(0)} mph`;
  return {
    distanceMiles: minDistance * 0.621371,
    bearingDegrees: bearing,
    speedMph: speed,
    directionDegrees: motion,
    approaching,
    description,
  };
}

function assessDataQuality(input: AnalysisInput, hasVelocity: boolean, scanCount: number): DataQuality {
  const limitations: string[] = [];
  const hasRadar = input.radarData?.available === true;
  const radarCoverage: DataAvailability = hasRadar ? 'AVAILABLE' : 'UNAVAILABLE';
  if (!hasRadar) limitations.push('Quantitative radar data unavailable');

  const velocityData: DataAvailability = hasVelocity ? 'AVAILABLE' : 'UNAVAILABLE';
  if (!hasVelocity) {
    limitations.push(hasRadar
      ? 'Doppler velocity unavailable from the current radar provider'
      : 'Doppler velocity unavailable because radar data is unavailable');
  }

  const advanced = input.advancedEnvironment;
  const hasCape = advanced?.capeJkg != null || input.cape != null;
  const hasPressure = input.pressure != null;
  const hasWind = input.windSpeed != null;
  const envScore = Number(hasCape) + Number(hasPressure) + Number(hasWind);
  const environmentalData: DataAvailability = advanced?.availability === 'AVAILABLE'
    ? 'AVAILABLE'
    : envScore >= 2 ? 'PARTIAL' : envScore >= 1 ? 'PARTIAL' : 'UNAVAILABLE';
  if (!hasCape) limitations.push('CAPE unavailable — instability assessment limited');
  if (advanced?.availability === 'PARTIAL') limitations.push(...advanced.limitations);

  const stationCount = input.nearbyStations?.length ?? 0;
  const surfaceStations: DataAvailability = stationCount >= 4 ? 'AVAILABLE' : stationCount >= 2 ? 'PARTIAL' : 'UNAVAILABLE';
  if (stationCount < 4) limitations.push(`Only ${stationCount} nearby surface station${stationCount === 1 ? '' : 's'} available`);

  if (scanCount <= 1 && hasRadar) limitations.push('Insufficient independent radar scans to establish persistence/trend');

  const radarAny = input.radarData as any;
  const hasDualPol = Number.isFinite(radarAny?.correlationCoefficient) || Number.isFinite(radarAny?.cc);
  if (!hasDualPol) limitations.push('Dual-pol correlation data unavailable — debris signature cannot be verified');

  let score = 0;
  if (hasRadar) score += 1;
  if (hasVelocity) score += 2;
  if (scanCount >= 3) score += 1;
  if (environmentalData !== 'UNAVAILABLE') score += 1;
  if (surfaceStations !== 'UNAVAILABLE') score += 0.5;
  if (hasDualPol) score += 0.5;
  const level: ConfidenceLevel = score >= 5 ? 'HIGH' : score >= 3 ? 'MODERATE' : score >= 1.5 ? 'LOW' : 'UNKNOWN';
  return {
    level,
    radarCoverage,
    environmentalData,
    surfaceStations,
    velocityData,
    description: `${level} confidence — ${hasVelocity ? 'radar velocity available' : 'radar velocity unavailable'}`,
    limitations,
  };
}

interface OverallResult { level: AssessmentLevel; text: string; why: string; }

function calculateProgressiveAssessment(
  environment: AssessmentLevel,
  structure: AssessmentLevel,
  rotation: AssessmentLevel,
  evidence: AssessmentLevel,
  hasVelocity: boolean,
  hasPrecipitation: boolean,
  debris: boolean,
  hasCouplet: boolean,
  scanCount: number,
): OverallResult {
  const env = levelValue(environment), str = levelValue(structure), rot = levelValue(rotation), evid = levelValue(evidence);
  const increasing: string[] = [];
  const limiting: string[] = [];
  let score = 0;

  if (env >= levelValue('VERY_HIGH')) { score += 2; increasing.push('Highly favorable tornado environment'); }
  else if (env >= levelValue('MODERATE')) { score += 1.5; increasing.push('Favorable environment for tornado development'); }
  else if (env >= levelValue('MARGINAL')) { score += 0.5; increasing.push('Marginally favorable environment'); }
  else if (env >= 0) limiting.push('Environment not particularly favorable for tornadoes');

  if (str >= levelValue('HIGH')) { score += 2; increasing.push('Organized storm structure detected'); }
  else if (str >= levelValue('MODERATE')) { score += 1.5; increasing.push('Strong storm signal detected'); }
  else if (str >= levelValue('MARGINAL')) { score += 1; increasing.push('Convective activity detected'); }
  else if (hasPrecipitation) { score += 0.5; increasing.push('Radar precipitation imagery available'); }
  else limiting.push('No quantitative storm-structure signal available');

  if (!hasVelocity) {
    if (rot >= levelValue('MODERATE')) { score += 0.5; increasing.push('Surface convergence pattern noted (not radar-confirmed)'); }
    limiting.push('Doppler velocity unavailable — rotation cannot be verified');
  } else if (rot >= levelValue('VERY_HIGH')) { score += 2; increasing.push('Extreme rotation detected in radar velocity data'); }
  else if (rot >= levelValue('HIGH')) { score += 1.5; increasing.push('Strong rotation signals in radar velocity'); }
  else if (rot >= levelValue('MODERATE')) { score += 1; increasing.push('Moderate rotation indicators'); }
  else if (rot >= levelValue('MARGINAL')) { score += 0.5; increasing.push('Weak rotation indicators'); }
  else limiting.push('No significant rotation detected in available data');

  if (!hasVelocity) limiting.push('Tornadic radar evidence cannot be verified without Doppler velocity');
  else if (debris) { score += 2; increasing.push('Dual-pol/velocity evidence consistent with a debris signature'); }
  else if (evid >= levelValue('HIGH')) { score += 1.5; increasing.push('Strong tornadic indicators in radar data'); }
  else if (evid >= levelValue('MODERATE')) { score += 1; increasing.push('Moderate tornadic indicators'); }

  if (str < levelValue('LOW') && !hasPrecipitation) { score = Math.min(score, 1); limiting.push('GATE: No quantitative storm signal — assessment capped at LOW'); }
  if (!hasVelocity) { score = Math.min(score, 2.5); limiting.push('GATE: Velocity unavailable — assessment capped at MODERATE'); }
  if (scanCount <= 1 && hasCouplet) limiting.push('Single radar scan — persistence cannot be determined');

  const level: AssessmentLevel = score >= 6 ? 'VERY_HIGH' : score >= 4.5 ? 'HIGH' : score >= 3 ? 'MODERATE' : score >= 1.5 ? 'MARGINAL' : score >= 0.5 ? 'LOW' : 'VERY_LOW';
  const text = debris
    ? 'Radar evidence is consistent with tornadic circulation; a debris signature is indicated by the available dual-pol/velocity data.'
    : level === 'VERY_HIGH' ? 'Highly favorable environment combined with organized storm and strong verified rotation.'
    : level === 'HIGH' ? 'Favorable environment with developing verified rotation. Tornadic development is possible.'
    : level === 'MODERATE' ? hasVelocity ? 'Organized storm in a favorable environment. Monitor for verified rotation development.' : 'Organized storm/environmental signals present, but Doppler velocity is unavailable and rotation cannot be verified.'
    : level === 'MARGINAL' ? 'Some favorable factors are present, but evidence remains insufficient for elevated concern.'
    : level === 'LOW' ? 'Limited tornado-favorable signals in current available data.'
    : 'Insufficient evidence to assess meaningful tornado potential.';
  const why: string[] = [];
  if (increasing.length) why.push(`Factors increasing concern:\n${increasing.map(f => `• ${f}`).join('\n')}`);
  if (limiting.length) why.push(`Limiting factors:\n${limiting.map(f => `• ${f}`).join('\n')}`);
  why.push('This is a StormLog analytical assessment and NOT an official tornado warning. Follow NWS warnings and field safety procedures.');
  return { level, text, why: why.join('\n\n') };
}

function buildWhatWouldIncreaseConcern(hasVelocity: boolean, hasPrecipitation: boolean, scanCount: number, debris: boolean): string[] {
  const out: string[] = [];
  if (!hasPrecipitation) out.push('Quantitative storm/radar signal becomes available');
  if (!hasVelocity) { out.push('A real Doppler velocity product becomes available'); out.push('A low-level velocity couplet becomes measurable'); }
  else {
    if (scanCount <= 1) out.push('Verified rotation persists across multiple independent radar scans');
    if (!debris) out.push('A validated dual-pol debris signature appears with supporting velocity evidence');
  }
  out.push('Storm enters a more favorable low-level thermodynamic/kinematic environment');
  return out;
}

function buildSurfaceEnvironment(input: AnalysisInput, env: ReturnType<typeof analyzeEnvironment>) {
  const factors: string[] = [];
  if (env.cape != null) factors.push(`CAPE: ${env.cape.toFixed(0)} J/kg`);
  if (input.dewPoint != null) factors.push(`Dewpoint: ${input.dewPoint.toFixed(0)}°F`);
  if (env.pressureChange60Min != null) factors.push(`Pressure trend: ${env.pressureTrend} (${(env.pressureChange60Min * 100).toFixed(1)} mb/60 min)`);
  return {
    level: env.level,
    description: env.cape != null || input.pressure != null ? 'Surface/environmental observations available' : 'Insufficient surface data',
    capeAvailable: env.cape != null,
    pressureTrendAvailable: input.pressure != null,
    factors,
  };
}

function buildAtmosphericEnvironment(input: AnalysisInput): StormAnalysisResult['atmosphericEnvironment'] {
  const advanced = input.advancedEnvironment;
  if (!advanced || advanced.availability === 'UNAVAILABLE') {
    return {
      level: 'UNKNOWN',
      description: 'Upper-air profile data unavailable — full vertical tornado environment cannot be assessed',
      shearAvailable: false,
      srhAvailable: false,
      stpScpAvailable: false,
      factors: ['0-1 km shear: UNAVAILABLE', '0-6 km bulk shear: UNAVAILABLE', 'Storm-relative helicity: UNAVAILABLE', 'STP/SCP: UNAVAILABLE'],
    };
  }
  const values = [advanced.lowLevelShear01KmKt, advanced.deepLayerShear06KmKt, advanced.srh03M2s2, advanced.significantTornadoParameter, advanced.supercellCompositeParameter].filter(v => v != null && Number.isFinite(v));
  const level: AssessmentLevel = values.length === 0 ? 'UNKNOWN' : advanced.availability === 'PARTIAL' ? 'MODERATE' : 'MODERATE';
  const factors: string[] = [];
  if (advanced.lowLevelShear01KmKt != null) factors.push(`0-1 km shear: ${advanced.lowLevelShear01KmKt.toFixed(1)} kt`);
  if (advanced.deepLayerShear06KmKt != null) factors.push(`0-6 km bulk shear: ${advanced.deepLayerShear06KmKt.toFixed(1)} kt`);
  if (advanced.srh03M2s2 != null) factors.push(`0-3 km SRH: ${advanced.srh03M2s2.toFixed(0)} m²/s²`);
  if (advanced.significantTornadoParameter != null) factors.push(`STP: ${advanced.significantTornadoParameter.toFixed(2)}`);
  if (advanced.supercellCompositeParameter != null) factors.push(`SCP: ${advanced.supercellCompositeParameter.toFixed(2)}`);
  factors.push(...advanced.limitations);
  return {
    level,
    description: advanced.availability === 'PARTIAL' ? 'Partial upper-air environment data available' : 'Advanced vertical environment data available',
    shearAvailable: advanced.lowLevelShear01KmKt != null || advanced.deepLayerShear06KmKt != null,
    srhAvailable: advanced.srh01M2s2 != null || advanced.srh03M2s2 != null,
    stpScpAvailable: advanced.significantTornadoParameter != null || advanced.supercellCompositeParameter != null,
    factors,
  };
}

function buildDataFreshness(input: AnalysisInput): StormAnalysisResult['dataFreshness'] {
  const now = Date.now();
  const radarTime = input.radarData?.latestFrameTime;
  const radarAgeMinutes = radarTime != null && Number.isFinite(radarTime)
    ? Math.max(0, Math.round((now - radarTime * 1000) / 60000))
    : null;
  const isStale = radarAgeMinutes != null && radarAgeMinutes > 30;
  return {
    weatherAgeMinutes: null,
    radarAgeMinutes,
    nwsAgeMinutes: null,
    isStale,
    description: radarAgeMinutes == null ? 'Radar: no valid observation timestamp' : `Radar: ${radarAgeMinutes} min old${isStale ? ' (STALE)' : ''}`,
  };
}

export function analyzeStorm(input: AnalysisInput, previousAnalyses?: StormAnalysisResult[]): StormAnalysisResult {
  const timestamp = Date.now();
  const environment = analyzeEnvironment(input);
  const stormStructure = analyzeStormStructure(input);
  const previousRotation = previousAnalyses?.map(p => p.rotation) ?? [];
  const rotation = analyzeRotation(input, previousRotation);
  const tornadicEvidence = analyzeTornadicEvidence(input, rotation);

  const hasRadar = input.radarData?.available === true;
  const hasVelocity = hasRadar && (input.radarData?.velocityPoints?.length ?? 0) > 0;
  const hasPrecipitation = hasRadar && input.radarData?.hasPrecipitation === true;
  const debrisSignature = tornadicEvidence.debrisSignature;
  const hasCouplet = rotation.hasCouplet;
  const scanCount = previousAnalyses ? previousAnalyses.length + 1 : 1;

  const overall = calculateProgressiveAssessment(
    environment.level,
    stormStructure.level,
    rotation.level,
    tornadicEvidence.level,
    hasVelocity,
    hasPrecipitation,
    debrisSignature,
    hasCouplet,
    scanCount,
  );

  const nwsStatus = buildNwsStatus(input);
  const stormMotion = buildStormMotion(input, input.radarData?.stormCells);
  const dataQuality = assessDataQuality(input, hasVelocity, scanCount);
  const surfaceEnvironment = buildSurfaceEnvironment(input, environment);
  const atmosphericEnvironment = buildAtmosphericEnvironment(input);

  return {
    surfaceEnvironment,
    atmosphericEnvironment,
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
    dataFreshness: buildDataFreshness(input),
    timestamp,
    latitude: input.latitude,
    longitude: input.longitude,
    lightningTrend: input.lightning?.trend ?? 'NONE',
  };
}
