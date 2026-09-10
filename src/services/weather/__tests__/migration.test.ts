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
function assert(condition: boolean, message: string): asserts condition { if (!condition) throw new Error(message); }
function assertEqual(actual: unknown, expected: unknown, message = 'Values must be equal') {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}
function assertApprox(actual: number | null | undefined, expected: number, tolerance = 0.000001) {
  assert(actual != null && Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);
}
function jsonResponse(status: number, body: any) { return { ok: status >= 200 && status < 300, status, json: async () => body } as Response; }

const offset = -14400;
const localMidnight = Date.parse('2026-08-22T04:00:00Z');
const reference = Date.parse('2026-08-22T19:30:00Z');
const bucketsFor = (values: (number | null)[]): MrmsBucketInput[] => values.map((valueMm, hour) => ({
  startMs: localMidnight + hour * 3600000,
  endMs: localMidnight + (hour + 1) * 3600000,
  valueMm,
  complete: true,
}));

function stationFeature(id: string, lat: number, lon: number, name = id) {
  return { id: `https://api.weather.gov/stations/${id}`, geometry: { coordinates: [lon, lat] }, properties: { stationIdentifier: id, name } };
}
function observation(timestamp: string, tempC = 25) {
  return { properties: {
    timestamp, textDescription: 'Light Rain',
    temperature: { value: tempC, unitCode: 'wmoUnit:degC', qualityControl: 'V' },
    dewpoint: { value: 18, unitCode: 'wmoUnit:degC', qualityControl: 'V' },
    relativeHumidity: { value: 65, unitCode: 'wmoUnit:percent', qualityControl: 'V' },
    windDirection: { value: 200, unitCode: 'wmoUnit:degree_(angle)', qualityControl: 'V' },
    windSpeed: { value: 16.668, unitCode: 'wmoUnit:km_h-1', qualityControl: 'V' },
    windGust: { value: 32, unitCode: 'wmoUnit:km_h-1', qualityControl: 'V' },
    seaLevelPressure: { value: 101049.84, unitCode: 'wmoUnit:Pa', qualityControl: 'V' },
    barometricPressure: { value: null, unitCode: 'wmoUnit:Pa', qualityControl: 'Z' },
    altimeter: { value: null, unitCode: 'wmoUnit:Pa', qualityControl: 'Z' },
    visibility: { value: 16093.44, unitCode: 'wmoUnit:m', qualityControl: 'V' },
    precipitationLastHour: { value: 0.0127, unitCode: 'wmoUnit:m', qualityControl: 'V' },
    presentWeather: [{ intensity: 'light', weather: 'rain' }], cloudLayers: [],
  } };
}

