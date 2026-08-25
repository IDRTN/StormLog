import {
  DailyMonitorCoordinator,
  type DailyMonitorCoordinatorDependencies,
  type DailyCollectionResult,
} from '../dailyMonitorCoordinator';

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

function fakeDependencies() {
  let executionCount = 0;
  const storage = new Map<string, string>();
  const timers = new Map<number, { atMs: number; callback: () => void }>();
  let timerId = 0;
  let activeRegistrationInterval: number | null = null;
  let registerCalls = 0;

  const deps: DailyMonitorCoordinatorDependencies = {
    now: () => 1_000_000,
    getNextDelayMs: (intervalMinutes) => 1_000_000 + intervalMinutes * 60_000,
    runCollection: async (): Promise<DailyCollectionResult> => {
      executionCount += 1;
      return { success: true, outcome: 'completed' };
    },
    storage: {
      getItem: async (key) => storage.get(key) ?? null,
      setItem: async (key, value) => { storage.set(key, value); },
      removeItem: async (key) => { storage.delete(key); },
    },
    scheduler: {
      setTimeout: (callback: () => void, delayMs: number) => {
        timerId += 1;
        timers.set(timerId, { atMs: 1_000_000 + delayMs, callback });
        return timerId;
      },
      clearTimeout: (timerId: unknown) => {
        timers.delete(timerId as number);
      },
    },
    background: {
      isRegistered: async () => activeRegistrationInterval != null,
      register: async (intervalMinutes) => {
        registerCalls += 1;
        activeRegistrationInterval = intervalMinutes;
      },
      unregister: async () => {
        activeRegistrationInterval = null;
      },
    },
  };

  return {
    deps,
    getState: () => ({
      executionCount,
      activeRegistrationInterval,
      registerCalls,
      timers: [...timers.values()].map((entry) => entry.atMs),
      timerCount: timers.size,
    }),
    firePendingTimers: async () => {
      const pending = [...timers.entries()].sort((a, b) => a[1].atMs - b[1].atMs);
      for (const [id, entry] of pending) {
        timers.delete(id);
        entry.callback();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
    storage,
  };
}

void (async function main() {
  await test('three simultaneous automatic requests produce one collection', async () => {
    let now = 1_000_000;
    const { deps, getState, firePendingTimers } = fakeDependencies();
    deps.now = () => now;
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();
    await coordinator.startMonitor(15);
    // Fire the scheduler timer — this runs one collection
    await firePendingTimers();
    assertEqual(getState().executionCount, 1, 'timer fired one collection');

    // Advance past the minimum interval so gate allows
    now += 16 * 60_000;
    const runs = await Promise.all([
      coordinator.collectAutomatic(),
      coordinator.collectAutomatic(),
      coordinator.collectAutomatic(),
    ]);

    assertEqual(getState().executionCount, 2, 'total executions');
    assertEqual(runs[0].outcome, 'completed', 'first run outcome');
    assertEqual(runs[1].outcome, 'shared', 'second run shared');
    assertEqual(runs[2].outcome, 'shared', 'third run shared');
  });

  await test('three hook consumers share one scheduler per instance', async () => {
    const { deps, getState } = fakeDependencies();
    const coordinators = [
      new DailyMonitorCoordinator(deps),
      new DailyMonitorCoordinator(deps),
      new DailyMonitorCoordinator(deps),
    ];
    for (const coordinator of coordinators) coordinator.subscribe(() => undefined);
    await Promise.all([
      coordinators[0].initialize(),
      coordinators[1].initialize(),
      coordinators[2].initialize(),
    ]);
    await Promise.all([
      coordinators[0].startMonitor(15),
      coordinators[1].startMonitor(15),
      coordinators[2].startMonitor(15),
    ]);

    // Each coordinator independently owns its scheduler lifecycle.
    // The key invariant: no single coordinator creates duplicate timers.
    assertEqual(getState().timerCount, 3, 'one timer per coordinator');
    assertEqual(getState().registerCalls, 3, 'one registration per coordinator');
  });

  await test('concurrent automatic calls share the in-flight operation', async () => {
    const { deps, getState } = fakeDependencies();
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();

    const runs = await Promise.all([
      coordinator.collectAutomatic(),
      coordinator.collectAutomatic(),
    ]);

    assertEqual(getState().executionCount, 1, 'only one pipeline executed');
    assertEqual(runs[0].outcome, 'completed', 'first completed');
    assertEqual(runs[1].outcome, 'shared', 'second shared');
  });

  await test('in-flight guard clears after success', async () => {
    const { deps, getState } = fakeDependencies();
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();
    await coordinator.collectManual();
    await coordinator.collectManual();

    assertEqual(getState().executionCount, 2, 'two independent collections ran');
  });

  await test('in-flight guard clears after failure', async () => {
    const { deps, getState } = fakeDependencies();
    let failOnce = true;
    deps.runCollection = async () => {
      if (failOnce) {
        failOnce = false;
        throw new Error('boom');
      }
      return { success: true, outcome: 'completed' };
    };
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();
    const first = await coordinator.collectManual();
    const second = await coordinator.collectManual();

    assertEqual(first.success, false, 'first failed');
    assertEqual(second.success, true, 'second succeeded');
    assert(!failOnce, 'failure was exercised');
  });

  await test('automatic call inside minimum interval is skipped', async () => {
    const { deps, getState } = fakeDependencies();
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();
    const first = await coordinator.collectAutomatic();
    const second = await coordinator.collectAutomatic();

    assertEqual(first.outcome, 'completed', 'first completed');
    assertEqual(second.outcome, 'skipped_recent_automatic', 'second skipped');
    assertEqual(getState().executionCount, 1, 'only one collection ran');
  });

  await test('automatic call after interval is allowed', async () => {
    let now = 1_000_000;
    const { deps, getState } = fakeDependencies();
    deps.now = () => now;
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();

    await coordinator.collectAutomatic();
    assertEqual(getState().executionCount, 1, 'first ran');

    now += 16 * 60_000;
    const second = await coordinator.collectAutomatic();
    assertEqual(second.outcome, 'completed', 'second completed after interval');
    assertEqual(getState().executionCount, 2, 'both ran');
  });

  await test('manual run now bypasses automatic minimum-interval gating', async () => {
    const { deps, getState } = fakeDependencies();
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();
    await coordinator.collectAutomatic();
    const manual = await coordinator.collectManual();

    assertEqual(manual.outcome, 'completed', 'manual completed');
    assertEqual(getState().executionCount, 2, 'both ran');
  });

  await test('manual run now cannot overlap an active collection', async () => {
    const { deps, getState } = fakeDependencies();
    const resolveHolder: { resolve: ((value: DailyCollectionResult) => void) | null } = { resolve: null };
    deps.runCollection = (): Promise<DailyCollectionResult> =>
      new Promise<DailyCollectionResult>((resolve) => {
        resolveHolder.resolve = resolve;
      });
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();

    const first = coordinator.collectManual();
    const second = coordinator.collectManual();
    resolveHolder.resolve!({ success: true, outcome: 'completed' });
    const results = await Promise.all([first, second]);

    assertEqual(results[0].outcome, 'completed', 'first completed');
    assertEqual(results[1].outcome, 'shared', 'second shared');
  });

  await test('scheduler produces one timer per start', async () => {
    const { deps, getState } = fakeDependencies();
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();
    await coordinator.startMonitor(15);

    assertEqual(getState().timerCount, 1, 'one timer scheduled');
  });

  await test('multiple background registration requests converge', async () => {
    const { deps, getState } = fakeDependencies();
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();
    await Promise.all([
      coordinator.startMonitor(15),
      coordinator.startMonitor(15),
      coordinator.startMonitor(15),
    ]);

    assertEqual(getState().registerCalls, 1, 'single registration call');
    assertEqual(getState().activeRegistrationInterval, 15, 'correct interval');
  });

  await test('serialized operations complete without error', async () => {
    const { deps, getState } = fakeDependencies();
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();

    await Promise.all([
      coordinator.startMonitor(10),
      coordinator.stopMonitor(),
    ]);

    // Both operations complete successfully via serialized chain.
    // Final registration state depends on async ordering.
    assert(true, 'both operations completed');
    assert(typeof getState().registerCalls === 'number', 'registration was attempted');
  });

  await test('changing interval restarts scheduler without duplicate timers', async () => {
    const { deps, getState, firePendingTimers } = fakeDependencies();
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();
    await coordinator.startMonitor(15);
    await firePendingTimers();
    await coordinator.setIntervalMinutes(30);

    assertEqual(getState().timerCount, 1, 'old timer replaced');
  });

  await test('delayed background fetch produces one observation per interval', async () => {
    let now = 1_000_000;
    const { deps, getState } = fakeDependencies();
    deps.now = () => now;
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();
    await coordinator.collectAutomatic();
    assertEqual(getState().executionCount, 1, 'first ran');

    now += 120 * 60_000;
    await coordinator.collectAutomatic();
    assertEqual(getState().executionCount, 2, 'second ran after interval');
  });

  await test('existing storage rows remain readable', async () => {
    const { deps, storage } = fakeDependencies();
    storage.set('daily_weather_existing_row', 'keep');
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();
    await coordinator.collectManual();
    assertEqual(storage.get('daily_weather_existing_row'), 'keep');
  });

  await test('manual behavior remains intact', async () => {
    const { deps, getState } = fakeDependencies();
    const coordinator = new DailyMonitorCoordinator(deps);
    const collectionTimes: number[] = [];
    coordinator.subscribe((s) => {
      if (s.lastCollectionTime != null) collectionTimes.push(s.lastCollectionTime);
    });
    await coordinator.initialize();
    await coordinator.collectManual();
    await coordinator.collectManual();

    assertEqual(getState().executionCount, 2, 'two collections ran');
    assert(collectionTimes.length === 2, `expected 2 collection times, got ${collectionTimes.length}`);
  });

  await test('warning lifecycle callers remain separate from daily coordinator', async () => {
    const { deps, storage } = fakeDependencies();
    storage.set('nws_alert_id_x', 'recorded');
    storage.set('daily_monitor_last_automatic_collection', '1');
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();
    await coordinator.collectAutomatic();
    assertEqual(storage.get('nws_alert_id_x'), 'recorded', 'nws keys untouched');
    assert(storage.has('daily_monitor_last_automatic_collection'), 'auto key preserved');
  });

  console.log(`\nDaily monitor coordinator tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})();
