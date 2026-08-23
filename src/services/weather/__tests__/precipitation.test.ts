// ============================================================
// Deterministic Precipitation Tests
// Run: npx tsx src/services/weather/__tests__/precipitation.test.ts
// ============================================================
import { calculateObservedDailyPrecip } from '../openMeteo';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error: any) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error?.message ?? error}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert.strictEqual = (actual: unknown, expected: unknown, message = 'Values must be strictly equal') => {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
};

assert.deepStrictEqual = (actual: unknown, expected: unknown, message = 'Values must be deeply equal') => {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
};

function assertApprox(actual: number, expected: number, message: string) {
  const tolerance = 0.000001;
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function makeTimes(date: string, hours: number[]): string[] {
  return hours.map((hour) => `${date}T${String(hour).padStart(2, '0')}:00`);
}

// Build an epoch instant whose representation in the supplied weather offset
// is exactly date:hour. Date.UTC deliberately ignores the device timezone.
function referenceMs(weatherDate: string, hour: number, utcOffsetSeconds: number): number {
  const utcDayMs = Date.parse(`${weatherDate}T00:00:00Z`);
  if (Number.isNaN(utcDayMs)) throw new Error(`Invalid test date: ${weatherDate}`);
  return utcDayMs + hour * 3600000 - utcOffsetSeconds * 1000;
}

console.log('\n=== DETERMINISTIC PRECIPITATION TESTS ===\n');

test('A: valid zero precipitation', () => {
  const times = makeTimes('2026-08-21', [0, 1, 2, 3, 4, 5]);
  const result = calculateObservedDailyPrecip(times, [0, 0, 0, 0, 0, 0], 0, referenceMs('2026-08-21', 5, 0));
  assertApprox(result.total, 0, 'Zero total');
  assert(result.isComplete, 'Coverage should be complete');
  assert.strictEqual(result.weatherLocalDate, '2026-08-21');
});

test('B: single non-zero hourly amount', () => {
  const times = makeTimes('2026-08-21', [0, 1, 2, 3, 4, 5]);
  const result = calculateObservedDailyPrecip(times, [0, 0, 0.10, 0, 0, 0], -14400, referenceMs('2026-08-21', 5, -14400));
  assertApprox(result.total, 0.10, 'Non-zero total');
  assert(result.isComplete, 'Coverage should be complete');
});

test('C: hourly amounts accumulate', () => {
  const times = makeTimes('2026-08-21', [0, 1, 2, 3, 4]);
  const result = calculateObservedDailyPrecip(times, [0, 0.05, 0.12, 0.20, 0.35], 0, referenceMs('2026-08-21', 4, 0));
  assertApprox(result.total, 0.72, 'Hourly amounts sum');
  assert(result.isComplete, 'Coverage should be complete');
});

test('D: cumulative-looking values are treated as hourly amounts', () => {
  const times = makeTimes('2026-08-21', [0, 1, 2, 3]);
  const result = calculateObservedDailyPrecip(times, [0, 0.05, 0.07, 0.08], 7200, referenceMs('2026-08-21', 3, 7200));
  assertApprox(result.total, 0.20, 'Open-Meteo hourly amount semantics');
  assert(result.isComplete, 'Coverage should be complete');
});

test('E: null does not become zero and coverage is incomplete', () => {
  const times = makeTimes('2026-08-21', [0, 1, 2, 3]);
  const result = calculateObservedDailyPrecip(times, [0, null, 0.10, 0], 0, referenceMs('2026-08-21', 3, 0));
  assertApprox(result.total, 0.10, 'Partial observed total');
  assert.strictEqual(result.nullValuesSkipped.length, 1);
  assert(!result.isComplete, 'Null required observation must be incomplete');
});

test('F: all-null day is incomplete, not valid zero', () => {
  const times = makeTimes('2026-08-21', [0, 1, 2]);
  const result = calculateObservedDailyPrecip(times, [null, null, null], 0, referenceMs('2026-08-21', 2, 0));
  assertApprox(result.total, 0, 'Arithmetic partial remains zero');
  assert.strictEqual(result.nullValuesSkipped.length, 3);
  assert(!result.isComplete, 'All-null coverage must be incomplete');
});

test('G: missing current-hour observation is incomplete', () => {
  const times = makeTimes('2026-08-21', [0, 1, 2]);
  const result = calculateObservedDailyPrecip(times, [0, 0, 0], 0, referenceMs('2026-08-21', 3, 0));
  assert(!result.isComplete, 'Missing required hour must be incomplete');
});

test('H: weather-local midnight boundary', () => {
  const times = [
    '2026-08-20T23:00',
    '2026-08-21T00:00',
    '2026-08-21T01:00',
  ];
  const result = calculateObservedDailyPrecip(times, [0.50, 0.10, 0.20], 0, referenceMs('2026-08-21', 1, 0));
  assert.deepStrictEqual(result.hourlyValuesUsed.map(({ time }) => time), [
    '2026-08-21T00:00',
    '2026-08-21T01:00',
  ]);
  assertApprox(result.total, 0.30, 'Previous local day excluded');
  assert(result.isComplete, 'Coverage should be complete');
});

test('I: identical inputs produce identical results', () => {
  const times = makeTimes('2026-08-21', [0, 1, 2, 3, 4]);
  const values = [0, 0.05, 0.10, 0, 0.03];
  const reference = referenceMs('2026-08-21', 4, -18000);
  const results = Array.from({ length: 5 }, () =>
    calculateObservedDailyPrecip(times, values, -18000, reference)
  );
  assert.deepStrictEqual(results[0], results[4], 'Five repeated calculations');
  assertApprox(results[0].total, 0.18, 'Repeated refresh total');
  assert(results.every((result) => result.isComplete), 'Repeated coverage decisions');
});

test('J: UTC offset controls weather-local selection', () => {
  const times = makeTimes('2026-08-21', Array.from({ length: 24 }, (_, hour) => hour));
  const values = Array.from({ length: 24 }, () => 0.01);

  // Same UTC instant: 2026-08-21 12:00 UTC is 14:00 UTC+02 and 07:00 UTC-05.
  const reference = Date.parse('2026-08-21T12:00:00Z');
  const plusTwo = calculateObservedDailyPrecip(times, values, 7200, reference);
  const minusFive = calculateObservedDailyPrecip(times, values, -18000, reference);

  assert.strictEqual(plusTwo.weatherLocalHour, 14);
  assert.strictEqual(minusFive.weatherLocalHour, 7);
  assert.strictEqual(plusTwo.hourlyValuesUsed.length, 15);
  assert.strictEqual(minusFive.hourlyValuesUsed.length, 8);
  assert(plusTwo.isComplete, 'Hours 00 through local hour 14 are present');
  assert(minusFive.isComplete, 'Hours 00 through local hour 07 are present');
});

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
