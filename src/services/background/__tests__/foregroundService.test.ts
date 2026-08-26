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

function fakeDependenciesWithForegroundService() {
  let executionCount = 0;
  const storage = new Map<string, string>();
  let timerId = 0;
  const timers = new Map<number, { atMs: number; callback: () => void }>();
  let activeRegistrationInterval: number | null = null;
  let fgServiceStartCalls: number[] = [];
  let fgServiceStopCalls = 0;
  let fgServiceRunning = false;

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
      clearTimeout: (id: unknown) => {
        timers.delete(id as number);
      },
    },
    background: {
      isRegistered: async () => activeRegistrationInterval != null,
      register: async (intervalMinutes) => {
        activeRegistrationInterval = intervalMinutes;
      },
      unregister: async () => {
        activeRegistrationInterval = null;
      },
    },
    foregroundService: {
      start: async (intervalMinutes) => {
        fgServiceStartCalls.push(intervalMinutes);
        fgServiceRunning = true;
        return { success: true };
      },
      stop: async () => {
        fgServiceStopCalls += 1;
        fgServiceRunning = false;
      },
      isRunning: async () => fgServiceRunning,
    },
  };

  return {
    deps,
    getState: () => ({
      executionCount,
      activeRegistrationInterval,
      fgServiceStartCalls: [...fgServiceStartCalls],
      fgServiceStopCalls,
      fgServiceRunning,
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
  // ── Foreground service delegation tests ──

  await test('startMonitor requests foreground service start with correct interval', async () => {
    const { deps, getState } = fakeDependenciesWithForegroundService();
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();
    await coordinator.startMonitor(15);

    const state = getState();
    assertEqual(state.fgServiceStartCalls.length, 1, 'foreground service start called once');
    assertEqual(state.fgServiceStartCalls[0], 15, 'foreground service started with 15 min interval');
    assertEqual(state.fgServiceRunning, true, 'foreground service running');
  });

  await test('stopMonitor requests foreground service stop', async () => {
    const { deps, getState } = fakeDependenciesWithForegroundService();
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();
    await coordinator.startMonitor(15);
    assertEqual(getState().fgServiceRunning, true, 'service running after start');

    await coordinator.stopMonitor();
    assertEqual(getState().fgServiceStopCalls, 1, 'foreground service stop called once');
    assertEqual(getState().fgServiceRunning, false, 'foreground service not running after stop');
  });

  await test('setIntervalMinutes restarts foreground service with new interval', async () => {
    const { deps, getState } = fakeDependenciesWithForegroundService();
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();
    await coordinator.startMonitor(15);
    assertEqual(getState().fgServiceStartCalls.length, 1, 'one start call');

    await coordinator.setIntervalMinutes(30);
    assertEqual(getState().fgServiceStartCalls.length, 2, 'two start calls after interval change');
    assertEqual(getState().fgServiceStartCalls[1], 30, 'second start with 30 min interval');
  });

  await test('initialize does NOT start foreground service', async () => {
    const { deps, getState } = fakeDependenciesWithForegroundService();
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();

    assertEqual(getState().fgServiceStartCalls.length, 0, 'no foreground service start on init');
    assertEqual(getState().fgServiceRunning, false, 'foreground service not running after init');
  });

  await test('foreground service adapter failure does not break startMonitor', async () => {
    const { deps, getState } = fakeDependenciesWithForegroundService();
    // Override foreground service start to fail
    deps.foregroundService = {
      start: async () => ({ success: false, error: 'Permission denied' }),
      stop: async () => {},
      isRunning: async () => false,
    };
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();
    // Should not throw
    await coordinator.startMonitor(15);
    assert(typeof getState().activeRegistrationInterval === 'number', 'background still registered');
  });

  await test('foreground service stop failure does not break stopMonitor', async () => {
    const { deps, getState } = fakeDependenciesWithForegroundService();
    deps.foregroundService = {
      start: async () => ({ success: true }),
      stop: async () => { throw new Error('stop failed'); },
      isRunning: async () => true,
    };
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();
    await coordinator.startMonitor(15);
    // Should not throw
    await coordinator.stopMonitor();
    assertEqual(getState().activeRegistrationInterval, null, 'background unregistered');
  });

  await test('missing foreground service adapter does not break startMonitor', async () => {
    const { deps, getState } = fakeDependenciesWithForegroundService();
    delete deps.foregroundService;
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();
    // Should not throw
    await coordinator.startMonitor(15);
    assert(typeof getState().activeRegistrationInterval === 'number', 'background registered');
  });

  // ── Collection convergence tests ──

  await test('foreground service callback reaches collectAutomatic via in-flight guard', async () => {
    let now = 1_000_000;
    const { deps, getState } = fakeDependenciesWithForegroundService();
    deps.now = () => now;
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();
    await coordinator.startMonitor(15);

    // Simulate what the foreground location task callback does
    const result = await coordinator.collectAutomatic();
    assertEqual(getState().executionCount, 1, 'collection executed via collectAutomatic');
    assertEqual(result.outcome, 'completed', 'collection completed');

    // Second call within interval is gated
    const result2 = await coordinator.collectAutomatic();
    assertEqual(getState().executionCount, 1, 'second call gated');
    assertEqual(result2.outcome, 'skipped_recent_automatic', 'skipped as recent');
  });

  await test('existing in-flight guard prevents duplicate from concurrent foreground service triggers', async () => {
    let now = 1_000_000;
    const { deps, getState } = fakeDependenciesWithForegroundService();
    deps.now = () => now;
    let execCount = 0;
    let resolveCollection: (() => void) | null = null;
    deps.runCollection = async () => {
      execCount += 1;
      await new Promise<void>((resolve) => { resolveCollection = resolve; });
      return { success: true, outcome: 'completed' };
    };

    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();
    await coordinator.startMonitor(15);

    // Start two concurrent automatic collections (simulating foreground service + background fetch)
    const p1 = coordinator.collectAutomatic();
    const p2 = coordinator.collectAutomatic();

    // Resolve the in-flight collection
    resolveCollection!();
    const [r1, r2] = await Promise.all([p1, p2]);

    assertEqual(execCount, 1, 'only one actual execution');
    assertEqual(r1.outcome, 'completed', 'first completed');
    assertEqual(r2.outcome, 'shared', 'second shared');
  });

  await test('manual collection still works alongside foreground service', async () => {
    const { deps, getState } = fakeDependenciesWithForegroundService();
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();
    await coordinator.startMonitor(15);

    await coordinator.collectManual();
    assertEqual(getState().executionCount, 1, 'manual collection ran');
    assertEqual(getState().fgServiceRunning, true, 'foreground service still running');
  });

  await test('foreground service does not create a second collection pipeline', async () => {
    const { deps, getState } = fakeDependenciesWithForegroundService();
    const coordinator = new DailyMonitorCoordinator(deps);
    coordinator.subscribe(() => undefined);
    await coordinator.initialize();
    await coordinator.startMonitor(15);

    // Verify only one runCollection path exists by checking execution count
    // matches the number of collectAutomatic/collectManual calls
    await coordinator.collectAutomatic();
    await coordinator.collectManual();
    await coordinator.collectAutomatic(); // gated
    assertEqual(getState().executionCount, 2, 'exactly two executions from two explicit calls');
  });

  // ── Summary ──

  console.log(`\nPhase 9 foreground service tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})();
