// ============================================================
// Layer A — Environmental Tornado Potential Analysis
// ============================================================
// Surface observations are supplemented by provider-derived
// vertical environment when explicitly available. Missing
// upper-air data remains UNKNOWN/UNAVAILABLE.

import type { AnalysisInput, EnvironmentalAssessment, AssessmentLevel, DataAvailability, PressureTrendDirection } from './types';
import { calculateDirectionalShear, calculateWindShift } from './windVector';
import { calculateHeatIndex } from './heatIndex';

function assessCape(cape: number | null): { level: AssessmentLevel; availability: DataAvailability; description: string } {
  if (cape == null || !Number.isFinite(cape)) return { level: 'UNKNOWN', availability: 'UNAVAILABLE', description: 'CAPE data not available' };
  if (cape > 2500) return { level: 'VERY_HIGH', availability: 'AVAILABLE', description: `Very favorable CAPE (${cape.toFixed(0)} J/kg — strong instability)` };
  if (cape >= 1000) return { level: 'MODERATE', availability: 'AVAILABLE', description: `Favorable CAPE (${cape.toFixed(0)} J/kg — moderate instability)` };
  if (cape >= 300) return { level: 'MARGINAL', availability: 'AVAILABLE', description: `Marginal CAPE (${cape.toFixed(0)} J/kg — limited instability)` };
  return { level: 'LOW', availability: 'AVAILABLE', description: `Unfavorable CAPE (${cape.toFixed(0)} J/kg — weak instability)` };
}

function assessSurfaceMoisture(dewPoint: number | null, humidity: number | null): { score: number; description: string } {
  if (dewPoint == null && humidity == null) return { score: 0, description: 'No moisture data available' };
  let score = 0; const parts: string[] = [];
  if (dewPoint != null) {
    if (dewPoint > 65) { score = 1; parts.push(`Dewpoint ${dewPoint.toFixed(0)}°F — favorable moisture`); }
    else if (dewPoint >= 55) { score = 0.6; parts.push(`Dewpoint ${dewPoint.toFixed(0)}°F — marginal moisture`); }
    else { score = 0.2; parts.push(`Dewpoint ${dewPoint.toFixed(0)}°F — unfavorable moisture`); }
  }
  if (humidity != null) {
    const hs = humidity > 80 ? 0.9 : humidity > 60 ? 0.6 : humidity > 40 ? 0.3 : 0.1;
    score = Math.max(score, hs);
    parts.push(`Humidity ${humidity.toFixed(0)}% — ${humidity > 80 ? 'high moisture content' : humidity > 60 ? 'moderate moisture' : humidity > 40 ? 'relatively dry' : 'very dry'}`);
  }
  return { score, description: parts.join('; ') };
}

function assessSpread(temperature: number | null, dewPoint: number | null): { spread: number | null; score: number; description: string } {
  if (temperature == null || dewPoint == null) return { spread: null, score: 0, description: 'Temperature or dewpoint data unavailable' };
  const spread = temperature - dewPoint;
  if (spread < 5) return { spread, score: 1, description: `Very moist environment (spread ${spread.toFixed(1)}°F) — favorable for low cloud bases` };
  if (spread < 10) return { spread, score: 0.6, description: `Moist environment (spread ${spread.toFixed(1)}°F)` };
  if (spread < 15) return { spread, score: 0.3, description: `Moderate moisture (spread ${spread.toFixed(1)}°F)` };
  return { spread, score: 0.1, description: `Dry environment (spread ${spread.toFixed(1)}°F) — unfavorable` };
}

