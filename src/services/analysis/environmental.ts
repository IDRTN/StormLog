// ============================================================
// Layer A — Environmental Tornado Potential Analysis
// ============================================================
//
// Evaluates thermodynamic and kinematic environment for
// tornado-favorable conditions using surface observations,
// CAPE (if available from Open-Meteo), and pressure trends.
//
// CRITICAL: This module does NOT fabricate shear, SRH, LCL,
// STP, or SCP values. Those are marked UNAVAILABLE unless
// explicitly provided by a data source.

import type {
  AnalysisInput,
  EnvironmentalAssessment,
  AssessmentLevel,
  DataAvailability,
  PressureTrendDirection,
} from './types';
import {
  calculateDirectionalShear,
  calculateWindShift,
} from './windVector';

// ---- CAPE Assessment ----

function assessCape(cape: number | null): {
  level: AssessmentLevel;
  availability: DataAvailability;
  description: string;
} {
  if (cape == null) {
    return {
      level: 'UNKNOWN',
      availability: 'UNAVAILABLE',
      description: 'CAPE data not available',
    };
  }

  if (cape > 2500) {
    return {
      level: 'VERY_HIGH',
      availability: 'AVAILABLE',
      description: `Very favorable CAPE (${cape.toFixed(0)} J/kg — strong instability)`,
    };
  }
  if (cape >= 1000) {
    return {
      level: 'MODERATE',
      availability: 'AVAILABLE',
      description: `Favorable CAPE (${cape.toFixed(0)} J/kg — moderate instability)`,
    };
  }
  if (cape >= 300) {
    return {
      level: 'MARGINAL',
      availability: 'AVAILABLE',
      description: `Marginal CAPE (${cape.toFixed(0)} J/kg — limited instability)`,
    };
  }
  return {
    level: 'LOW',
    availability: 'AVAILABLE',
    description: `Unfavorable CAPE (${cape.toFixed(0)} J/kg — weak instability)`,
  };
}

// ---- Surface Moisture Analysis ----

function assessSurfaceMoisture(
  dewPoint: number | null,
  humidity: number | null,
): { score: number; description: string } {
  if (dewPoint == null && humidity == null) {
    return { score: 0, description: 'No moisture data available' };
  }

  let moistureScore = 0;
  const parts: string[] = [];

  if (dewPoint != null) {
    if (dewPoint > 65) {
      moistureScore = 1.0;
      parts.push(`Dewpoint ${dewPoint.toFixed(0)}°F — favorable moisture`);
    } else if (dewPoint >= 55) {
      moistureScore = 0.6;
      parts.push(`Dewpoint ${dewPoint.toFixed(0)}°F — marginal moisture`);
    } else {
      moistureScore = 0.2;
      parts.push(`Dewpoint ${dewPoint.toFixed(0)}°F — unfavorable moisture`);
    }
  }

  if (humidity != null) {
    if (humidity > 80) {
      moistureScore = Math.max(moistureScore, 0.9);
      parts.push(`Humidity ${humidity.toFixed(0)}% — high moisture content`);
    } else if (humidity > 60) {
      moistureScore = Math.max(moistureScore, 0.6);
      parts.push(`Humidity ${humidity.toFixed(0)}% — moderate moisture`);
    } else if (humidity > 40) {
      moistureScore = Math.max(moistureScore, 0.3);
      parts.push(`Humidity ${humidity.toFixed(0)}% — relatively dry`);
    } else {
      moistureScore = Math.max(moistureScore, 0.1);
      parts.push(`Humidity ${humidity.toFixed(0)}% — very dry`);
    }
  }

  return { score: moistureScore, description: parts.join('; ') };
}

// ---- Temperature-Dewpoint Spread ----

function assessSpread(temperature: number | null, dewPoint: number | null): {
  spread: number | null;
  score: number;
  description: string;
} {
  if (temperature == null || dewPoint == null) {
    return { spread: null, score: 0, description: 'Temperature or dewpoint data unavailable' };
  }

  const spread = temperature - dewPoint;

  if (spread < 5) {
    return {
      spread,
      score: 1.0,
      description: `Very moist environment (spread ${spread.toFixed(1)}°F) — favorable for low cloud bases`,
    };
  }
  if (spread < 10) {
    return {
      spread,
      score: 0.6,
      description: `Moist environment (spread ${spread.toFixed(1)}°F)`,
    };
  }
  if (spread < 15) {
    return {
      spread,
      score: 0.3,
      description: `Moderate moisture (spread ${spread.toFixed(1)}°F)`,
    };
  }
  return {
    spread,
    score: 0.1,
    description: `Dry environment (spread ${spread.toFixed(1)}°F) — unfavorable`,
  };
}

// ---- Pressure Tendency ----

