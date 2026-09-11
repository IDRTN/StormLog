import assert from 'node:assert/strict';
import { parseQuantitativeRadarPayload } from '../quantitativeRadarBackend';
import { analyzeStorm } from '../tornadoAnalysis';
import type { AnalysisInput } from '../types';

const parsed = parseQuantitativeRadarPayload({
  available: true,
  stationId: 'KILN',
  latestFrameTime: Math.floor(Date.now() / 1000),
  hasPrecipitation: true,
  maxReflectivityDbz: 58,
  correlationCoefficient: 0.72,
  differentialReflectivity: 0.4,
  scanCount: 3,
  trend: 'STRENGTHENING',
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
assert.ok(result.dataQuality.limitations.every(x => !x.includes('Doppler velocity unavailable')));

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
