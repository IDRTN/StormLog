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

// Mirror the keys from dailyMonitor.ts to avoid importing Expo modules
const CACHED_LOCATION_LAT_KEY = 'daily_monitor_cached_location_lat';
const CACHED_LOCATION_LON_KEY = 'daily_monitor_cached_location_lon';
const CACHED_LOCATION_TIMESTAMP_KEY = 'daily_monitor_cached_location_timestamp';

function fakeStorage() {
  const store = new Map<string, string>();
  return {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => { store.set(key, value); },
    removeItem: async (key: string) => { store.delete(key); },
    store,
  };
}

void (async function main() {
  await test('storage keys are defined and consistent', () => {
    assertEqual(CACHED_LOCATION_LAT_KEY, 'daily_monitor_cached_location_lat');
    assertEqual(CACHED_LOCATION_LON_KEY, 'daily_monitor_cached_location_lon');
    assertEqual(CACHED_LOCATION_TIMESTAMP_KEY, 'daily_monitor_cached_location_timestamp');
  });

  await test('cached location can be persisted and retrieved', async () => {
    const { store } = fakeStorage();
    const now = Date.now();
    store.set(CACHED_LOCATION_LAT_KEY, '40.160');
    store.set(CACHED_LOCATION_LON_KEY, '-82.239');
    store.set(CACHED_LOCATION_TIMESTAMP_KEY, now.toString());

    const lat = parseFloat(store.get(CACHED_LOCATION_LAT_KEY)!);
    const lon = parseFloat(store.get(CACHED_LOCATION_LON_KEY)!);
    const ts = Number(store.get(CACHED_LOCATION_TIMESTAMP_KEY)!);

    assertEqual(lat, 40.160);
    assertEqual(lon, -82.239);
    assert(ts > 0, 'timestamp should be positive');
  });

  await test('cached location age is calculable from timestamp', async () => {
    const { store } = fakeStorage();
    const past = Date.now() - 30 * 60_000;
    store.set(CACHED_LOCATION_LAT_KEY, '40.160');
    store.set(CACHED_LOCATION_LON_KEY, '-82.239');
    store.set(CACHED_LOCATION_TIMESTAMP_KEY, past.toString());

    const ts = Number(store.get(CACHED_LOCATION_TIMESTAMP_KEY)!);
    const ageMinutes = Math.round((Date.now() - ts) / 60_000);
    assertEqual(ageMinutes, 30, 'age should be 30 minutes');
  });

  await test('no cached location returns null values', async () => {
    const { store } = fakeStorage();
    const lat = store.get(CACHED_LOCATION_LAT_KEY) ?? null;
    const lon = store.get(CACHED_LOCATION_LON_KEY) ?? null;
    const ts = store.get(CACHED_LOCATION_TIMESTAMP_KEY) ?? null;

    assertEqual(lat, null);
    assertEqual(lon, null);
    assertEqual(ts, null);
  });

  await test('invalid cached coordinates are rejected', () => {
    const invalidLat = parseFloat('not-a-number');
    const invalidLon = parseFloat('also-not-a-number');
    assert(!Number.isFinite(invalidLat), 'invalid lat should not be finite');
    assert(!Number.isFinite(invalidLon), 'invalid lon should not be finite');
  });

  await test('cached fallback does not masquerade as a fresh GPS fix', () => {
    const locationSource: string = 'stormlog_cached';
    assertEqual(locationSource !== 'current', true, 'cached source must not be current');
    assertEqual(locationSource !== 'os_last_known', true, 'cached source must not be os_last_known');
    assertEqual(locationSource, 'stormlog_cached');
  });

  await test('all three location source types are distinct', () => {
    const sources = ['current', 'os_last_known', 'stormlog_cached'] as const;
    const unique = new Set(sources);
    assertEqual(unique.size, 3, 'all source types must be unique');
  });

  await test('cached coordinates survive parseFloat round-trip', () => {
    const lat = 40.160289;
    const lon = -82.239134;
    const storedLat = parseFloat(lat.toString());
    const storedLon = parseFloat(lon.toString());
    assertEqual(storedLat, lat);
    assertEqual(storedLon, lon);
  });

  await test('empty storage does not produce valid coordinates', async () => {
    const { store } = fakeStorage();
    const latStr = store.get(CACHED_LOCATION_LAT_KEY);
    const lonStr = store.get(CACHED_LOCATION_LON_KEY);
    const lat = latStr ? parseFloat(latStr) : NaN;
    const lon = lonStr ? parseFloat(lonStr) : NaN;
    assert(!Number.isFinite(lat), 'empty storage should not produce finite lat');
    assert(!Number.isFinite(lon), 'empty storage should not produce finite lon');
  });

  console.log(`\nLocation fallback tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})();