function analyzePressureTrend(
  current: number | null,
  recentObservations: AnalysisInput['recentObservations'],
): {
  trend: PressureTrendDirection;
  change30Min: number | null;
  change60Min: number | null;
  score: number;
  description: string;
} {
  if (current == null) {
    return {
      trend: 'STABLE',
      change30Min: null,
      change60Min: null,
      score: 0,
      description: 'No pressure data available',
    };
  }

  const now = Date.now();

  // Find the most relevant historical observations
  const findNearest = (minutesAgo: number): number | null => {
    const target = now - minutesAgo * 60000;
    let closest: number | null = null;
    let minDiff = Infinity;
    for (const obs of recentObservations) {
      if (obs.pressure == null) continue;
      const diff = Math.abs(obs.timestamp - target);
      if (diff < minDiff && diff < minutesAgo * 0.5 * 60000) {
        minDiff = diff;
        closest = obs.pressure;
      }
    }
    return closest;
  };

  const p30 = findNearest(30);
  const p60 = findNearest(60);

  const change30Min = p30 != null ? current - p30 : null;
  const change60Min = p60 != null ? current - p60 : null;

  let trend: PressureTrendDirection = 'STABLE';
  let score = 0;

  if (change60Min != null) {
    if (change60Min < -0.06) {
      trend = 'FALLING';
      score = Math.min(1.0, Math.abs(change60Min) / 0.15);
    } else if (change60Min > 0.06) {
      trend = 'RISING';
      score = -Math.min(1.0, Math.abs(change60Min) / 0.15);
    }
  }

  const parts: string[] = [];
  if (change30Min != null) {
    parts.push(`30-min: ${change30Min >= 0 ? '+' : ''}${(change30Min * 100).toFixed(1)} mb`);
  }
  if (change60Min != null) {
    parts.push(`60-min: ${change60Min >= 0 ? '+' : ''}${(change60Min * 100).toFixed(1)} mb`);
  }

  const trendDesc = trend === 'FALLING'
    ? 'Pressure falling — favorable for storm development'
    : trend === 'RISING'
      ? 'Pressure rising — less favorable'
      : 'Pressure steady';

  return {
    trend,
    change30Min,
    change60Min,
    score,
    description: parts.length > 0
      ? `${trendDesc} (${parts.join(', ')})`
      : 'Pressure data insufficient for trend analysis',
  };
}

// ---- Surface Wind Analysis ----

function analyzeSurfaceWinds(
  input: AnalysisInput,
): {
  speedShearScore: number;
  directionalShear: { shearDegrees: number; shearRate: number; level: string };
  windShift: { degrees: number; durationMinutes: number } | null;
  description: string;
} {
  // Speed shear: wind speed increasing over time suggests strengthening low-level jet
  let speedShearScore = 0;
  const obs = input.recentObservations.filter(o => o.windSpeed != null);

  if (obs.length >= 2) {
    const first = obs.slice(0, Math.floor(obs.length / 2));
    const second = obs.slice(Math.floor(obs.length / 2));

    const avgFirst = first.reduce((s, o) => s + o.windSpeed!, 0) / first.length;
    const avgSecond = second.reduce((s, o) => s + o.windSpeed!, 0) / second.length;

    const speedIncrease = avgSecond - avgFirst;
    if (speedIncrease > 10) speedShearScore = 0.8;
    else if (speedIncrease > 5) speedShearScore = 0.5;
    else if (speedIncrease > 0) speedShearScore = 0.2;
  }

  // Directional shear from recent observations
  const dirShear = calculateDirectionalShear(
    obs.map(o => ({
      windDirection: o.windDirection,
      windSpeed: o.windSpeed,
      timestamp: o.timestamp,
    }))
  );

  // Directional shear in NH: backing winds (counter-clockwise) can indicate warm air advection
  // veering winds can indicate cold air advection; backing in lower levels is favorable
  const windRecords = obs
    .filter(o => o.windDirection != null)
    .map(o => ({ direction: o.windDirection!, timestamp: o.timestamp }));

  const windShift = calculateWindShift(windRecords);

  const parts: string[] = [];
  if (speedShearScore > 0.3) {
    parts.push(`Wind speed increasing with time (speed shear)`);
  }
  if (dirShear.level !== 'NONE') {
    parts.push(`Directional shear: ${dirShear.shearDegrees.toFixed(0)}° over ${obs.length} obs`);
  }
  if (windShift) {
    parts.push(`Wind shift: ${windShift.degrees}° over ${windShift.durationMinutes} min`);
  }

  return {
    speedShearScore,
    directionalShear: {
      shearDegrees: dirShear.shearDegrees,
      shearRate: dirShear.shearRate,
      level: dirShear.level,
    },
    windShift,
    description: parts.length > 0 ? parts.join('; ') : 'Insufficient wind data for shear analysis',
  };
}

// ---- Helper to format dewpoint ----
function dewpoint(d: number): string {
  return d.toFixed(0);
}

// ============================================================
// MAIN FUNCTION
// ============================================================

