// Deterministic migration tests. Run: npx tsx src/services/weather/__tests__/migration.test.ts
import { celsiusToFahrenheit, kmhToMph, mmToInches, mmPerHourToInchesPerHour, pascalToInchesOfMercury } from '../conversions';
import { accumulateMrmsDailyPrecipitation, type MrmsBucketInput, type MrmsPrecipitation } from '../mrms';
import { fetchBestNwsObservation } from '../nwsObservations';
import { createStormLogWeatherProvider } from '../stormLogProvider';
import { normalizeNwsAlerts } from '../../nws/alerts';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log(`PASS: ${name}`); },
    (error: any) => { failed++; console.log(`FAIL: ${name}\n  ${error?.message ?? error}`); },
  );
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message = 'Values must be equal') {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}

function assertApprox(actual: number | null | undefined, expected: number, tolerance = 0.000001) {
  assert(actual != null && Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);
}

function jsonResponse(status: number, body: any) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function referenceAt(weatherLocalIsoUtcWallClock: string, offsetSeconds: number) {
  return Date.parse(weatherLocalIsoUtcWallClock) - offsetSeconds * 1000;
}

const offset = -14400;
const localMidnight = Date.parse('2026-08-22T00:00:00Z') - offset * 1000;
const reference = referenceAt('2026-08-22T15:30:00Z', offset);
const bucketsFor = (values: (number | null)[]): MrmsBucketInput[] =>
  values.map((valueMm, hour) => ({
    startMs: localMidnight + hour * 3600000,
    endMs: localMidnight + (hour + 1) * 3600000,
    valueMm,
    complete: true,
  }));