function analyzePressureTrend(current: number | null, observations: AnalysisInput['recentObservations']): { trend: PressureTrendDirection; change30Min: number | null; change60Min: number | null; score: number; description: string } {
  if (current == null) return { trend: 'STABLE', change30Min: null, change60Min: null, score: 0, description: 'No pressure data available' };
  const now = Date.now();
  const findNearest = (minutesAgo: number): number | null => {
    const target = now - minutesAgo * 60000; let closest: number | null = null; let minDiff = Infinity;
    for (const obs of observations) {
      if (obs.pressure == null || !Number.isFinite(obs.pressure)) continue;
      const diff = Math.abs(obs.timestamp - target);
      if (diff < minDiff && diff < minutesAgo * 0.5 * 60000) { minDiff = diff; closest = obs.pressure; }
    }
    return closest;
  };
  const p30 = findNearest(30), p60 = findNearest(60);
  const change30Min = p30 != null ? current - p30 : null;
  const change60Min = p60 != null ? current - p60 : null;
  let trend: PressureTrendDirection = 'STABLE', score = 0;
  if (change60Min != null) {
    if (change60Min < -0.06) { trend = 'FALLING'; score = Math.min(1, Math.abs(change60Min) / 0.15); }
    else if (change60Min > 0.06) { trend = 'RISING'; score = -Math.min(1, Math.abs(change60Min) / 0.15); }
  }
  const parts: string[] = [];
  if (change30Min != null) parts.push(`30-min: ${change30Min >= 0 ? '+' : ''}${(change30Min * 100).toFixed(1)} mb`);
  if (change60Min != null) parts.push(`60-min: ${change60Min >= 0 ? '+' : ''}${(change60Min * 100).toFixed(1)} mb`);
  return { trend, change30Min, change60Min, score, description: parts.length ? `${trend === 'FALLING' ? 'Pressure falling — favorable for storm development' : trend === 'RISING' ? 'Pressure rising — less favorable' : 'Pressure steady'} (${parts.join(', ')})` : 'Pressure data insufficient for trend analysis' };
}

function analyzeSurfaceWinds(input: AnalysisInput): { speedShearScore: number; directionalShear: { shearDegrees: number; shearRate: number; level: string }; windShift: { degrees: number; durationMinutes: number } | null; description: string } {
  let speedShearScore = 0;
  const obs = input.recentObservations.filter(o => o.windSpeed != null && Number.isFinite(o.windSpeed));
  if (obs.length >= 2) {
    const split = Math.floor(obs.length / 2);
    const first = obs.slice(0, split), second = obs.slice(split);
    const avgFirst = first.reduce((s, o) => s + o.windSpeed!, 0) / first.length;
    const avgSecond = second.reduce((s, o) => s + o.windSpeed!, 0) / second.length;
    const increase = avgSecond - avgFirst;
    if (increase > 10) speedShearScore = 0.8; else if (increase > 5) speedShearScore = 0.5; else if (increase > 0) speedShearScore = 0.2;
  }
  const dirShear = calculateDirectionalShear(obs.map(o => ({ windDirection: o.windDirection, windSpeed: o.windSpeed, timestamp: o.timestamp })));
  const windRecords = obs.filter(o => o.windDirection != null).map(o => ({ direction: o.windDirection!, timestamp: o.timestamp }));
  const windShift = calculateWindShift(windRecords);
  const parts: string[] = [];
  if (speedShearScore > 0.3) parts.push('Wind speed increasing with time (surface trend)');
  if (dirShear.level !== 'NONE') parts.push(`Directional shear: ${dirShear.shearDegrees.toFixed(0)}° over ${obs.length} obs`);
  if (windShift) parts.push(`Wind shift: ${windShift.degrees}° over ${windShift.durationMinutes} min`);
  return { speedShearScore, directionalShear: { shearDegrees: dirShear.shearDegrees, shearRate: dirShear.shearRate, level: dirShear.level }, windShift, description: parts.length ? parts.join('; ') : 'Insufficient wind data for surface trend analysis' };
}

