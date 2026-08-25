import { expireDueAutomaticWarnings } from '../../../database/warningEvents';
import type { NormalizedNwsAlert } from '../../nws/alerts';
import type { StormLogDatabase } from '../../../database/warningEvents';
import {
  dispatchWarningNotification,
  type WarningNotificationDispatch,
  type WarningNotifier,
} from '../warningNotificationDecision';
import { processNwsAlertsForStormEvents } from '../nwsWarningTrigger';
import { processNwsWarningForStormEvent } from '../processNwsWarning';
import { warningNotificationText } from '../warningNotificationContent';

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

function alert(id = 'alert-001', event = 'Tornado Warning'): NormalizedNwsAlert {
  return {
    id,
    event,
    headline: 'Warning headline',
    severity: event === 'Flash Flood Warning' ? 'Severe' : 'Extreme',
    urgency: 'Immediate',
    onset: null,
    expires: null,
    areaDesc: 'Test County',
    representativePoint: { latitude: 40, longitude: -82 },
    status: 'Actual',
    messageType: 'Alert',
    ends: 1800000000000,
    references: [],
  };
}

function created(eventId = 101) {
  return { outcome: 'created' as const, eventId, processedWarningId: 201 };
}

function notifier() {
  const calls: Record<'created' | 'updated' | 'canceled', unknown> = {
    created: null,
    updated: null,
    canceled: null,
  };
  const record = (method: 'created' | 'updated' | 'canceled', input: unknown) => {
    calls[method] = input;
  };

  return {
    calls,
    count: () => Object.values(calls).filter(value => value != null).length,
    implementation: {
      created: async (input: Parameters<WarningNotifier['created']>[0]) => record('created', input),
      updated: async (input: Parameters<WarningNotifier['updated']>[0]) => record('updated', input),
      canceled: async (input: Parameters<WarningNotifier['canceled']>[0]) => record('canceled', input),
    } satisfies WarningNotifier,
  };
}

