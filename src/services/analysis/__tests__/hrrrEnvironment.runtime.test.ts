import { strict as assert } from 'node:assert';
import { fetchHrrrAdvancedEnvironment } from '../hrrrEnvironment';

function response(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

function profilePayload(referenceTimeMs: number) {
  const iso = new Date(referenceTimeMs).toISOString().slice(0, 13) + ':00';
  const hourly: Record<string, unknown[]> = {
    time: [iso],
    temperature_2m: [22],
    dew_point_2m: [19],
    wind_speed_10m: [12],
    wind_direction_10m: [170],
    surface_pressure: [990],
    cape: [1800],
    convective_inhibition: [-40],
  };

  const levels = [1000, 975, 950, 925, 900, 875, 850, 800, 750, 700, 600, 500, 475, 450];
  const heights = [120, 330, 560, 790, 1020, 1260, 1510, 2030, 2580, 3160, 4400, 5750, 6130, 6530];
  levels.forEach((level, index) => {
    hourly[`temperature_${level}hPa`] = [21 - index * 2];
    hourly[`dew_point_${level}hPa`] = [18 - index * 2.1];
    hourly[`wind_speed_${level}hPa`] = [15 + index * 4];
    hourly[`wind_direction_${level}hPa`] = [175 + index * 7];
    hourly[`geopotential_height_${level}hPa`] = [heights[index]];
  });

  return { elevation: 100, hourly };
}

async function run(): Promise<void> {
  const referenceTimeMs = Date.UTC(2026, 8, 3, 7, 0, 0);
  const goodFetch = async () => response(profilePayload(referenceTimeMs));
  const result = await fetchHrrrAdvancedEnvironment(40.1, -82.3, referenceTimeMs, goodFetch as typeof fetch);

  assert.equal(result.source, 'NOAA_HRRR_VIA_OPEN_METEO');
  assert.equal(result.validTimeMs, referenceTimeMs);
  assert.equal(result.environment.capeJkg, 1800);
  assert.equal(result.environment.cinJkg, -40);
  assert.ok(result.environment.sourceLevelCount >= 10);
  assert.ok(result.environment.lowLevelShear01KmKt != null);
  assert.ok(result.environment.deepLayerShear06KmKt != null);
  assert.ok(result.environment.lclHeightM != null);
  assert.equal(result.environment.srh03M2s2, null);
  assert.ok(result.environment.limitations.some((item) => item.includes('Storm motion unavailable')));

  // Use a different point for each negative scenario so the provider cache
  // cannot mask the payload under test.
  const stalePayload = profilePayload(referenceTimeMs - 3 * 60 * 60 * 1000);
  const staleFetch = async () => response(stalePayload);
  await assert.rejects(
    () => fetchHrrrAdvancedEnvironment(40.2, -82.3, referenceTimeMs, staleFetch as typeof fetch),
    /more than 2 hours/,
  );

  const incompleteFetch = async () => response({
    elevation: 100,
    hourly: {
      time: [new Date(referenceTimeMs).toISOString().slice(0, 13) + ':00'],
      temperature_2m: [22],
      dew_point_2m: [19],
      wind_speed_10m: [12],
      wind_direction_10m: [170],
      surface_pressure: [990],
      cape: [1000],
      convective_inhibition: [-20],
    },
  });
  await assert.rejects(
    () => fetchHrrrAdvancedEnvironment(40.3, -82.3, referenceTimeMs, incompleteFetch as typeof fetch),
    /profile incomplete/,
  );

  console.log('hrrrEnvironment.runtime.test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
