import { analyzeAdvancedEnvironment, type AdvancedEnvironmentResult, type SoundingLevel } from './advancedEnvironment';
import { guardedRequest } from '../network/requestGuard';

const HRRR_ENDPOINT = 'https://api.open-meteo.com/v1/gfs';
const PRESSURE_LEVELS = [1000, 975, 950, 925, 900, 875, 850, 800, 750, 700, 600, 500, 475, 450] as const;

export interface HrrrEnvironmentResult {
  environment: AdvancedEnvironmentResult;
  validTimeMs: number;
  source: 'NOAA_HRRR_VIA_OPEN_METEO';
}

function parseApiTimeMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const normalized = /Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nearestTimeIndex(times: unknown, referenceTimeMs: number): number | null {
  if (!Array.isArray(times) || times.length === 0) return null;
  let bestIndex: number | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 0; i < times.length; i += 1) {
    const ms = parseApiTimeMs(times[i]);
    if (ms == null) continue;
    const diff = Math.abs(ms - referenceTimeMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function valueAt(hourly: any, key: string, index: number): number | null {
  const values = hourly?.[key];
  return Array.isArray(values) ? finiteNumber(values[index]) : null;
}

function buildUrl(latitude: number, longitude: number): string {
  const pressureVariables = PRESSURE_LEVELS.flatMap((level) => [
    `temperature_${level}hPa`,
    `dew_point_${level}hPa`,
    `wind_speed_${level}hPa`,
    `wind_direction_${level}hPa`,
    `geopotential_height_${level}hPa`,
  ]);
  const hourly = [
    'temperature_2m',
    'dew_point_2m',
    'wind_speed_10m',
    'wind_direction_10m',
    'surface_pressure',
    'cape',
    'convective_inhibition',
    ...pressureVariables,
  ].join(',');

  return `${HRRR_ENDPOINT}?latitude=${latitude}&longitude=${longitude}`
    + `&models=hrrr_conus&hourly=${encodeURIComponent(hourly)}`
    + '&temperature_unit=celsius&wind_speed_unit=kn&timezone=GMT'
    + '&past_hours=2&forecast_hours=3';
}

export async function fetchHrrrAdvancedEnvironment(
  latitude: number,
  longitude: number,
  referenceTimeMs: number = Date.now(),
  fetchJson: typeof fetch = fetch,
): Promise<HrrrEnvironmentResult> {
  const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}:${Math.floor(referenceTimeMs / 900000)}`;
  return guardedRequest<HrrrEnvironmentResult>({
    service: 'HRRR environment',
    key,
    cacheTtlMs: 10 * 60 * 1000,
    execute: async () => {
      const response = await fetchJson(buildUrl(latitude, longitude));
      if (!response.ok) {
        throw new Error(`HRRR environment HTTP ${response.status}`);
      }
      const payload = await response.json();
      const hourly = payload?.hourly;
      const index = nearestTimeIndex(hourly?.time, referenceTimeMs);
      if (index == null) throw new Error('HRRR environment has no valid hourly time');

      const validTimeMs = parseApiTimeMs(hourly.time[index]);
      if (validTimeMs == null) throw new Error('HRRR environment valid time is invalid');
      if (Math.abs(referenceTimeMs - validTimeMs) > 2 * 60 * 60 * 1000) {
        throw new Error('HRRR environment profile is more than 2 hours from analysis time');
      }

      const elevationM = finiteNumber(payload?.elevation) ?? 0;
      const surfaceTempC = valueAt(hourly, 'temperature_2m', index);
      const surfaceDewC = valueAt(hourly, 'dew_point_2m', index);
      const surfaceWindKt = valueAt(hourly, 'wind_speed_10m', index);
      const surfaceWindDir = valueAt(hourly, 'wind_direction_10m', index);
      const surfacePressure = valueAt(hourly, 'surface_pressure', index);

      const levels: SoundingLevel[] = [];
      if (
        surfaceTempC != null && surfaceDewC != null && surfaceWindKt != null
        && surfaceWindDir != null && surfacePressure != null
      ) {
        levels.push({
          pressureHpa: surfacePressure,
          heightM: 0,
          temperatureC: surfaceTempC,
          dewPointC: surfaceDewC,
          windSpeedKt: surfaceWindKt,
          windDirectionDeg: surfaceWindDir,
        });
      }

      for (const pressureHpa of PRESSURE_LEVELS) {
        const temperatureC = valueAt(hourly, `temperature_${pressureHpa}hPa`, index);
        const dewPointC = valueAt(hourly, `dew_point_${pressureHpa}hPa`, index);
        const windSpeedKt = valueAt(hourly, `wind_speed_${pressureHpa}hPa`, index);
        const windDirectionDeg = valueAt(hourly, `wind_direction_${pressureHpa}hPa`, index);
        const heightAslM = valueAt(hourly, `geopotential_height_${pressureHpa}hPa`, index);
        if (
          temperatureC == null || dewPointC == null || windSpeedKt == null
          || windDirectionDeg == null || heightAslM == null
        ) continue;

        const heightM = heightAslM - elevationM;
        if (!Number.isFinite(heightM) || heightM < 50) continue;
        levels.push({
          pressureHpa,
          heightM,
          temperatureC,
          dewPointC,
          windSpeedKt,
          windDirectionDeg,
        });
      }

      if (levels.length < 3) {
        throw new Error(`HRRR environment profile incomplete (${levels.length} usable levels)`);
      }

      const capeJkg = valueAt(hourly, 'cape', index);
      const cinJkg = valueAt(hourly, 'convective_inhibition', index);
      const environment = analyzeAdvancedEnvironment({
        levels,
        capeJkg,
        cinJkg,
        stormMotionDirectionDeg: null,
        stormMotionSpeedKt: null,
      });

      return {
        environment: {
          ...environment,
          limitations: [
            ...environment.limitations,
            'Upper-air source: NOAA HRRR pressure levels via Open-Meteo',
          ],
        },
        validTimeMs,
        source: 'NOAA_HRRR_VIA_OPEN_METEO',
      };
    },
  });
}
