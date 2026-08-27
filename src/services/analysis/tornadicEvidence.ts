// ============================================================
// Layer D — Tornadic Evidence Assessment
// ============================================================
//
// Evaluates evidence that a detected circulation may be tornadic.
// Without radar velocity data, all evidence types are UNKNOWN.
// Debris signature requires CC + couplet + low-level confirmation.

import type {
  AnalysisInput,
  TornadicEvidenceAssessment,
  RotationAssessment,
  AssessmentLevel,
} from './types';

function checkStrongCouplet(rotation: RotationAssessment): { detected: boolean; description: string } {
  if (!rotation.velocityDataAvailable || !rotation.hasCouplet) {
    return { detected: false, description: 'Velocity couplet not assessable without radar velocity' };
  }
  // We use "strong velocity couplet" not "TVS" — TVS requires
  // specific spatial/radar context we cannot evaluate from point data
  const isStrongCouplet = rotation.gateToGateShear != null &&
    rotation.gateToGateShear > 70 &&
    rotation.lowLevelRotation;
  return {
    detected: isStrongCouplet,
    description: isStrongCouplet
      ? 'Strong low-level velocity couplet — consistent with possible tornadic circulation'
      : 'No strong low-level velocity couplet detected',
  };
}

function checkPersistentRotation(rotation: RotationAssessment): { persistent: boolean; description: string } {
  if (!rotation.velocityDataAvailable) {
    return { persistent: false, description: 'Persistence not assessable without radar velocity' };
  }
  const persistent = rotation.verticalContinuity >= 3;
  return {
    persistent,
    description: persistent
      ? `Rotation persistent across ${rotation.verticalContinuity} scans`
      : 'Rotation not yet persistent across multiple scans',
  };
}

function checkIntensifying(rotation: RotationAssessment): { intensifying: boolean; description: string } {
  if (rotation.trend === 'RAPIDLY_INTENSIFYING') {
    return { intensifying: true, description: 'Rotation rapidly intensifying' };
  }
  if (rotation.trend === 'STRENGTHENING') {
    return { intensifying: true, description: 'Rotation strengthening' };
  }
  if (rotation.trend === 'WEAKENING') {
    return { intensifying: false, description: 'Rotation weakening' };
  }
  return { intensifying: false, description: `Trend: ${rotation.trend}` };
}

function checkLowLevelMeso(rotation: RotationAssessment): { detected: boolean; description: string } {
  if (!rotation.velocityDataAvailable) {
    return { detected: false, description: 'Mesocyclone not assessable without radar velocity' };
  }
  const meso = rotation.hasCouplet && rotation.lowLevelRotation &&
    rotation.gateToGateShear != null && rotation.gateToGateShear > 40;
  return {
    detected: meso,
    description: meso ? 'Low-level rotation consistent with mesocyclone' : 'No low-level mesocyclone indicators',
  };
}

function checkDebrisSignature(
  input: AnalysisInput,
  rotation: RotationAssessment
): { debrisSignature: boolean; confidence: number | null; cc: number | null; description: string } {
  const radarData = input.radarData as any;
  const cc = radarData?.correlationCoefficient ?? radarData?.cc ?? null;

  if (cc == null) {
    return {
      debrisSignature: false,
      confidence: null,
      cc: null,
      description: 'Dual-pol correlation coefficient not available — debris signature cannot be assessed',
    };
  }

  if (!rotation.hasCouplet) {
    return {
      debrisSignature: false,
      confidence: null,
      cc,
      description: `Correlation coefficient ${cc.toFixed(2)} available but no velocity couplet`,
    };
  }

  // Require ALL three: low CC + confirmed couplet + low-level
  const hasLowCC = cc < 0.85;
  const hasCouplet = rotation.hasCouplet;
  const isLowLevel = rotation.lowLevelRotation;

  if (hasLowCC && hasCouplet && isLowLevel) {
    return {
      debrisSignature: true,
      confidence: Math.round((0.85 - cc) / 0.85 * 100),
      cc,
      description: `Possible debris signature (CC=${cc.toFixed(2)}, low-level, with couplet)`,
    };
  } else if (hasLowCC && hasCouplet) {
    return {
      debrisSignature: false,
      confidence: null,
      cc,
      description: `Possible non-meteorological scatterers (CC=${cc.toFixed(2)}) — low-level confirmation needed`,
    };
  } else if (hasLowCC) {
    return {
      debrisSignature: false,
      confidence: null,
      cc,
      description: `Low CC (${cc.toFixed(2)}) but no velocity couplet — cannot assess debris signature`,
    };
  }

  return {
    debrisSignature: false,
    confidence: null,
    cc,
    description: `Correlation coefficient ${cc.toFixed(2)} — no debris signature indicators`,
  };
}

