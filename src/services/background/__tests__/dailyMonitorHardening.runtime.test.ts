import {
  DailyMonitorCoordinator,
  type DailyCollectionResult,
  type DailyMonitorCoordinatorDependencies,
} from '../dailyMonitorCoordinator';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  assert(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

function makeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    adapter: {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => { values.set(key, value); },
      removeItem: async (key: string) => { values.delete(key); },
    },
  };
}

void (async () => {
  await test('production runtime has one native clock and zero JS timers', async () => {
    const storage = makeStorage({
      daily_monitor_enabled: 'true',
      daily_monitor_interval: '15',
    });
    let running = false;
    let serviceStarts = 0;
    let timerStarts = 0;
    let registered = true;
    let backgroundRegisters = 0;

    const deps: DailyMonitorCoordinatorDependencies = {
      runCollection: async () => ({ success: true }),
      storage: storage.adapter,
      scheduler: {
        setTimeout: () => { timerStarts += 1; return timerStarts; },
        clearTimeout: () => undefined,
      },
      background: {
        isRegistered: async () => registered,
        register: async () => { registered = true; backgroundRegisters += 1; },
        unregister: async () => { registered = false; },
      },
      foregroundService: {
        isRunning: async () => running,
        start: async () => { running = true; serviceStarts += 1; return { success: true }; },
        stop: async () => { running = false; },
      },
    };

    const coordinator = new DailyMonitorCoordinator(deps);
    await coordinator.initialize();
    await coordinator.initialize();
    await coordinator.initialize();

    assertEqual(serviceStarts, 1, 'native foreground scheduler starts once');
    assertEqual(timerStarts, 0, 'production Android does not create a competing JS timer');
    assertEqual(backgroundRegisters, 0, 'existing watchdog registration is reused');
  });

  await test('repeated Start Monitor calls do not duplicate initial observations', async () => {
    const storage = makeStorage();
    let running = false;
    let collectionCount = 0;
    let registered = false;

    const deps: DailyMonitorCoordinatorDependencies = {
      runCollection: async () => { collectionCount += 1; return { success: true }; },
      storage: storage.adapter,
      scheduler: { setTimeout: () => 1, clearTimeout: () => undefined },
      background: {
        isRegistered: async () => registered,
        register: async () => { registered = true; },
        unregister: async () => { registered = false; },
      },
      foregroundService: {
        isRunning: async () => running,
        start: async () => { running = true; return { success: true }; },
        stop: async () => { running = false; },
      },
    };

    const coordinator = new DailyMonitorCoordinator(deps);
    await coordinator.startMonitor(15);
    await coordinator.startMonitor(15);
    await coordinator.startMonitor(15);
    assertEqual(collectionCount, 1, 'only the first explicit start creates the immediate observation');
  });

  await test('failed automatic attempt is retryable without waiting a full interval', async () => {
    const storage = makeStorage({
      daily_monitor_enabled: 'true',
      daily_monitor_interval: '15',
    });
    let runCount = 0;
    let now = 1_000_000;
    const deps: DailyMonitorCoordinatorDependencies = {
      now: () => now,
      runCollection: async (): Promise<DailyCollectionResult> => {
        runCount += 1;
        return runCount === 1 ? { success: false, error: 'temporary network failure' } : { success: true };
      },
      storage: storage.adapter,
      scheduler: { setTimeout: () => 1, clearTimeout: () => undefined },
      background: {
        isRegistered: async () => true,
        register: async () => undefined,
        unregister: async () => undefined,
      },
      claimAutomatic: async () => true,
    };

    const coordinator = new DailyMonitorCoordinator(deps);
    await coordinator.initialize();
    const first = await coordinator.collectAutomatic();
    now += 30_000;
    const second = await coordinator.collectAutomatic();

    assertEqual(first.success, false, 'first automatic attempt fails');
    assertEqual(second.success, true, 'second automatic attempt retries and succeeds');
    assertEqual(runCount, 2, 'failed attempt did not consume the 15 minute interval');
  });

  await test('simultaneous automatic triggers share one in-flight pipeline', async () => {
    const storage = makeStorage({
      daily_monitor_enabled: 'true',
      daily_monitor_interval: '15',
    });
    let runCount = 0;
    let resolveRun: ((result: DailyCollectionResult) => void) | null = null;

    const deps: DailyMonitorCoordinatorDependencies = {
      runCollection: () => {
        runCount += 1;
        return new Promise<DailyCollectionResult>((resolve) => { resolveRun = resolve; });
      },
      storage: storage.adapter,
      scheduler: { setTimeout: () => 1, clearTimeout: () => undefined },
      background: {
        isRegistered: async () => true,
        register: async () => undefined,
        unregister: async () => undefined,
      },
      claimAutomatic: async () => true,
    };

    const coordinator = new DailyMonitorCoordinator(deps);
    await coordinator.initialize();
    const first = coordinator.collectAutomatic();
    const second = coordinator.collectAutomatic();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEqual(runCount, 1, 'only one pipeline starts');
    assert(resolveRun != null, 'pipeline resolver exists');
    (resolveRun as (result: DailyCollectionResult) => void)({ success: true });
    const results = await Promise.all([first, second]);
    assertEqual(results[0].outcome, 'completed', 'owner completes');
    assertEqual(results[1].outcome, 'shared', 'racing trigger shares owner result');
  });

  console.log('Daily Monitor hardening runtime tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