const tests = [
  test('unit conversions are exact', () => {
    assertApprox(mmToInches(25.4), 1); assertApprox(mmPerHourToInchesPerHour(25.4), 1);
    assertApprox(celsiusToFahrenheit(25), 77); assertApprox(kmhToMph(16.668), 10.357011828, 0.0001);
    assertApprox(pascalToInchesOfMercury(101049.84), 29.84, 0.0001);
  }),
  test('MRMS hourly buckets accumulate once', () => {
    const values = [0, 2.54, 5.08, 0, ...Array.from({ length: 11 }, () => 0)];
    const result = accumulateMrmsDailyPrecipitation(bucketsFor(values), reference, offset);
    assertApprox(result.observedDailyPrecipitationInches, 0.3);
    assert(result.observedDailyIsComplete, 'Completed buckets should produce a complete daily accumulation');
  }),
  test('nearest stale NWS station is skipped for next fresh station', async () => {
    const fetchJson = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/points/40.0393,-82.4606/stations')) return jsonResponse(200, { features: [
        stationFeature('KAAA', 40.04, -82.46, 'Nearest stale'), stationFeature('KBBB', 40.10, -82.50, 'Second fresh'),
      ] });
      if (url.includes('/stations/KAAA/')) return jsonResponse(200, observation('2026-08-22T17:00:00Z'));
      if (url.includes('/stations/KBBB/')) return jsonResponse(200, observation('2026-08-22T19:15:00Z'));
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;
    const result = await fetchBestNwsObservation(40.0393, -82.4606, reference, fetchJson);
    assert(result.success, `Expected fresh fallback station: ${result.error}`);
    assert(result.data?.currentConditionsSource?.stationId === 'KBBB', 'Fresh second station should be selected');
    assert(result.data?.currentConditionsSource?.dataKind === 'observed', 'Station data must be marked observed');
    assert((result.data?.currentConditionsSource?.distanceKm ?? 0) > 0, 'Station distance must be recorded');
  }),
  test('alerts expire and de-duplicate by ID', () => {
    const now = Date.parse('2026-08-22T20:00:00Z');
    const alerts = normalizeNwsAlerts([
      { id: 'same-id', properties: { event: 'Tornado Warning', expires: '2026-08-22T21:00:00Z' } },
      { id: 'same-id', properties: { event: 'Duplicate Warning', expires: '2026-08-22T21:00:00Z' } },
      { id: 'expired', properties: { event: 'Old Warning', expires: '2026-08-22T19:59:59Z' } },
    ], now);
    assert(alerts.length === 1 && alerts[0].event === 'Tornado Warning', 'Expired/duplicate alert handling');
  }),
  test('composite provider prioritizes observed NWS conditions and MRMS rainfall', async () => {
    const fetchJson = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('https://api.open-meteo.com')) return jsonResponse(200, {
        utc_offset_seconds: offset, timezone: 'America/New_York',
        current: { temperature_2m: 80, relative_humidity_2m: 50, wind_speed_10m: 0, wind_direction_10m: 0, wind_gusts_10m: 0, weather_code: 0, precipitation: 0.01, surface_pressure: 97700, pressure_msl: 101000 },
        hourly: { time: ['2026-08-22T00:00'], precipitation: [0.01], cape: [1000], temperature_2m: [80], precipitation_probability: [50], weather_code: [0] }, daily: { time: [] },
      });
      if (url.includes('/points/40.1601,-82.2386/stations')) return jsonResponse(200, { features: [stationFeature('KOBS', 40.17, -82.24, 'Nearby observed')] });
      if (url.includes('/stations/KOBS/')) return jsonResponse(200, observation('2026-08-22T19:15:00Z'));
      if (url.startsWith('https://api.weather.gov/points/')) return jsonResponse(200, { properties: { gridId: 'ILN', gridX: 111, gridY: 93, timezone: 'America/New_York', forecast: 'https://api.weather.gov/gridpoints/ILN/111,93/forecast', forecastHourly: 'https://api.weather.gov/gridpoints/ILN/111,93/forecast/hourly' } });
      if (url.endsWith('/forecast') || url.endsWith('/forecast/hourly')) return jsonResponse(200, { properties: { periods: [{ startTime: '2026-08-22T16:00:00-04:00', endTime: '2026-08-22T18:00:00-04:00', temperature: 78, temperatureUnit: 'F', probabilityOfPrecipitation: { value: 71 }, windSpeed: '8 mph', windDirection: 'SW', shortForecast: 'Thunderstorms' }] } });
      throw new Error(`Unexpected test URL ${url}`);
    }) as typeof fetch;
    const mrms = { getPrecipitation: async (): Promise<MrmsPrecipitation> => ({
      currentOneHourInches: 1.25, currentPartialHourInches: null, precipitationRateInchesPerHour: null,
      observedDailyPrecipitationInches: null, observedDailyIsComplete: false,
      radarPrecipitation1hInches: 1.25, radarPrecipitation3hInches: 2.1, radarPrecipitation24hInches: 2.4,
      dataAvailable: true, missingHours: [], usedHours: [], weatherLocalDate: '2026-08-22',
      source: { provider: 'NOAA_MRMS', source: 'NOAA MRMS', retrievedTime: reference, observationTime: reference, freshness: 'current', confidence: 0.9, completeness: 1, dataKind: 'radar_estimated' },
    }) };
    const provider = createStormLogWeatherProvider({ fetchJson, mrmsProvider: mrms });
    const result = await provider.getCurrentWeather(40.1601, -82.2386, reference);
    assert(result.success, `Provider failed: ${!result.success ? result.error : ''}`); if (!result.success) return;
    assertApprox(result.data.temperature, 77); assertApprox(result.data.pressure, 29.84, 0.01);
    assertApprox(result.data.radarPrecipitation1h, 1.25); assertApprox(result.data.radarPrecipitation3h, 2.1);
    assert(result.data.observedDailyPrecipitation == null, 'Rolling radar QPE must not masquerade as local-day accumulation');
    assert(result.data.precipitationSource?.provider === 'NOAA_MRMS', 'MRMS must beat modeled precipitation');
    assert(result.data.currentConditionsSource?.stationId === 'KOBS', 'Location-selected station provenance');
  }),
];

Promise.all(tests).then(() => {
  console.log(`\n=== WEATHER INTEGRITY TEST RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
});