export function analyzeTornadicEvidence(
  input: AnalysisInput,
  rotationAssessment: RotationAssessment
): TornadicEvidenceAssessment {
  const factors: string[] = [];

  if (!rotationAssessment.velocityDataAvailable) {
    const radarConnected = rotationAssessment.radarAvailable;

    // Lightning context is independent of radar velocity availability
    if (input.lightning) {
      const l = input.lightning;
      if (l.totalCount > 0) {
        const earlyFactors: string[] = [
          'Radar velocity data required for tornadic evidence assessment',
          'Surface observations alone cannot determine if circulation is tornadic',
          'Refer to NWS warnings for official tornado information',
          `Lightning: ${l.totalCount} events, ${l.ratePerMinute.toFixed(1)}/min, trend: ${l.trend}`,
        ];
        if (l.nearestDistanceKm != null && l.nearestDistanceKm < 20) {
          earlyFactors.push(`Lightning nearby: ${l.nearestDistanceKm.toFixed(1)} km from observer`);
        }
        if (l.cgCount > 0) {
          earlyFactors.push(`CG lightning: ${l.cgCount} cloud-to-ground events`);
        }
        return {
          level: 'UNKNOWN',
          debrisSignature: false,
          debrisConfidence: null,
          strongCouplet: false,
          persistentRotation: false,
          intensifyingRotation: false,
          lowLevelMesocyclone: false,
          dualPolAvailable: false,
          correlationCoefficient: null,
          differentialReflectivity: null,
          description: radarConnected
            ? 'Radar connected but Doppler velocity unavailable — tornadic evidence cannot be assessed'
            : 'Radar unavailable — tornadic evidence cannot be assessed',
          factors: earlyFactors,
        };
      }
    }

    return {
      level: 'UNKNOWN',
      debrisSignature: false,
      debrisConfidence: null,
      strongCouplet: false,
      persistentRotation: false,
      intensifyingRotation: false,
      lowLevelMesocyclone: false,
      dualPolAvailable: false,
      correlationCoefficient: null,
      differentialReflectivity: null,
      description: radarConnected
        ? 'Radar connected but Doppler velocity unavailable — tornadic evidence cannot be assessed'
        : 'Radar unavailable — tornadic evidence cannot be assessed',
      factors: [
        'Radar velocity data required for tornadic evidence assessment',
        'Surface observations alone cannot determine if circulation is tornadic',
        'Refer to NWS warnings for official tornado information',
      ],
    };
  }

  const coupletResult = checkStrongCouplet(rotationAssessment);
  if (coupletResult.detected) factors.push(coupletResult.description);

  const persistentResult = checkPersistentRotation(rotationAssessment);
  if (persistentResult.persistent) factors.push(persistentResult.description);

  const intensifyingResult = checkIntensifying(rotationAssessment);
  if (intensifyingResult.intensifying) factors.push(intensifyingResult.description);

  const mesoResult = checkLowLevelMeso(rotationAssessment);
  if (mesoResult.detected) factors.push(mesoResult.description);

  const debrisResult = checkDebrisSignature(input, rotationAssessment);
  if (debrisResult.debrisSignature) factors.push(debrisResult.description);

  const radarData = input.radarData as any;
  const dualPolAvailable = radarData?.correlationCoefficient != null || radarData?.cc != null;

  let level: AssessmentLevel;

  if (debrisResult.debrisSignature) {
    level = 'VERY_HIGH';
  } else if (coupletResult.detected && (persistentResult.persistent || mesoResult.detected)) {
    level = 'HIGH';
  } else if (coupletResult.detected) {
    level = 'MODERATE';
  } else if (mesoResult.detected && persistentResult.persistent) {
    level = 'MODERATE';
  } else if (persistentResult.persistent) {
    level = 'MARGINAL';
  } else if (rotationAssessment.hasCouplet) {
    level = 'LOW';
  } else {
    level = 'VERY_LOW';
  }

  let description: string;
  if (debrisResult.debrisSignature) {
    description = 'Radar evidence consistent with tornadic circulation — possible debris signature with confirmed rotation';
  } else if (coupletResult.detected) {
    description = 'Strong low-level velocity couplet — radar signature consistent with possible tornadic circulation';
  } else if (mesoResult.detected) {
    description = 'Low-level rotation detected — tornadic development possible';
  } else if (persistentResult.persistent) {
    description = 'Persistent rotation detected — tornadic potential present';
  } else if (rotationAssessment.hasCouplet) {
    description = 'Rotation detected but no strong tornadic indicators';
  } else {
    description = 'No tornadic evidence detected in radar data';
  }

  if (!persistentResult.persistent && rotationAssessment.hasCouplet) {
    factors.push(persistentResult.description);
  }
  if (!intensifyingResult.intensifying && rotationAssessment.trend !== 'UNKNOWN') {
    factors.push(intensifyingResult.description);
  }
  if (!coupletResult.detected) {
    factors.push(coupletResult.description);
  }

  // Lightning context (supporting evidence only - does not change level)
  if (input.lightning) {
    const l = input.lightning;
    if (l.totalCount > 0) {
      factors.push(
        `Lightning: ${l.totalCount} events, ${l.ratePerMinute.toFixed(1)}/min, trend: ${l.trend}`
      );
      if (l.nearestDistanceKm != null && l.nearestDistanceKm < 20) {
        factors.push(`Lightning nearby: ${l.nearestDistanceKm.toFixed(1)} km from observer`);
      }
      if (l.cgCount > 0) {
        factors.push(`CG lightning: ${l.cgCount} cloud-to-ground events`);
      }
    }
  }

  return {
    level,
    debrisSignature: debrisResult.debrisSignature,
    debrisConfidence: debrisResult.confidence,
    strongCouplet: coupletResult.detected,
    persistentRotation: persistentResult.persistent,
    intensifyingRotation: intensifyingResult.intensifying,
    lowLevelMesocyclone: mesoResult.detected,
    dualPolAvailable,
    correlationCoefficient: debrisResult.cc,
    differentialReflectivity: radarData?.differentialReflectivity ?? radarData?.zdr ?? null,
    description,
    factors,
  };
}