async function main() {
  await test('new Tornado Warning generates one creation notification', async () => {
    const fake = notifier();
    const result = await dispatchWarningNotification(alert(), created(), fake.implementation);

    assertEqual(result.status, 'sent');
    assertEqual(fake.count(), 1);
    assert(fake.calls.created != null, 'creation notification was expected');
  });

  await test('new Severe Thunderstorm Warning generates a creation notification', async () => {
    const fake = notifier();
    const warning = alert('alert-svr', 'Severe Thunderstorm Warning');
    const result = await dispatchWarningNotification(warning, created(102), fake.implementation);

    assertEqual(result.action, 'created');
    assertEqual(fake.calls.updated != null, false);
    assertEqual((fake.calls.created as { eventType: string }).eventType, warning.event);
  });

  await test('new Flash Flood Warning generates a creation notification', async () => {
    const fake = notifier();
    const warning = alert('alert-ffw', 'Flash Flood Warning');
    const result = await dispatchWarningNotification(warning, created(103), fake.implementation);

    assertEqual(result.notified, true);
    assertEqual((fake.calls.created as { eventType: string }).eventType, warning.event);
  });

  await test('duplicate alert does not generate another notification', async () => {
    const fake = notifier();
    const result = await dispatchWarningNotification(
      alert(),
      { outcome: 'skipped_duplicate_alert' },
      fake.implementation
    );

    assertEqual(result.notified, false);
    assertEqual(fake.count(), 0);
  });

  await test('meaningful update generates an update notification', async () => {
    const fake = notifier();
    const update = { ...alert('alert-update-2'), messageType: 'UPDATE', ends: 1800003600000 };
    const result = await dispatchWarningNotification(
      update,
      { outcome: 'updated_event', eventId: 101, processedWarningId: 202 },
      fake.implementation
    );

    assertEqual(result.action, 'updated_event');
    assertEqual(fake.calls.updated != null, true);
  });

  await test('identical repeated update does not notify again', async () => {
    const fake = notifier();
    const repeatedUpdate = { ...alert('alert-update-2'), messageType: 'UPDATE' };

    await dispatchWarningNotification(
      repeatedUpdate,
      { outcome: 'updated_event', eventId: 101, processedWarningId: 202 },
      fake.implementation
    );
    const result = await dispatchWarningNotification(
      repeatedUpdate,
      { outcome: 'skipped_duplicate_alert' },
      fake.implementation
    );

    assertEqual(fake.count(), 1);
    assertEqual(result.reason, 'skipped_duplicate_alert');
  });

  await test('successful cancellation generates a cancellation notification', async () => {
    const fake = notifier();
    const cancellation = { ...alert('alert-cancel'), messageType: 'CANCEL' };
    const result = await dispatchWarningNotification(
      cancellation,
      { outcome: 'canceled_event', eventId: 101, processedWarningId: 203 },
      fake.implementation
    );

    assertEqual(result.action, 'canceled_event');
    assert(fake.calls.canceled != null, 'cancellation notification was expected');
  });

  await test('expiration reconciliation has no notification boundary', async () => {
    const fake = notifier();
    const database = {
      runAsync: async () => ({ changes: 1, lastInsertRowId: 0 }),
      getFirstAsync: async () => null,
      getAllAsync: async () => [{ id: 101 }],
      withTransactionAsync: async (task: () => Promise<void>) => task(),
    } as unknown as StormLogDatabase;

    const expiredCount = await expireDueAutomaticWarnings(1800000000000, database);
    const delivery = await dispatchWarningNotification(
      alert(),
      { outcome: 'skipped_duplicate_alert' },
      fake.implementation
    );

    assertEqual(expiredCount, 1);
    assertEqual(delivery.notified, false);
    assertEqual(fake.count(), 0);
  });

  await test('denied notification permission leaves warning processing successful', async () => {
    let databaseWrites = 0;
    const deniedNotifier: WarningNotifier = {
      created: async () => {
        throw Object.assign(new Error('permission denied'), { name: 'PermissionDenied' });
      },
      updated: async () => undefined,
      canceled: async () => undefined,
    };

    const batch = await processNwsAlertsForStormEvents([alert()], async () => {
      databaseWrites++;
      return created(104);
    }, { notifyWarning: async (warning, result) => dispatchWarningNotification(warning, result, deniedNotifier) });

    assertEqual(databaseWrites, 1);
    assertEqual(batch.results[0]?.result.outcome, 'created');
    assertEqual(batch.failures.length, 0);
  });

  await test('notification API failure leaves Storm Event created', async () => {
    const failingNotifier: WarningNotifier = {
      created: async () => {
        throw new Error('Android notification service unavailable');
      },
      updated: async () => undefined,
      canceled: async () => undefined,
    };

    const batch = await processNwsAlertsForStormEvents(
      [alert()],
      async () => created(105),
      { notifyWarning: async (warning, result) => dispatchWarningNotification(warning, result, failingNotifier) }
    );
    const notification = batch.results[0]?.notification as WarningNotificationDispatch;

    assertEqual(batch.results[0]?.result.outcome, 'created');
    assertEqual(batch.failures.length, 0);
    assertEqual(notification.status, 'failed');
  });

  await test('ineligible warning is skipped without notification', async () => {
    const fake = notifier();
    const heat = { ...alert('heat-alert'), event: 'Extreme Heat Warning', severity: 'Moderate' as const };
    const result = await processNwsWarningForStormEvent(heat);
    const delivery = await dispatchWarningNotification(heat, result, fake.implementation);

    assertEqual(result.outcome, 'skipped_ineligible_alert');
    assertEqual(delivery.notified, false);
    assertEqual(fake.count(), 0);
  });

  await test('invalid alert ID is skipped without notification', async () => {
    const fake = notifier();
    const invalid = alert('');
    const result = await processNwsWarningForStormEvent(invalid);
    const delivery = await dispatchWarningNotification(invalid, result, fake.implementation);

    assertEqual(result.outcome, 'skipped_invalid_alert');
    assertEqual(delivery.notified, false);
    assertEqual(fake.count(), 0);
  });

  await test('manual events outside the NWS pipeline do not notify', async () => {
    const fake = notifier();
    await processNwsAlertsForStormEvents([], async () => created(106), {
      notifyWarning: async (warning, result) => dispatchWarningNotification(warning, result, fake.implementation),
    });

    assertEqual(fake.count(), 0);
  });

  await test('warning notification text excludes internal IDs', async () => {
    const text = warningNotificationText({
      eventType: 'Tornado Warning',
      areaDescription: 'Test County',
      expiresAt: 1800000000000,
      eventId: 987654321,
      lifecycle: 'created',
    });
    const rendered = `${text.title} ${text.body}`;

    assert(rendered.includes('Test County'), 'location text was expected');
    assert(!rendered.includes('alert-internal-id'), 'NWS alert ID must not be displayed');
    assert(!rendered.includes('987654321'), 'database event ID must not be displayed');
  });

  console.log(`\nPhase 6 notification tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();
