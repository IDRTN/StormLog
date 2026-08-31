import { DailyMonitorCoordinator, type DailyMonitorCoordinatorDependencies } from '../dailyMonitorCoordinator';

function createDeps() {
  const storage = new Map<string, string>();
  let executionCount = 0;
  let now = 1_000_000;

  const deps: DailyMonitorCoordinatorDependencies = {
    now: () => now,
    getNextDelayMs: (intervalMinutes) => now + intervalMinutes * 60_000,
    runCollection: async () => {
      executionCount += 1;
      return { success: true, outcome: 'completed' as const };
    },
    storage: {
      getItem: async (key) => storage.get(key) ?? null,
      setItem: async (key, value) => { storage.set(key, value); },
      removeItem: async (key) => { storage.delete(key); },
    },
    scheduler: {
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    },
    background: {
      isRegistered: async () => false,
      register: async () => undefined,
      unregister: async () => undefined,
    },
    foregroundService: {
      start: async () => ({ success: true }),
      stop: async () => undefined,
      isRunning: async () => false,
    },
  };

  return { deps, storage, getExecutionCount: () => executionCount, setNow: (value: number) => { now = value; } };
}

let passed = 0;
let failed = 0;

async function test(name: string, task: () => Promise<void>) {
  try {
    await task();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL: ${name}`);
    console.log(error instanceof Error ? error.message : String(error));
  }
}

void (async () => {
  await test('headless automatic collection hydrates persisted state before gating', async () => {
    const { deps, storage, getExecutionCount, setNow } = createDeps();
    storage.set('daily_monitor_enabled', 'true');
    storage.set('daily_monitor_interval', '15');
    storage.set('daily_monitor_last_automatic_attempt', '1');

    const coordinator = new DailyMonitorCoordinator(deps);
    setNow(20 * 60_000);

    const result = await coordinator.collectAutomatic();

    if (!result.success) throw new Error('headless collection should succeed');
    if (getExecutionCount() !== 1) throw new Error(`expected one collection, got ${getExecutionCount()}`);
    if (coordinator.getState().isActive !== true) throw new Error('persisted active state was not restored');
    if (coordinator.getState().intervalMinutes !== 15) throw new Error('persisted interval was not restored');
  });

  await test('concurrent headless initialization calls share one initialization', async () => {
    const { deps, storage } = createDeps();
    storage.set('daily_monitor_enabled', 'true');
    storage.set('daily_monitor_interval', '15');

    let registrationChecks = 0;
    deps.background.isRegistered = async () => {
      registrationChecks += 1;
      await Promise.resolve();
      return false;
    };

    const coordinator = new DailyMonitorCoordinator(deps);
    await Promise.all([
      coordinator.initialize(),
      coordinator.collectAutomatic(),
      coordinator.initialize(),
    ]);

    if (registrationChecks !== 1) throw new Error(`expected one initialization registration check, got ${registrationChecks}`);
    if (coordinator.getState().loading) throw new Error('coordinator remained loading');
  });

  console.log(`Headless initialization tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} headless initialization test(s) failed`);
})();
