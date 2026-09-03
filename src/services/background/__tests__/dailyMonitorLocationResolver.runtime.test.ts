import { resolveDailyMonitorLocation } from '../dailyMonitorLocationResolver';

function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(message ?? `Expected ${String(expected)}, received ${String(actual)}`);
  }
}

async function assertRejects(
  operation: () => Promise<unknown>,
  expected: RegExp,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!expected.test(message)) {
      throw new Error(`Expected rejection matching ${expected}, received: ${message}`);
    }
    return;
  }
  throw new Error(`Expected rejection matching ${expected}, but operation resolved`);
}

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
  assertEqual(current.source, 'current');
  assertEqual(current.latitude, 40.1599);

  const blockedCurrent = new Promise<null>(() => undefined);
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
  assertEqual(lastKnown.source, 'os_last_known');
  assertEqual(lastKnown.latitude, 40.16);

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
  assertEqual(cached.source, 'stormlog_cached');
  assertEqual(cached.longitude, -82.25);

  await assertRejects(
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

  await assertRejects(
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
  throw error;
});
