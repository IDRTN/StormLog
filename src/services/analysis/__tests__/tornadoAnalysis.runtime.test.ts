import { analyzeStorm } from '../tornadoAnalysis';
import type { AnalysisInput } from '../types';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const base: AnalysisInput = {
  temperature: 85,
  humidity: 65,
  pressure: 29.92,
  windSpeed: 15,
  windDirection: 220,
  windGust: 25,
  dewPoint: 68,
  latitude: 35,
  longitude: -97,
  cape: 2000,
  recentObservations: [],
  nearbyStations: [],
  nwsAlerts: [],
};

const noRadar = analyzeStorm(base);
assert(noRadar.rotation.velocityDataAvailable === false, 'velocity must be unavailable without radar');
assert(noRadar.dataQuality.velocityData === 'UNAVAILABLE', 'data quality must reflect missing velocity');
assert(noRadar.overallAssessment === 'LOW' || noRadar.overallAssessment === 'VERY_LOW', 'environment alone must remain low');

const radarNoVelocity = analyzeStorm({
  ...base,
  radarData: {
    available: true,
    hasPrecipitation: true,
    maxReflectivityDbz: 55,
    velocityPoints: [],
    couplets: [],
    stormCells: [],
  },
});
assert(radarNoVelocity.rotation.velocityDataAvailable === false, 'empty velocity array must not count as velocity');
assert(radarNoVelocity.overallAssessment !== 'HIGH' && radarNoVelocity.overallAssessment !== 'VERY_HIGH', 'missing velocity must prevent high assessment');

const failedRadar = analyzeStorm({
  ...base,
  radarData: {
    available: false,
    hasPrecipitation: true,
    velocityPoints: [],
    couplets: [],
    stormCells: [],
    unavailableReason: 'provider failure',
  },
});
assert(failedRadar.dataQuality.radarCoverage === 'UNAVAILABLE', 'failed radar must not count as available');
assert(failedRadar.stormStructure.radarAvailable === false, 'failed radar must not feed radar structure analysis');

const unknownMotion = analyzeStorm({
  ...base,
  radarData: {
    available: true,
    velocityPoints: [],
    couplets: [],
    stormCells: [{ latitude: 35.1, longitude: -97.0, speed: 30 }],
  },
});
assert(unknownMotion.stormMotion?.approaching === null, 'missing storm motion direction must remain unknown, not false');
assert(unknownMotion.stormMotion?.directionDegrees === null, 'missing storm motion direction must remain null');

const invalidMotion = analyzeStorm({
  ...base,
  radarData: {
    available: true,
    velocityPoints: [],
    couplets: [],
    stormCells: [{ latitude: 35.1, longitude: -97.0, speed: 30, movement: Number.NaN }],
  },
});
assert(invalidMotion.stormMotion?.approaching === null, 'invalid storm motion must remain unknown');
assert(invalidMotion.stormMotion?.directionDegrees === null, 'invalid storm motion direction must remain null');

const advanced = analyzeStorm({
  ...base,
  advancedEnvironment: {
    sourceLevelCount: 20,
    lowLevelShear01KmKt: 25,
    lowLevelShear03KmKt: 35,
    deepLayerShear06KmKt: 55,
    srh01M2s2: 100,
    srh03M2s2: 150,
    lclHeightM: 900,
    capeJkg: 3000,
    cinJkg: -50,
    significantTornadoParameter: 2,
    supercellCompositeParameter: 4,
    availability: 'AVAILABLE',
    limitations: [],
  },
});
assert(advanced.environment.cape === 3000, 'advanced CAPE must reach environmental assessment');
assert(advanced.environment.cin === -50, 'advanced CIN must reach environmental assessment');
assert(advanced.environment.deepLayerShear === 55, 'deep-layer shear must reach environmental assessment');
assert(advanced.environment.srh === 150, 'SRH must reach environmental assessment');
assert(advanced.environment.lclHeight === 900, 'LCL must reach environmental assessment');
assert(advanced.environment.dataAvailability.shear === 'AVAILABLE', 'advanced shear availability must be exposed');
assert(advanced.environment.dataAvailability.helicity === 'AVAILABLE', 'advanced helicity availability must be exposed');
assert(advanced.environment.dataAvailability.compositeParams === 'AVAILABLE', 'advanced composite availability must be exposed');