function advancedLevel(advanced: NonNullable<AnalysisInput['advancedEnvironment']>): AssessmentLevel {
  const cape = advanced.capeJkg;
  const shear = advanced.deepLayerShear06KmKt;
  const srh = advanced.srh03M2s2;
  const stp = advanced.significantTornadoParameter;
  const scp = advanced.supercellCompositeParameter;
  const scores: number[] = [];
  if (cape != null && Number.isFinite(cape)) scores.push(cape > 2500 ? 1 : cape >= 1000 ? 0.7 : cape >= 300 ? 0.4 : 0.1);
  if (shear != null && Number.isFinite(shear)) scores.push(shear >= 60 ? 1 : shear >= 40 ? 0.7 : shear >= 20 ? 0.4 : 0.1);
  if (srh != null && Number.isFinite(srh)) scores.push(srh >= 200 ? 1 : srh >= 100 ? 0.7 : srh >= 50 ? 0.4 : 0.1);
  if (stp != null && Number.isFinite(stp)) scores.push(stp >= 3 ? 1 : stp >= 1 ? 0.7 : stp >= 0.5 ? 0.4 : 0.1);
  if (scp != null && Number.isFinite(scp)) scores.push(scp >= 6 ? 1 : scp >= 2 ? 0.7 : scp >= 1 ? 0.4 : 0.1);
  if (!scores.length) return 'UNKNOWN';
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return avg >= 0.75 ? 'VERY_HIGH' : avg >= 0.55 ? 'HIGH' : avg >= 0.35 ? 'MODERATE' : avg >= 0.15 ? 'MARGINAL' : 'LOW';
}

