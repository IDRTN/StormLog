// ============================================================
// Phase 7 — Lightning Analysis Integration Tests
// Tests that lightning is correctly wired into analysis as
// supporting evidence without changing assessment levels.
// ============================================================

import { analyzeStorm } from '../tornadoAnalysis';
import { analyzeTornadicEvidence } from '../tornadicEvidence';
import type { AnalysisInput, LightningTrend } from '../types';

let passed = 0;
let failed = 0;

function assert(c: boolean, m: string): asserts c {
  if (!c) throw new Error(m);
}
function assertEqual(a: unknown, b: unknown, m = 'values differ') {
  assert(a === b, m + ': expected ' + String(b) + ', got ' + String(a));
}
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log('PASS: ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL: ' + name);
    console.log('  ' + (e instanceof Error ? e.message : String(e)));
  }
}

const BASE_INPUT: AnalysisInput = {
  temperature: 85,
  humidity: 65,
  pressure: 29.92,
  windSpeed: 15,
  windDirection: 220,
  windGust: 25,
  dewPoint: 68,
  latitude: 35.0,
  longitude: -97.0,
  cape: 2000,
  recentObservations: [],
  nearbyStations: [],
  nwsAlerts: [],
};

const LIGHTNING_DATA = {
  totalCount: 42,
  recentCount5Min: 12,
  nearestDistanceKm: 5.3,
  ratePerMinute: 2.4,
  trend: 'INCREASING' as LightningTrend,
  cgCount: 8,
  icCount: 34,
};

