// ============================================================
// Layer B — Storm Structure Analysis
// ============================================================
//
// The current mobile radar provider supplies composite imagery
// availability only. It does NOT provide quantitative NEXRAD
// reflectivity, velocity, dual-pol, storm-top, hook-echo, or BWER
// fields. Therefore this layer must not manufacture those values.
// A future Level-II/Level-III processor can populate RadarAnalysisInput
// with validated quantitative products and this layer can then use them.

import type { AnalysisInput, StormStructureAssessment, AssessmentLevel } from './types';

function analyzeRadarStructure(input: AnalysisInput): StormStructureAssessment {
  const radar = input.radarData!;
  const factors: string[] = [];
  const quantitativeReflectivity = radar.maxReflectivityDbz != null && Number.isFinite(radar.maxReflectivityDbz);
  const hasPrecipitation = radar.hasPrecipitation === true;

  if (quantitativeReflectivity) {
    factors.push(`Quantitative maximum reflectivity: ${radar.maxReflectivityDbz!.toFixed(1)} dBZ`);
  } else {
    factors.push('Quantitative reflectivity unavailable from the current radar provider');
  }
  if (hasPrecipitation) factors.push('Precipitation classification supplied by radar provider');
  else factors.push('Precipitation classification unavailable');

  // These classifications require actual quantitative radar fields/patterns.
  const hasStrongReflectivity = quantitativeReflectivity && radar.maxReflectivityDbz! >= 50;
  const hasStrongCore = quantitativeReflectivity && radar.maxReflectivityDbz! >= 60;
  const hasRotation = radar.couplets.length > 0;
  const maxStormTop = radar.stormCells.reduce((max, cell: any) => {
    const top = Number.isFinite(cell?.top) ? cell.top : 0;
    return Math.max(max, top);
  }, 0);
  const hasHighTop = maxStormTop > 12;
  const hasSupercellStructure = hasStrongCore && (hasHighTop || hasRotation);

  // Hook echo/BWER require spatial pattern/cross-section analysis.
  const hasBWER = false;
  const hasHookEcho = false;

  let level: AssessmentLevel;
  let stormOrganization: string;
  if (hasSupercellStructure && hasRotation) {
    level = 'HIGH';
    stormOrganization = 'Organized storm characteristics detected from supplied quantitative radar fields';
  } else if (hasSupercellStructure) {
    level = 'MODERATE';
    stormOrganization = 'Strong radar structure detected; full supercell classification requires additional products';
  } else if (hasStrongReflectivity) {
    level = 'MARGINAL';
    stormOrganization = 'Strong reflectivity detected';
  } else if (hasPrecipitation) {
    level = 'LOW';
    stormOrganization = 'Precipitation detected, but quantitative storm structure is limited';
  } else {
    level = 'UNKNOWN';
    stormOrganization = 'Quantitative storm structure unavailable';
  }

  return {
    level,
    hasStrongReflectivity,
    hasSupercellStructure,
    hasHookEcho,
    hasBWER,
    stormOrganization,
    maxReflectivity: quantitativeReflectivity ? radar.maxReflectivityDbz! : null,
    stormTop: maxStormTop > 0 ? maxStormTop : null,
    radarAvailable: true,
    radarStationId: radar.stationId ?? null,
    description: stormOrganization,
    factors,
  };
}

export function analyzeStormStructure(input: AnalysisInput): StormStructureAssessment {
  if (input.radarData?.available === true) return analyzeRadarStructure(input);
  return {
    level: 'UNKNOWN',
    hasStrongReflectivity: false,
    hasSupercellStructure: false,
    hasHookEcho: false,
    hasBWER: false,
    stormOrganization: 'Unavailable — no quantitative radar structure data',
    maxReflectivity: null,
    stormTop: null,
    radarAvailable: false,
    radarStationId: null,
    description: 'Storm structure unavailable — no quantitative radar structure data',
    factors: [
      'Quantitative storm structure unavailable',
      'Surface/environmental data cannot confirm hook echo, BWER, supercell structure, or storm intensity',
    ],
  };
}
