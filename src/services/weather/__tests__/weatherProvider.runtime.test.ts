import { createStormLogWeatherProvider } from '../stormLogProvider';
import type { MrmsProvider } from '../mrms';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function jsonResponse(status: number, body: any, jsonError?: Error): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => { if (jsonError) throw jsonError; return body; } } as Response;
}
const reference = Date.parse('2026-09-03T04:30:00Z');

function stationCollection() {
  return { features: [{ id: 'https://api.weather.gov/stations/KVTA', geometry: { coordinates: [-82.461, 40.024] }, properties: { stationIdentifier: 'KVTA', name: 'Newark-Heath Airport' } }] };
}
function nwsObservationBody() {
  return { properties: {
    timestamp: '2026-09-03T04:15:00Z', textDescription: 'Clear',
    temperature: { value: 25, unitCode: 'wmoUnit:degC', qualityControl: 'V' },
    dewpoint: { value: 20, unitCode: 'wmoUnit:degC', qualityControl: 'V' },
    relativeHumidity: { value: 70, unitCode: 'wmoUnit:percent', qualityControl: 'V' },
    windDirection: { value: 180, unitCode: 'wmoUnit:degree_(angle)', qualityControl: 'V' },
    windSpeed: { value: 9.26, unitCode: 'wmoUnit:km_h-1', qualityControl: 'V' },
    windGust: { value: null, unitCode: 'wmoUnit:km_h-1', qualityControl: 'Z' },
    barometricPressure: { value: 101049.84, unitCode: 'wmoUnit:Pa', qualityControl: 'V' },
    seaLevelPressure: { value: null, unitCode: 'wmoUnit:Pa', qualityControl: 'Z' },
    altimeter: { value: null, unitCode: 'wmoUnit:Pa', qualityControl: 'Z' },
    visibility: { value: 16093.44, unitCode: 'wmoUnit:m', qualityControl: 'V' },
    precipitationLastHour: { value: 2.54, unitCode: 'wmoUnit:mm', qualityControl: 'V' },
    presentWeather: [], cloudLayers: [],
  } };
}

async function openMeteoFailureFallsBackToNws() {
  let mrmsCalls = 0;
  const mrmsProvider: MrmsProvider = { async getPrecipitation() { mrmsCalls++; throw new Error('MRMS should not run without a trusted timezone offset'); } };
  const fetchJson = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('https://api.open-meteo.com')) return jsonResponse(200, null, new Error('JSON Parse error: Unexpected character: U'));
    if (url === 'https://api.weather.gov/points/40.0393,-82.4606') return jsonResponse(200, { properties: { observationStations: 'https://api.weather.gov/gridpoints/ILN/103,86/stations' } });
    if (url === 'https://api.weather.gov/gridpoints/ILN/103,86/stations') return jsonResponse(200, stationCollection());
    if (url.includes('/stations/KVTA/observations/latest')) return jsonResponse(200, nwsObservationBody());
    if (url.startsWith('https://api.weather.gov/points/')) return jsonResponse(503, {});
    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;

  const provider = createStormLogWeatherProvider({ fetchJson, mrmsProvider });
  const result = await provider.getCurrentWeather(40.0393, -82.4606, reference);
  assert(result.success, `NWS fallback should keep weather usable: ${!result.success ? result.error : ''}`);
  if (!result.success) return;
  assert(result.data.temperature === 77, `Expected NWS temperature 77°F, got ${result.data.temperature}`);
  assert(result.data.currentConditionsSource?.stationId === 'KVTA', 'Expected NWS provenance');
  assert(Math.abs((result.data.stationPrecipitation1h ?? 0) - 0.1) < 0.0001, 'Expected NWS 1h precipitation conversion');
  assert(result.data.cape == null, 'CAPE must remain unavailable when Open-Meteo fails');
  assert(mrmsCalls === 0, 'MRMS must be skipped when weather-location UTC offset is unavailable');
}

async function optionalProviderFailuresDoNotEraseOpenMeteo() {
  const fetchJson = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('https://api.open-meteo.com')) return jsonResponse(200, {
      utc_offset_seconds: -14400, timezone: 'America/New_York',
      current: { temperature_2m: 73, relative_humidity_2m: 100, wind_speed_10m: 0, wind_direction_10m: 0, wind_gusts_10m: 11, weather_code: 0, precipitation: 0, surface_pressure: 100000, pressure_msl: 101625 },
      hourly: { time: ['2026-09-03T00:00'], precipitation: [0], cape: [null], temperature_2m: [73], precipitation_probability: [0], weather_code: [0] },
      daily: { time: [] },
    });
    if (url.startsWith('https://api.weather.gov/points/')) return jsonResponse(200, null, new Error('JSON Parse error: Unexpected character: U'));
    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;
  const mrmsProvider: MrmsProvider = { async getPrecipitation() { throw new Error('simulated MRMS outage'); } };
  const provider = createStormLogWeatherProvider({ fetchJson, mrmsProvider, features: { NWS_CURRENT_CONDITIONS: false, NWS_PRESSURE: false, NWS_FORECAST: true, MRMS_PRECIPITATION: true } });
  const result = await provider.getCurrentWeather(40.0493, -82.4606, reference);
  assert(result.success, `Open-Meteo baseline should survive optional provider failures: ${!result.success ? result.error : ''}`);
  if (!result.success) return;
  assert(result.data.temperature === 73, `Expected Open-Meteo temperature 73°F, got ${result.data.temperature}`);
  assert(result.data.weatherCondition === 'Clear sky', 'Expected Open-Meteo current conditions');
}

(async () => {
  await openMeteoFailureFallsBackToNws();
  console.log('PASS: Open-Meteo malformed JSON falls back to mobile NWS station discovery');
  await optionalProviderFailuresDoNotEraseOpenMeteo();
  console.log('PASS: NWS/MRMS failures do not erase Open-Meteo weather data');
})();
