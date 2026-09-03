import { strict as assert } from 'node:assert';
import { resolveDailyMonitorLocation } from '../dailyMonitorLocationResolver';

async function run(): Promise<void> {
  const nowMs = Date.UTC(2026, 8, 3, 20, 0, 0);

  const current = await resolveDailyMonitorLocation({
    now: () => nowMs,
    wait: async () => undefined,
    getCurrentPosition: async () => ({
      coords: { latitude: 40.1599, longitude: -82.2384 },
      timestamp: nowMs - 1_000,
    }),
    getLastKnownPosition: async () => ({
      coords: { latitude: 40.15, longitude: -82.23 },
      timestamp: nowMs - 30_000,
    }),
    readCachedLocation: async () => ({
      latitude: 40.14,
      longitude: -82.22,
      timestampMs: nowMs - 60_000,
    }),
  });
  assert.equal(current.source, 'current');
  assert.equal(current.latitude, 40.1599);

  let releaseCurrent: (() => void) | null = null;
  const blockedCurrent = new Promise<null>((resolve) => {
    releaseCurrent = () => resolve(null);
  });
  const lastKnown = await resolveDailyMonitorLocation({
    now: () => nowMs,
    wait: async () => undefined,
    getCurrentPosition: () => blockedCurrent,
    getLastKnownPosition: async () => ({
      coords: { latitude: 40.16, longitude: -82.24 },
      timestamp: nowMs - 45_000,
    }),
    readCachedLocation: async () => null,
  }, { currentFixTimeoutMs: 1_000 });
  releaseCurrent?.();
  assert.equal(lastKnown.source, 'os_last_known');
  assert.equal(lastKnown.latitude, 40.16);

  const cached = await resolveDailyMonitorLocation({
    now: () => nowMs,
    wait: async () => undefined,
    getCurrentPosition: async () => null,
    getLastKnownPosition: async () => ({
      coords: { latitude: 40.2, longitude: -82.3 },
      timestamp: nowMs - 10 * 60_000,
    }),
    readCachedLocation: async () => ({
      latitude: 40.17,
      longitude: -82.25,
      timestampMs: nowMs - 2 * 60_000,
    }),
  });
  assert.equal(cached.source, 'stormlog_cached');
  assert.equal(cached.longitude, -82.25);

  await assert.rejects(
    () => resolveDailyMonitorLocation({
      now: () => nowMs,
      wait: async () => undefined,
      getCurrentPosition: async () => null,
      getLastKnownPosition: async () => ({
        coords: { latitude: 40.2, longitude: -82.3 },
        timestamp: nowMs - 10 * 60_000,
      }),
      readCachedLocation: async () => ({
        latitude: 40.17,
        longitude: -82.25,
        timestampMs: nowMs - 20 * 60_000,
      }),
    }),
    /No sufficiently fresh location available/,
  );

  await assert.rejects(
    () => resolveDailyMonitorLocation({
      now: () => nowMs,
      wait: async () => undefined,
      getCurrentPosition: async () => ({
        coords: { latitude: 999, longitude: -82.3 },
        timestamp: nowMs,
      }),
      getLastKnownPosition: async () => null,
      readCachedLocation: async () => null,
    }),
    /No sufficiently fresh location available/,
  );

  console.log('dailyMonitorLocationResolver.runtime.test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