export function analyzeEnvironment(input: AnalysisInput): EnvironmentalAssessment {
  const factors: string[] = [];
  let overallScore = 0;
  let scoreCount = 0;

  // 1. CAPE analysis
  const capeResult = assessCape(input.cape);
  if (capeResult.availability === 'AVAILABLE') {
    const capeScore =
      capeResult.level === 'VERY_HIGH' ? 1.0 :
      capeResult.level === 'MODERATE' ? 0.7 :
      capeResult.level === 'MARGINAL' ? 0.4 : 0.1;
    overallScore += capeScore;
    scoreCount++;
    factors.push(capeResult.description);
  }

  // 2. Surface moisture
  const moistureResult = assessSurfaceMoisture(input.dewPoint, input.humidity);
  if (moistureResult.score > 0) {
    overallScore += moistureResult.score;
    scoreCount++;
    factors.push(moistureResult.description);
  }

  // 3. Temperature-dewpoint spread
  const spreadResult = assessSpread(input.temperature, input.dewPoint);
  if (spreadResult.spread != null) {
    overallScore += spreadResult.score;
    scoreCount++;
    factors.push(spreadResult.description);
  }

  // 4. Pressure trend
  const pressureResult = analyzePressureTrend(input.pressure, input.recentObservations);
  // Falling pressure is favorable (positive score), rising is not (negative)
  if (pressureResult.score !== 0 || input.pressure != null) {
    // Only count pressure if we have meaningful data
    if (pressureResult.change60Min != null) {
      overallScore += Math.max(0, pressureResult.score);
      scoreCount++;
    }
    factors.push(pressureResult.description);
  }

  // 5. Surface wind analysis
  const windResult = analyzeSurfaceWinds(input);
  if (windResult.speedShearScore > 0 || windResult.directionalShear.level !== 'NONE') {
    const windScore = (windResult.speedShearScore +
      (windResult.directionalShear.level === 'STRONG' ? 0.8 :
        windResult.directionalShear.level === 'MODERATE' ? 0.5 :
          windResult.directionalShear.level === 'WEAK' ? 0.2 : 0)) / 2;
    overallScore += windScore;
    scoreCount++;
    factors.push(windResult.description);
  }

  // ---- Calculate overall level ----
  const avgScore = scoreCount > 0 ? overallScore / scoreCount : 0;
  let level: AssessmentLevel;
  if (avgScore >= 0.75) level = 'VERY_HIGH';
  else if (avgScore >= 0.55) level = 'HIGH';
  else if (avgScore >= 0.35) level = 'MODERATE';
  else if (avgScore >= 0.15) level = 'MARGINAL';
  else if (scoreCount > 0) level = 'LOW';
  else level = 'UNKNOWN';

  // ---- Data availability summary ----
  const capeAvailable: DataAvailability = input.cape != null ? 'AVAILABLE' : 'UNAVAILABLE';

  // Shear is only partially available — surface wind trends, not full wind profile
  const hasWindData = input.windSpeed != null && input.recentObservations.length >= 2;
  const shearAvail: DataAvailability = hasWindData ? 'PARTIAL' : 'UNAVAILABLE';

  // Helicity and composite params are NOT available from surface data alone
  const helicityAvail: DataAvailability = 'UNAVAILABLE';
  const compositeAvail: DataAvailability = 'UNAVAILABLE';

  // ---- Description ----
  const descParts: string[] = [];
  if (level === 'VERY_HIGH' || level === 'HIGH') {
    descParts.push('Environment is favorable for tornado development.');
  } else if (level === 'MODERATE') {
    descParts.push('Environment partially supports severe storm development.');
  } else if (level === 'MARGINAL') {
    descParts.push('Environment marginally supports severe weather.');
  } else if (level === 'LOW') {
    descParts.push('Environment is generally unfavorable for tornadoes.');
  } else {
    descParts.push('Insufficient environmental data to assess tornado potential.');
  }

  if (capeResult.availability === 'UNAVAILABLE') {
    descParts.push('No CAPE data — instability assessment limited.');
  }
  if (helicityAvail === 'UNAVAILABLE') {
    descParts.push('Storm-relative helicity not available from surface data.');
  }

  return {
    level,
    cape: input.cape,
    cin: null, // CIN not available from surface data
    surfaceTempF: input.temperature,
    surfaceDewPointF: input.dewPoint,
    surfaceHumidity: input.humidity,
    surfaceWindSpeed: input.windSpeed,
    surfaceWindDirection: input.windDirection,
    pressureTrend: pressureResult.trend,
    pressureChange30Min: pressureResult.change30Min,
    pressureChange60Min: pressureResult.change60Min,
    lowLevelShear: windResult.directionalShear.shearDegrees > 0
      ? windResult.directionalShear.shearDegrees
      : null,
    deepLayerShear: null, // Not available from surface data
    srh: null, // Not available — marked UNAVAILABLE
    lclHeight: null, // Not available from surface data alone
    significantTornadoParam: null, // Not available
    supercellComposite: null, // Not available
    dataAvailability: {
      cape: capeAvailable,
      shear: shearAvail,
      helicity: helicityAvail,
      compositeParams: compositeAvail,
    },
    description: descParts.join(' '),
    factors,
  };
}
