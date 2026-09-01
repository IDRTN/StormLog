import { analyzeStorm } from '../tornadoAnalysis';
import type { AnalysisInput } from '../types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message = 'values differ') {
  assert(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

async function test(name: string, task: () => Promise<void> | void) {
  try {
    await task();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL: ${name}`);
    console.log(`  ${error instanceof Error ? error.message : String(error)}`);
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

async function main() {
  await test('favorable environment + no storm → LOW or below', () => {
    const result = analyzeStorm(BASE_INPUT);
    assert(['VERY_LOW', 'LOW'].includes(result.overallAssessment), 'assessment should be VERY_LOW or LOW');
  });

  await test('no radar velocity → capped at MODERATE', () => {
    const input: AnalysisInput = {
      ...BASE_INPUT,
      radarData: {
        available: true,
        hasPrecipitation: true,
        maxReflectivityDbz: 55,
        velocityPoints: [],
        couplets: [],
        stormCells: [],
      },
    };
    const result = analyzeStorm(input);
    const order = ['VERY_LOW', 'LOW', 'MARGINAL', 'MODERATE', 'HIGH', 'VERY_HIGH'];
    assert(order.indexOf(result.overallAssessment) <= 3, 'assessment should not exceed MODERATE');
  });

  await test('radar unavailable → rotation marked unavailable', () => {
    const result = analyzeStorm(BASE_INPUT);
    assertEqual(result.rotation.velocityDataAvailable, false);
    assertEqual(result.dataQuality.velocityData, 'UNAVAILABLE');
  });

  await test('NWS tornado warning shown separately', () => {
    const input: AnalysisInput = {
      ...BASE_INPUT,
      nwsAlerts: [{ event: 'Tornado Warning', severity: 'Extreme', headline: null }],
    };
    const result = analyzeStorm(input);
    assertEqual(result.nwsStatus.tornadoWarning, true);
  });

  await test('whatWouldIncreaseConcern is populated', () => {
    const result = analyzeStorm(BASE_INPUT);
    assert(result.whatWouldIncreaseConcern.length > 0, 'whatWouldIncreaseConcern should not be empty');
  });

  await test('confidence reduced without velocity', () => {
    const result = analyzeStorm(BASE_INPUT);
    assert(['LOW', 'UNKNOWN', 'MODERATE'].includes(result.dataQuality.level), 'confidence level should be LOW, UNKNOWN, or MODERATE');
  });

  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main();
