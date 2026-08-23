// ============================================================
// Layer B — Storm Structure Analysis (Real NEXRAD)
// ============================================================
//
// Uses real NEXRAD reflectivity data from RainViewer/NWS when
// available. Falls back to environmental inference with clear
// labeling that structure cannot be confirmed without radar.

import type {
  AnalysisInput,
  StormStructureAssessment,
  AssessmentLevel,
} from './types';

const THUNDERSTORM_CODES = new Set([
  95, 96, 99, 295, 296, 299, 302, 305, 308, 386, 389, 392, 395,
]);

function analyzeRadarStructure(input: AnalysisInput): {
  level: AssessmentLevel;
  hasStrongReflectivity: boolean;
  hasSupercellStructure: boolean;
  hasHookEcho: boolean;
  hasBWER: boolean;
  stormOrganization: string;
  maxReflectivity: number | null;
  stormTop: number | null;
  factors: string[];
} {
  const radar = input.radarData!;
  const factors: string[] = [];

  const maxReflectivity = radar.maxReflectivityDbz ?? null;
  const hasPrecipitation = radar.hasPrecipitation === true;

  // Analyze from actual reflectivity data
  let maxRefl = maxReflectivity ?? 0;
  let maxStormTop = 0;
  let strongestCell: any = null;

  if (radar.stormCells && radar.stormCells.length > 0) {
    for (const cell of radar.stormCells) {
      if ((cell.maxReflectivity ?? 0) > maxRefl) {
        maxRefl = cell.maxReflectivity;
        strongestCell = cell;
      }
      if ((cell.top ?? 0) > maxStormTop) maxStormTop = cell.top;
    }
  }

  const hasStrongReflectivity = maxRefl >= 50;
  const hasRotation = radar.couplets && radar.couplets.length > 0;
  const hasStrongCore = maxRefl >= 60;
  const hasHighTop = maxStormTop > 12;

  const hasSupercellStructure = hasStrongCore && (hasHighTop || hasRotation);
  const hasBWER = false; // Requires cross-section analysis
  const hasHookEcho = false; // Requires detailed pattern analysis

  if (hasPrecipitation) {
    factors.push('Precipitation detected in NEXRAD composite');
  }
  if (maxReflectivity != null) {
    factors.push(`Estimated max reflectivity: ~${maxReflectivity} dBZ`);
  }

  let stormOrganization: string;
  if (hasSupercellStructure && hasRotation) {
    stormOrganization = 'Storm characteristics consistent with organized convection';
    factors.push('Strong reflectivity and rotation detected — specific structure classification requires detailed analysis');
  } else if (hasSupercellStructure) {
    stormOrganization = 'Strong storm detected — structure classification unavailable';
    factors.push('Strong reflectivity detected — supercell classification requires additional radar products');
  } else if (hasStrongReflectivity) {
    stormOrganization = 'Strong reflectivity detected';
    factors.push('Significant echo suggests organized convection');
  } else if (hasPrecipitation) {
    stormOrganization = 'Precipitation imagery detected';
  } else {
    stormOrganization = 'No significant precipitation in radar coverage area';
  }

  let level: AssessmentLevel;
  if (hasSupercellStructure && hasRotation) level = 'HIGH';
  else if (hasSupercellStructure) level = 'MODERATE';
  else if (hasStrongReflectivity) level = 'MARGINAL';
  else if (hasPrecipitation) level = 'LOW';
  else level = 'VERY_LOW';

  return {
    level,
    hasStrongReflectivity,
    hasSupercellStructure,
    hasHookEcho,
    hasBWER,
    stormOrganization,
    maxReflectivity: maxRefl > 0 ? maxRefl : null,
    stormTop: maxStormTop > 0 ? maxStormTop : null,
    factors,
  };
}

function inferFromEnvironment(input: AnalysisInput): {
  level: AssessmentLevel;
  stormOrganization: string;
  factors: string[];
} {
  const factors: string[] = [];

  // Without radar, we CANNOT determine storm structure.
  // CAPE describes environment, not storm organization.
  // We must not infer supercell/hook/BWER from CAPE or surface data.

  factors.push('Storm structure unavailable — no quantitative radar data');
  factors.push('CAPE and surface observations describe environment only, not storm organization');

  return {
    level: 'UNKNOWN',
    stormOrganization: 'Unavailable — no quantitative radar structure data',
    factors,
  };
}

export function analyzeStormStructure(input: AnalysisInput): StormStructureAssessment {
  const radarAvailable = input.radarData?.available === true;

  if (radarAvailable) {
    const result = analyzeRadarStructure(input);
    return {
      ...result,
      radarAvailable: true,
      radarStationId: input.radarData?.stationId ?? null,
      description: result.stormOrganization,
    };
  }

  const envResult = inferFromEnvironment(input);
  return {
    level: envResult.level,
    hasStrongReflectivity: false,
    hasSupercellStructure: false,
    hasHookEcho: false,
    hasBWER: false,
    stormOrganization: envResult.stormOrganization,
    maxReflectivity: null,
    stormTop: null,
    radarAvailable: false,
    radarStationId: null,
    description: envResult.stormOrganization,
    factors: envResult.factors,
  };
}
