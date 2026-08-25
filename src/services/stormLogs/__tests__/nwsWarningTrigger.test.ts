import type { NormalizedNwsAlert } from '../../nws/alerts';
import type { StormLogDatabase } from '../../../database/warningEvents';
import { processNwsWarningForStormEvent, type ProcessNwsWarningResult } from '../processNwsWarning';
import {
  processNwsAlertsForStormEvents,
  withNwsAlertProcessingFailures,
} from '../nwsWarningTrigger';

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

function alert(id: string): NormalizedNwsAlert {
  return {
    id,
    event: 'Tornado Warning',
    headline: null,
    severity: 'Extreme',
    urgency: 'Immediate',
    onset: null,
    expires: null,
    areaDesc: null,
    representativePoint: { latitude: 40, longitude: -82 },
  };
}

async function main() {
  await test('refresh batch invokes processor once per retrieved alert', async () => {
    const processedIds: string[] = [];
    const result = await processNwsAlertsForStormEvents(
      [alert('alert-one'), alert('alert-two')],
      async (received) => {
        processedIds.push(received.id);
        return { outcome: 'created', eventId: processedIds.length, processedWarningId: processedIds.length };
      }
    );

    assertEqual(processedIds.join(','), 'alert-one,alert-two');
    assertEqual(result.failures.length, 0);
    assertEqual(result.results.length, 2);
  });

  await test('ineligible warnings reach Phase 2 without creating events', async () => {
    const insertedEvents: unknown[] = [];
    const database = {
      runAsync: async (sql: string) => {
        if (sql.includes('INSERT INTO storm_events')) {
          insertedEvents.push(sql);
          return { changes: 1, lastInsertRowId: 1 };
        }
        throw new Error(`unexpected SQL: ${sql}`);
      },
      getFirstAsync: async () => null,
      getAllAsync: async () => [],
      withTransactionAsync: async (task: () => Promise<void>) => task(),
    } as unknown as StormLogDatabase;
    const ineligible = { ...alert('heat-alert'), event: 'Extreme Heat Warning' };

    const result = await processNwsWarningForStormEvent(ineligible, database);

    assertEqual(result.outcome, 'skipped_ineligible_alert');
    assertEqual(insertedEvents.length, 0);
  });

  await test('repeated alert identity remains protected across batches', async () => {
    const processedIds: string[] = [];
    const processor = async (received: NormalizedNwsAlert): Promise<ProcessNwsWarningResult> => {
      processedIds.push(received.id);
      return processedIds.length === 1
        ? { outcome: 'created', eventId: 101, processedWarningId: 201 }
        : { outcome: 'skipped_duplicate_alert' };
    };

    const first = await processNwsAlertsForStormEvents([alert('same-alert')], processor);
    const second = await processNwsAlertsForStormEvents([alert('same-alert')], processor);

    assertEqual(first.results[0]?.result.outcome, 'created');
    assertEqual(second.results[0]?.result.outcome, 'skipped_duplicate_alert');
  });

  await test('one failing alert does not prevent independent processing', async () => {
    const processor = async (received: NormalizedNwsAlert): Promise<ProcessNwsWarningResult> => {
      if (received.id === 'alert-fails') throw new Error('database unavailable');
      return { outcome: 'created', eventId: 102, processedWarningId: 202 };
    };

    const result = await processNwsAlertsForStormEvents(
      [alert('alert-fails'), alert('alert-succeeds')],
      processor
    );

    assertEqual(result.results.length, 1);
    assertEqual(result.results[0]?.alertId, 'alert-succeeds');
    assertEqual(result.failures.length, 1);
    assertEqual(result.failures[0]?.alertId, 'alert-fails');
  });

  await test('processing failures preserve underlying error information', async () => {
    const original = new Error('transaction rolled back');
    const result = await processNwsAlertsForStormEvents(
      [alert('alert-error')],
      async () => {
        throw original;
      }
    );

    assertEqual(result.failures[0]?.error, original);
    const collection = withNwsAlertProcessingFailures(
      { success: true },
      result.failures
    );
    assertEqual(collection.success, false);
    assert(collection.error?.includes('transaction rolled back') === true, 'error detail missing');
  });

  await test('successful refresh remains successful without failures', () => {
    const result = withNwsAlertProcessingFailures({ success: true }, []);
    assertEqual(result.success, true);
    assertEqual(result.error, undefined);
  });

  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main();