export function analyzeEnvironment(input: AnalysisInput): EnvironmentalAssessment {
  const advanced = input.advancedEnvironment;
  const effectiveCape = advanced?.capeJkg ?? input.cape;
  const capeResult = assessCape(effectiveCape);
  const heatIndex = calculateHeatIndex(input.temperature, input.humidity);
  const factors: string[] = [];
  let overallScore = 0, scoreCount = 0;

  if (capeResult.availability === 'AVAILABLE') {
    overallScore += capeResult.level === 'VERY_HIGH' ? 1 : capeResult.level === 'MODERATE' ? 0.7 : capeResult.level === 'MARGINAL' ? 0.4 : 0.1;
    scoreCount++; factors.push(capeResult.description);
  }
  const moisture = assessSurfaceMoisture(input.dewPoint, input.humidity);
  if (moisture.score > 0) { overallScore += moisture.score; scoreCount++; factors.push(moisture.description); }
  const spread = assessSpread(input.temperature, input.dewPoint);
  if (spread.spread != null) { overallScore += spread.score; scoreCount++; factors.push(spread.description); }
  const pressure = analyzePressureTrend(input.pressure, input.recentObservations);
  if (pressure.change60Min != null) { overallScore += Math.max(0, pressure.score); scoreCount++; factors.push(pressure.description); }
  const winds = analyzeSurfaceWinds(input);
  if (winds.speedShearScore > 0 || winds.directionalShear.level !== 'NONE') {
    overallScore += (winds.speedShearScore + (winds.directionalShear.level === 'STRONG' ? 0.8 : winds.directionalShear.level === 'MODERATE' ? 0.5 : winds.directionalShear.level === 'WEAK' ? 0.2 : 0)) / 2;
    scoreCount++; factors.push(winds.description);
  }
  if (heatIndex.heatIndexF != null) factors.push(`Heat index: ${heatIndex.heatIndexF.toFixed(1)}°F — ${heatIndex.category?.replace('_', ' ').toLowerCase() ?? 'available'}`);

  let level: AssessmentLevel;
  const advancedIsUsable = advanced != null && advanced.availability !== 'UNAVAILABLE';
  const advLevel = advancedIsUsable ? advancedLevel(advanced) : 'UNKNOWN';
  if (advancedIsUsable && advLevel !== 'UNKNOWN') {
    // Vertical profile data is more directly relevant to the tornado environment than surface trends.
    // Blend it conservatively with the surface assessment; do not double-count STP/SCP as independent evidence.
    const surfaceAvg = scoreCount > 0 ? overallScore / scoreCount : 0;
    const advVal = ({ VERY_HIGH: 1, HIGH: 0.7, MODERATE: 0.5, MARGINAL: 0.3, LOW: 0.1, VERY_LOW: 0, UNKNOWN: 0 } as Record<AssessmentLevel, number>)[advLevel];
    const blended = scoreCount > 0 ? (surfaceAvg + advVal) / 2 : advVal;
    level = blended >= 0.75 ? 'VERY_HIGH' : blended >= 0.55 ? 'HIGH' : blended >= 0.35 ? 'MODERATE' : blended >= 0.15 ? 'MARGINAL' : 'LOW';
    factors.push(`Advanced vertical environment: ${advLevel}`);
    if (advanced.deepLayerShear06KmKt != null) factors.push(`0-6 km bulk shear: ${advanced.deepLayerShear06KmKt.toFixed(1)} kt`);
    if (advanced.srh03M2s2 != null) factors.push(`0-3 km SRH: ${advanced.srh03M2s2.toFixed(0)} m²/s²`);
    if (advanced.lclHeightM != null) factors.push(`LCL height: ${advanced.lclHeightM.toFixed(0)} m`);
    if (advanced.significantTornadoParameter != null) factors.push(`STP: ${advanced.significantTornadoParameter.toFixed(2)}`);
    if (advanced.supercellCompositeParameter != null) factors.push(`SCP: ${advanced.supercellCompositeParameter.toFixed(2)}`);
    factors.push(...advanced.limitations);
  } else {
    const avg = scoreCount > 0 ? overallScore / scoreCount : 0;
    level = avg >= 0.75 ? 'VERY_HIGH' : avg >= 0.55 ? 'HIGH' : avg >= 0.35 ? 'MODERATE' : avg >= 0.15 ? 'MARGINAL' : scoreCount > 0 ? 'LOW' : 'UNKNOWN';
  }

  const capeAvailable: DataAvailability = effectiveCape != null ? 'AVAILABLE' : 'UNAVAILABLE';
  const hasWindData = input.windSpeed != null && input.recentObservations.length >= 2;
  const shearAvail: DataAvailability = advancedIsUsable && (advanced?.lowLevelShear01KmKt != null || advanced?.deepLayerShear06KmKt != null) ? 'AVAILABLE' : hasWindData ? 'PARTIAL' : 'UNAVAILABLE';
  const helicityAvail: DataAvailability = advancedIsUsable && (advanced?.srh01M2s2 != null || advanced?.srh03M2s2 != null) ? 'AVAILABLE' : 'UNAVAILABLE';
  const compositeAvail: DataAvailability = advancedIsUsable && (advanced?.significantTornadoParameter != null || advanced?.supercellCompositeParameter != null) ? 'AVAILABLE' : 'UNAVAILABLE';

  const desc = level === 'VERY_HIGH' || level === 'HIGH'
    ? 'Environment is favorable for tornado development.'
    : level === 'MODERATE' ? 'Environment partially supports severe storm development.'
    : level === 'MARGINAL' ? 'Environment marginally supports severe weather.'
    : level === 'LOW' ? 'Environment is generally unfavorable for tornadoes.'
    : 'Insufficient environmental data to assess tornado potential.';

  return {
    level,
    cape: effectiveCape,
    cin: advanced?.cinJkg ?? null,
    surfaceTempF: input.temperature,
    surfaceDewPointF: input.dewPoint,
    surfaceHumidity: input.humidity,
    heatIndexF: heatIndex.heatIndexF,
    heatIndexCategory: heatIndex.category,
    surfaceWindSpeed: input.windSpeed,
    surfaceWindDirection: input.windDirection,
    pressureTrend: pressure.trend,
    pressureChange30Min: pressure.change30Min,
    pressureChange60Min: pressure.change60Min,
    lowLevelShear: advanced?.lowLevelShear01KmKt ?? (winds.directionalShear.shearDegrees > 0 ? winds.directionalShear.shearDegrees : null),
    deepLayerShear: advanced?.deepLayerShear06KmKt ?? null,
    srh: advanced?.srh03M2s2 ?? null,
    lclHeight: advanced?.lclHeightM ?? null,
    significantTornadoParam: advanced?.significantTornadoParameter ?? null,
    supercellComposite: advanced?.supercellCompositeParameter ?? null,
    dataAvailability: { cape: capeAvailable, shear: shearAvail, helicity: helicityAvail, compositeParams: compositeAvail },
    description: desc + (advancedIsUsable ? ' Vertical profile data is included where available.' : ' Upper-air shear, helicity, and composite parameters remain unavailable without a vertical profile.'),
    factors,
  };
}