const tests = [
  test('unit conversions are exact', () => {
    assertApprox(mmToInches(25.4), 1);
    assertApprox(mmToInches(12.7), 0.5);
    assertApprox(mmToInches(2.54), 0.1);
    assertApprox(mmPerHourToInchesPerHour(25.4), 1);
    assertApprox(celsiusToFahrenheit(25), 77);
    assertApprox(kmhToMph(16.668), 10.357011828, 0.0001);
    assertApprox(pascalToInchesOfMercury(101049.84), 29.84, 0.0001);
  }),

  test('MRMS hourly buckets accumulate once', () => {
    const values = [0, 2.54, 5.08, 0, ...Array.from({ length: 11 }, () => 0)];
    const result = accumulateMrmsDailyPrecipitation(bucketsFor(values), reference, offset);
    assertApprox(result.observedDailyPrecipitationInches, 0.3);
    assert(result.observedDailyIsComplete, 'Hours 00-14 should be complete');
    assertEqual(result.usedHours.length, 15, 'Completed bucket count');
  }),

  test('MRMS missing/null buckets remain incomplete', () => {
    const values = Array.from({ length: 15 }, (_, index) => index === 9 ? null : 0);
    const result = accumulateMrmsDailyPrecipitation(bucketsFor(values), reference, offset);
    assert(!result.observedDailyIsComplete, 'Null required bucket must be incomplete');
    assertEqual(result.missingHours.length, 1, 'One unavailable bucket');
    assertApprox(result.observedDailyPrecipitationInches, 0);
  }),

  test('MRMS ignores future and duplicate rolling buckets', () => {
    const valid = bucketsFor(Array.from({ length: 15 }, () => 0));
    const future = [{ startMs: localMidnight + 15 * 3600000, endMs: localMidnight + 16 * 3600000, valueMm: 254, complete: true }];
    const duplicateOlder = [{ ...valid[0], valueMm: 254 }];
    const result = accumulateMrmsDailyPrecipitation([...valid, ...future, ...duplicateOlder], reference, offset);
    assertApprox(result.observedDailyPrecipitationInches, 0);
    assert(result.observedDailyIsComplete, 'Future bucket must not affect completeness');
  }),

  test('NWS station fallback preserves one-station provenance', async () => {
    let calls = 0;
    const fetchJson = (async () => {
      calls++;
      return jsonResponse(500, {});
    }) as typeof fetch;
    const result = await fetchBestNwsObservation(reference, fetchJson);
    assert(!result.success, 'Both stations failing must return failure');
    assert(calls === 2, `Expected primary then backup, got ${calls} calls`);
  }),

  test('alerts expire and de-duplicate by ID', () => {
    const now = Date.parse('2026-08-22T20:00:00Z');
    const alerts = normalizeNwsAlerts([
      { id: 'same-id', properties: { event: 'Tornado Warning', expires: '2026-08-22T21:00:00Z' } },
      { id: 'same-id', properties: { event: 'Duplicate Warning', expires: '2026-08-22T21:00:00Z' } },
      { id: 'expired', properties: { event: 'Old Warning', expires: '2026-08-22T19:59:59Z' } },
    ], now);
    assert(alerts.length === 1, 'Expired and duplicate alerts removed');
    assert(alerts[0].event === 'Tornado Warning', 'First valid alert wins');
  }),

  test('composite provider prioritizes NWS, MRMS, and NWS forecast', async () => {
    const fetchJson = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('https://api.open-meteo.com')) {
        return jsonResponse(200, {
          utc_offset_seconds: offset,
          timezone: 'America/New_York',
          current: {
            temperature_2m: 80, relative_humidity_2m: 50, wind_speed_10m: 0,
            wind_direction_10m: 0, wind_gusts_10m: 0, weather_code: 0,
            precipitation: null, surface_pressure: 97700, pressure_msl: 101049.84,
          },
          hourly: { time: ['2026-08-22T00:00'], cape: [1000] },
          daily: {},
        });
      }
      if (url.includes('/stations/KVTA/observations/latest')) {
        return jsonResponse(200, {
          properties: {
            timestamp: '2026-08-22T19:15:00Z',
            textDescription: 'Light Rain',
            temperature: { value: 25, qualityControl: 'V' },
            dewpoint: { value: 18, qualityControl: 'V' },
            relativeHumidity: { value: 65, qualityControl: 'V' },
            windDirection: { value: 200, qualityControl: 'V' },
            windSpeed: { value: 16.668, qualityControl: 'V' },
            windGust: { value: null, qualityControl: 'Z' },
            barometricPressure: { value: 101049.84, qualityControl: 'V' },
            seaLevelPressure: { value: null, qualityControl: 'Z' },
            altimeter: { value: null, qualityControl: 'Z' },
            visibility: { value: 16093.44, qualityControl: 'C' },
            presentWeather: [{ intensity: 'light', weather: 'rain' }],
            cloudLayers: [{ amount: 'OVC', base: { value: 2286 } }],
          },
        });
      }
      if (url.startsWith('https://api.weather.gov/points/')) {
        return jsonResponse(200, {
          properties: {
            gridId: 'ILN', gridX: 111, gridY: 93, timezone: 'America/New_York',
            forecast: 'https://api.weather.gov/gridpoints/ILN/111,93/forecast',
            forecastHourly: 'https://api.weather.gov/gridpoints/ILN/111,93/forecast/hourly',
          },
        });
      }
      if (url.endsWith('/forecast') || url.endsWith('/forecast/hourly')) {
        return jsonResponse(200, { properties: { periods: [{
          startTime: '2026-08-22T16:00:00-04:00', endTime: '2026-08-22T18:00:00-04:00',
          temperature: 78, temperatureUnit: 'F', probabilityOfPrecipitation: { value: 71 },
          windSpeed: '8 mph', windDirection: 'SW', shortForecast: 'Showers And Thunderstorms Likely',
        }] } });
      }
      throw new Error(`Unexpected test URL ${url}`);
    }) as typeof fetch;

    const mrms = {
      getPrecipitation: async (): Promise<MrmsPrecipitation | null> => ({
        currentOneHourInches: 0.5511811023622047,
        currentPartialHourInches: null,
        precipitationRateInchesPerHour: 0.3700787401574803,
        observedDailyPrecipitationInches: 0.5511811023622047,
        observedDailyIsComplete: true,
        dataAvailable: true,
        missingHours: [],
        usedHours: [],
        weatherLocalDate: '2026-08-22',
        source: {
          provider: 'NOAA_MRMS' as const, source: 'MRMS service/cache', retrievedTime: reference,
          observationTime: reference, freshness: 'current', confidence: 0.85, completeness: 1,
        },
      }),
    };

    const provider = createStormLogWeatherProvider({ fetchJson, mrmsProvider: mrms });
    const result = await provider.getCurrentWeather(40.1601, -82.2386, reference);
    assert(result.success, `Provider failed: ${!result.success ? result.error : ''}`);
    if (!result.success) return;
    assertApprox(result.data.temperature, 77);
    assertApprox(result.data.pressure, 29.84);
    assertApprox(result.data.observedDailyPrecipitation!, 0.5511811, 0.000001);
    assert(result.data.precipitationSource?.provider === 'NOAA_MRMS', 'MRMS precipitation provenance');
    assert(result.data.currentConditionsSource?.stationId === 'KVTA', 'NWS station provenance');
    assert(result.data.forecastSource?.gridId === 'ILN/111,93', 'NWS forecast provenance');
    assert(result.data.capeSource?.provider === 'OPEN_METEO', 'Open-Meteo CAPE provenance');
    assertEqual(result.data.referenceTimeMs, reference, 'One acquisition reference time');
  }),
];

Promise.all(tests).then(() => {
  console.log(`\n=== MIGRATION TEST RESULTS: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
});
