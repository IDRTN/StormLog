import assert from 'node:assert/strict';
import { parseQuantitativeRadarPayload } from '../quantitativeRadarBackend';
import { analyzeStorm } from '../tornadoAnalysis';
import type { AnalysisInput } from '../types';

const parsed = parseQuantitativeRadarPayload({
  available: true,
  stationId: 'KILN',
  latestFrameTime: Date.now(),
  hasPrecipitation: true,
  maxReflectivityDbz: 58,
  correlationCoefficient: 0.72,
  differentialReflectivity: 0.4,
  scanCount: 3,
  trend: 'STRENGTHENING',
  dualPolEvidence: {
    available: true,
    debrisCandidate: true,
    debrisSignature: true,
    confidence: 70,
    scanCount: 3,
    cc: 0.72,
    zdr: 0.4,
    reflectivityDbz: 54,
    reason: 'validated low CC, colocated reflectivity, low-level couplet, persistent across 3 scans',
  },
  velocityPoints: [
    { latitude: 39.95, longitude: -82.95, velocity: -46, stormRelativeVelocity: -48, reflectivity: 54, altitude: 900 },
    { latitude: 39.951, longitude: -82.949, velocity: 44, stormRelativeVelocity: 47, reflectivity: 56, altitude: 900 },
  ],
  couplets: [
    {
      latitude: 39.9505,
      longitude: -82.9495,
      shear: 90,
      strength: 'STRONG',
      distanceKm: 1.2,
      headingTowardUser: true,
      altitude: 900,
      lowLevel: true,
      scanCount: 3,
      azimuthalShear: 0.018,
    },
  ],
  stormCells: [
    { id: 'cell-1', latitude: 39.95, longitude: -82.95, maxReflectivity: 58, top: 12, movement: 60, speed: 30 },
  ],
});

assert.equal(parsed.available, true);
assert.equal(parsed.stationId, 'KILN');
assert.equal(parsed.couplets.length, 1);
assert.equal((parsed.couplets[0] as any).scanCount, 3);
assert.equal(parsed.correlationCoefficient, 0.72);
assert.equal(parsed.dualPolEvidence?.available, true);
assert.equal(parsed.dualPolEvidence?.debrisCandidate, true);
assert.equal(parsed.dualPolEvidence?.debrisSignature, true);
assert.equal(parsed.dualPolEvidence?.scanCount, 3);

const input: AnalysisInput = {
  temperature: 78,
  humidity: 72,
  pressure: 1008,
  windSpeed: 18,
  windDirection: 180,
  windGust: 30,
  dewPoint: 68,
  latitude: 39.96,
  longitude: -82.96,
  cape: 1800,
  recentObservations: [],
  nearbyStations: [],
  nwsAlerts: [],
  radarData: {
    available: true,
    stationId: parsed.stationId ?? undefined,
    latestFrameTime: parsed.latestFrameTime ?? undefined,
    hasPrecipitation: parsed.hasPrecipitation,
    maxReflectivityDbz: parsed.maxReflectivityDbz,
    velocityPoints: parsed.velocityPoints,
    couplets: parsed.couplets,
    stormCells: parsed.stormCells,
    correlationCoefficient: parsed.correlationCoefficient,
    differentialReflectivity: parsed.differentialReflectivity,
    scanCount: parsed.scanCount,
    dualPolEvidence: parsed.dualPolEvidence,
  } as any,
};

const result = analyzeStorm(input);
assert.equal(result.rotation.velocityDataAvailable, true);
assert.equal(result.rotation.hasCouplet, true);
assert.equal(result.rotation.verticalContinuity, 3);
assert.equal(result.rotation.lowLevelRotation, true);
assert.equal(result.tornadicEvidence.dualPolAvailable, true);
assert.equal(result.tornadicEvidence.correlationCoefficient, 0.72);
assert.equal(result.tornadicEvidence.debrisSignature, true);
assert.equal(result.tornadicEvidence.level, 'VERY_HIGH');
assert.ok(result.dataQuality.limitations.every(x => !x.includes('Doppler velocity unavailable')));

// A low-CC single scan may remain visible as a backend candidate, but the app
// must not turn it into a declared debris signature or VERY_HIGH evidence.
const oneScanParsed = parseQuantitativeRadarPayload({
  available: true,
  stationId: 'KILN',
  latestFrameTime: Date.now(),
  hasPrecipitation: true,
  maxReflectivityDbz: 40,
  correlationCoefficient: 0.69,
  differentialReflectivity: 0.5,
  scanCount: 1,
  trend: 'UNKNOWN',
  dualPolEvidence: {
    available: true,
    debrisCandidate: true,
    debrisSignature: false,
    confidence: 65,
    scanCount: 1,
    cc: 0.69,
    zdr: 0.5,
    reflectivityDbz: 40,
    reason: 'candidate seen on only 1 scan; persistence required',
  },
  velocityPoints: [
    { latitude: 39.95, longitude: -82.95, velocity: -24, stormRelativeVelocity: -24, reflectivity: 40, altitude: 900 },
    { latitude: 39.951, longitude: -82.949, velocity: 24, stormRelativeVelocity: 24, reflectivity: 40, altitude: 900 },
  ],
  couplets: [
    { latitude: 39.9505, longitude: -82.9495, shear: 48, strength: 'MODERATE', distanceKm: 1.2, headingTowardUser: false, altitude: 900, lowLevel: true, scanCount: 1 },
  ],
  stormCells: [],
});
const oneScan = analyzeStorm({
  ...input,
  cape: 0,
  radarData: {
    available: true,
    velocityPoints: oneScanParsed.velocityPoints,
    couplets: oneScanParsed.couplets,
    stormCells: [],
    correlationCoefficient: oneScanParsed.correlationCoefficient,
    differentialReflectivity: oneScanParsed.differentialReflectivity,
    scanCount: oneScanParsed.scanCount,
    dualPolEvidence: oneScanParsed.dualPolEvidence,
  } as any,
});
assert.equal(oneScan.rotation.verticalContinuity, 1);
assert.equal(oneScan.tornadicEvidence.debrisSignature, false);
assert.notEqual(oneScan.tornadicEvidence.level, 'VERY_HIGH');

const fallbackInput: AnalysisInput = {
  ...input,
  radarData: {
    available: true,
    velocityPoints: [],
    couplets: [],
    stormCells: [],
  },
};
const fallback = analyzeStorm(fallbackInput);
assert.equal(fallback.rotation.velocityDataAvailable, false);
assert.equal(fallback.tornadicEvidence.debrisSignature, false);
assert.ok(fallback.dataQuality.limitations.some(x => x.includes('Doppler velocity unavailable')));

console.log('QUANTITATIVE_RADAR_ENGINE_INTEGRATION_PASS');