void (async function main() {
  // ---- lightningTrend in StormAnalysisResult ----

  await test('no lightning → lightningTrend defaults to NONE', () => {
    const result = analyzeStorm(BASE_INPUT);
    assertEqual(result.lightningTrend, 'NONE');
  });

  await test('lightning INCREASING → lightningTrend is INCREASING', () => {
    const input = { ...BASE_INPUT, lightning: LIGHTNING_DATA };
    const result = analyzeStorm(input);
    assertEqual(result.lightningTrend, 'INCREASING');
  });

  await test('lightning DECREASING → lightningTrend is DECREASING', () => {
    const input = {
      ...BASE_INPUT,
      lightning: { ...LIGHTNING_DATA, trend: 'DECREASING' as LightningTrend },
    };
    const result = analyzeStorm(input);
    assertEqual(result.lightningTrend, 'DECREASING');
  });

  await test('lightning STABLE → lightningTrend is STABLE', () => {
    const input = {
      ...BASE_INPUT,
      lightning: { ...LIGHTNING_DATA, trend: 'STABLE' as LightningTrend },
    };
    const result = analyzeStorm(input);
    assertEqual(result.lightningTrend, 'STABLE');
  });

  await test('lightning NONE → lightningTrend is NONE', () => {
    const input = {
      ...BASE_INPUT,
      lightning: { ...LIGHTNING_DATA, trend: 'NONE' as LightningTrend },
    };
    const result = analyzeStorm(input);
    assertEqual(result.lightningTrend, 'NONE');
  });

  await test('lightning undefined on AnalysisInput → lightningTrend is NONE', () => {
    const input: AnalysisInput = { ...BASE_INPUT };
    assert(input.lightning === undefined, 'lightning should be undefined');
    const result = analyzeStorm(input);
    assertEqual(result.lightningTrend, 'NONE');
  });

  // ---- Lightning as supporting evidence in tornadicEvidence ----

  await test('lightning factors added to tornadicEvidence when lightning present', () => {
    const input = { ...BASE_INPUT, lightning: LIGHTNING_DATA };
    const rotationAssessment = {
      level: 'LOW' as const,
      radarAvailable: false,
      velocityDataAvailable: false,
      hasCouplet: false,
      coupletStrength: 'none',
      gateToGateShear: null,
      rotationalVelocity: null,
      coupletDiameter: null,
      azimuthalShear: null,
      lowLevelRotation: false,
      verticalContinuity: 0,
      trend: 'UNKNOWN' as const,
      surfaceWindPattern: null,
      description: 'No rotation data',
      factors: [],
    };
    const evidence = analyzeTornadicEvidence(input, rotationAssessment);
    const lightningFactors = evidence.factors.filter(f => f.includes('Lightning'));
    assert(lightningFactors.length > 0, 'should have lightning factors in evidence');
    assert(
      lightningFactors[0].includes('42'),
      'should include total event count in factor text'
    );
  });

  await test('no lightning data → no lightning factors in tornadicEvidence', () => {
    const rotationAssessment = {
      level: 'VERY_LOW' as const,
      radarAvailable: false,
      velocityDataAvailable: false,
      hasCouplet: false,
      coupletStrength: 'none',
      gateToGateShear: null,
      rotationalVelocity: null,
      coupletDiameter: null,
      azimuthalShear: null,
      lowLevelRotation: false,
      verticalContinuity: 0,
      trend: 'UNKNOWN' as const,
      surfaceWindPattern: null,
      description: 'No rotation data',
      factors: [],
    };
    const evidence = analyzeTornadicEvidence(BASE_INPUT, rotationAssessment);
    const lightningFactors = evidence.factors.filter(f => f.includes('Lightning'));
    assertEqual(lightningFactors.length, 0, 'should have no lightning factors');
  });

  await test('lightning nearby < 20km adds nearby factor', () => {
    const input = {
      ...BASE_INPUT,
      lightning: { ...LIGHTNING_DATA, nearestDistanceKm: 3.2 },
    };
    const rotationAssessment = {
      level: 'LOW' as const,
      radarAvailable: false,
      velocityDataAvailable: false,
      hasCouplet: false,
      coupletStrength: 'none',
      gateToGateShear: null,
      rotationalVelocity: null,
      coupletDiameter: null,
      azimuthalShear: null,
      lowLevelRotation: false,
      verticalContinuity: 0,
      trend: 'UNKNOWN' as const,
      surfaceWindPattern: null,
      description: 'No rotation data',
      factors: [],
    };
    const evidence = analyzeTornadicEvidence(input, rotationAssessment);
    const nearbyFactor = evidence.factors.find(f => f.includes('Lightning nearby'));
    assert(nearbyFactor != null, 'should have nearby lightning factor');
    assert(nearbyFactor.includes('3.2'), 'should include distance value');
  });

  await test('CG lightning adds CG factor', () => {
    const input = {
      ...BASE_INPUT,
      lightning: { ...LIGHTNING_DATA, cgCount: 15 },
    };
    const rotationAssessment = {
      level: 'LOW' as const,
      radarAvailable: false,
      velocityDataAvailable: false,
      hasCouplet: false,
      coupletStrength: 'none',
      gateToGateShear: null,
      rotationalVelocity: null,
      coupletDiameter: null,
      azimuthalShear: null,
      lowLevelRotation: false,
      verticalContinuity: 0,
      trend: 'UNKNOWN' as const,
      surfaceWindPattern: null,
      description: 'No rotation data',
      factors: [],
    };
    const evidence = analyzeTornadicEvidence(input, rotationAssessment);
    const cgFactor = evidence.factors.find(f => f.includes('CG lightning'));
    assert(cgFactor != null, 'should have CG lightning factor');
    assert(cgFactor.includes('15'), 'should include CG count');
  });

  // ---- Lightning does NOT change assessment level ----

  await test('lightning does not increase assessment level (no radar)', () => {
    const withoutLightning = analyzeStorm(BASE_INPUT);
    const withLightning = analyzeStorm({ ...BASE_INPUT, lightning: LIGHTNING_DATA });
    // Without radar, evidence level is always UNKNOWN regardless of lightning
    assertEqual(
      withoutLightning.tornadicEvidence.level,
      withLightning.tornadicEvidence.level,
      'lightning should not change tornadic evidence level'
    );
    assertEqual(
      withoutLightning.overallAssessment,
      withLightning.overallAssessment,
      'lightning should not change overall assessment'
    );
  });

  await test('lightning zero totalCount adds no lightning factors', () => {
    const input = {
      ...BASE_INPUT,
      lightning: {
        ...LIGHTNING_DATA,
        totalCount: 0,
        recentCount5Min: 0,
        cgCount: 0,
        icCount: 0,
      },
    };
    const rotationAssessment = {
      level: 'LOW' as const,
      radarAvailable: false,
      velocityDataAvailable: false,
      hasCouplet: false,
      coupletStrength: 'none',
      gateToGateShear: null,
      rotationalVelocity: null,
      coupletDiameter: null,
      azimuthalShear: null,
      lowLevelRotation: false,
      verticalContinuity: 0,
      trend: 'UNKNOWN' as const,
      surfaceWindPattern: null,
      description: 'No rotation data',
      factors: [],
    };
    const evidence = analyzeTornadicEvidence(input, rotationAssessment);
    const lightningFactors = evidence.factors.filter(f => f.includes('Lightning'));
    assertEqual(lightningFactors.length, 0, 'zero events should not add lightning factors');
  });

  // ---- Summary results ----

  console.log('\nPhase 7 lightning analysis integration tests: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
})();
