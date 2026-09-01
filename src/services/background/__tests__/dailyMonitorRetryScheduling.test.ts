import {
  DailyMonitorCoordinator,
  type DailyMonitorCoordinatorDependencies,
} from '../dailyMonitorCoordinator';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  let now = 1_000_000;
  const storage = new Map<string, string>();
  const timers: Array<{ delayMs: number; callback: () => void }> = [];
  let executions = 0;
  let failOnce = true;

  const deps: DailyMonitorCoordinatorDependencies = {
    now: () => now,
    storage: {
      getItem: async (key) => storage.get(key) ?? null,
      setItem: async (key, value) => { storage.set(key, value); },
      removeItem: async (key) => { storage.delete(key); },
    },
    scheduler: {
      setTimeout: (callback, delayMs) => {
        timers.push({ callback, delayMs });
        return timers.length;
      },
      clearTimeout: () => undefined,
    },
    background: {
      isRegistered: async () => true,
      register: async () => undefined,
      unregister: async () => undefined,
    },
    runCollection: async () => {
      executions += 1;
      if (failOnce) {
        failOnce = false;
        return { success: false, error: 'HTTP 500' };
      }
      return { success: true, outcome: 'completed' };
    },
  };

  const coordinator = new DailyMonitorCoordinator(deps);
  await coordinator.initialize();
  await coordinator.startMonitor(15);

  // First scheduled attempt fails. The next timer must respect the 60-second
  // retry boundary rather than entering a tight 1-second loop.
  timers.shift()!.callback();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const executionsAfterFirstAttempt = executions;
  assert(executionsAfterFirstAttempt === 1, 'first scheduled attempt should execute once');
  assert(timers.length === 1, 'exactly one retry timer should remain');
  assert(timers[0].delayMs >= 60_000, `retry timer too early: ${timers[0].delayMs}ms`);

  // After the retry cooldown, the failed attempt is retried and succeeds.
  now += 61_000;
  timers.shift()!.callback();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const executionsAfterRetry = executions;
  assert(executionsAfterRetry === 2, 'retry should execute once after cooldown');

  console.log('PASS: failed automatic collection schedules bounded retry without timer spin');
}

void main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