// Regression for the live 2026-09-12 false positive. A single scan with
// CC=0.69, a 48 kt low-level couplet, and even backend debris-like evidence
// must not immediately become a declared debris signature/VERY_HIGH result.
const singleScanDebrisLike = analyzeStorm({
  ...base,
  cape: 0,
  radarData: {
    available: true,
    hasPrecipitation: true,
    maxReflectivityDbz: 40,
    velocityPoints: [
      { latitude: 35.0, longitude: -97.0, velocity: 24, stormRelativeVelocity: 24, reflectivity: 40, altitude: 500 },
      { latitude: 35.001, longitude: -97.001, velocity: -24, stormRelativeVelocity: -24, reflectivity: 40, altitude: 500 },
    ],
    couplets: [
      { latitude: 35.0, longitude: -97.0, shear: 48, strength: 'MODERATE', distanceKm: 1, headingTowardUser: false, lowLevel: true, scanCount: 1 },
    ],
    stormCells: [],
    correlationCoefficient: 0.69,
    differentialReflectivity: 0.5,
    scanCount: 1,
    dualPolEvidence: {
      available: true,
      debrisSignature: true,
      confidence: 74,
      cc: 0.69,
      zdr: 0.5,
      reflectivityDbz: 40,
      reason: 'synthetic debris-like evidence',
    },
  } as any,
});
assert(singleScanDebrisLike.tornadicEvidence.debrisSignature === false, 'single-scan debris-like evidence must not be declared a debris signature');
assert(singleScanDebrisLike.tornadicEvidence.level !== 'VERY_HIGH', 'single-scan debris-like evidence must not become VERY_HIGH');

// Regression for live-device case: favorable surface environment + 51 dBZ +
// a 52 kt low-level couplet on only one independent radar scan. The rotation
// signal must remain visible, but the large overall banner must not elevate to
// MODERATE before persistence is established because tornadic evidence is LOW.
const singleScanModerateCouplet = analyzeStorm({
  ...base,
  temperature: 72,
  humidity: 100,
  dewPoint: 72,
  windSpeed: 0,
  windGust: 8,
  cape: 1150,
  radarData: {
    available: true,
    hasPrecipitation: true,
    maxReflectivityDbz: 51,
    velocityPoints: [
      { latitude: 35.0, longitude: -97.0, velocity: 26, stormRelativeVelocity: 26, reflectivity: 51, altitude: 500 },
      { latitude: 35.001, longitude: -97.001, velocity: -26, stormRelativeVelocity: -26, reflectivity: 51, altitude: 500 },
    ],
    couplets: [
      { latitude: 35.0, longitude: -97.0, shear: 52, strength: 'MODERATE', distanceKm: 1, headingTowardUser: false, lowLevel: true, scanCount: 1 },
    ],
    stormCells: [],
    correlationCoefficient: 0.95,
    differentialReflectivity: 1.0,
    scanCount: 1,
    dualPolEvidence: {
      available: true,
      debrisSignature: false,
      confidence: null,
      cc: 0.95,
      zdr: 1.0,
      reflectivityDbz: 51,
      reason: 'no validated debris signature',
    },
  } as any,
});
assert(singleScanModerateCouplet.rotation.hasCouplet === true, 'single-scan 52 kt couplet must remain visible');
assert(singleScanModerateCouplet.tornadicEvidence.level === 'LOW', 'single-scan 52 kt couplet should remain LOW tornadic evidence');
assert(singleScanModerateCouplet.overallAssessment === 'MARGINAL' || singleScanModerateCouplet.overallAssessment === 'LOW', 'single-scan LOW-evidence couplet must not elevate overall assessment to MODERATE');
assert(singleScanModerateCouplet.whyExplanation.includes('Single unconfirmed radar couplet'), 'single-scan gate must be explained to the user');

const warning = analyzeStorm({
  ...base,
  nwsAlerts: [{ event: 'Tornado Warning', severity: 'Extreme', headline: 'Test warning' }],
});
assert(warning.nwsStatus.tornadoWarning === true, 'NWS tornado warning must remain separate and authoritative');

console.log('tornadoAnalysis.runtime.test.ts: PASS');
