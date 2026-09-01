import { CURRENT_SCHEMA_VERSION } from '../schema';
import { normalizeNwsAlerts } from '../../services/nws/alerts';
import { getAllStormEvents, createStormEvent } from '../stormEvents';
import {
  recordProcessedNwsAlert,
  createStormEventForWarning,
  type StormLogDatabase,
} from '../warningEvents';
import { createAutomaticStormEvent } from '../../services/stormLogs/createStormLogEvent';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message = 'values differ') {
  assert(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

function assertDeepEqual(actual: unknown, expected: unknown, message = 'objects differ') {
  assertEqual(JSON.stringify(actual), JSON.stringify(expected), message);
}

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL: ${name}`);
    console.log(`  ${error instanceof Error ? error.message : String(error)}`);
  }
}

class FakeWarningDatabase {
  stormEvents: Record<string, unknown>[] = [];
  processedWarnings = new Map<string, Record<string, unknown>>();
  eventInsertParams: unknown[] | null = null;
  private nextEventId = 101;
  private nextProcessedId = 201;

  get database(): StormLogDatabase {
    return {
      runAsync: async (sql: string, params: unknown[] = []) => {
        if (sql.includes('INSERT INTO processed_nws_alerts')) {
          const [alertId, firstSeenAt, processedAt, status, source] = params;
          if (this.processedWarnings.has(alertId as string)) return { changes: 0, lastInsertRowId: 0 };
          const id = this.nextProcessedId++;
          this.processedWarnings.set(alertId as string, {
            id,
            nwsAlertId: alertId,
            firstSeenAt,
            processedAt,
            status,
            source,
            storm_event_id: null,
          });
          return { changes: 1, lastInsertRowId: id };
        }

        if (sql.includes('SET current_nws_alert_id')) {
          const [currentAlertId, warningStatus, warningEndsAt, eventId] = params;
          const event = this.stormEvents.find((row) => row.id === eventId);
          assert(event != null, 'warning event missing during lifecycle update');
          event.current_nws_alert_id = currentAlertId;
          event.warning_status = warningStatus;
          event.warning_ends_at = warningEndsAt;
          return { changes: 1, lastInsertRowId: 0 };
        }

        if (sql.includes('INSERT INTO storm_events')) {
          const [startTime, startLatitude, startLongitude, eventName, nwsAlertId, triggerSource, isAutomatic] = params;
          this.eventInsertParams = params;
          const id = this.nextEventId++;
          this.stormEvents.push({
            id, startTime, endTime: null, startLatitude, startLongitude, eventName, notes: '',
            nwsAlertId, triggerSource, isAutomatic,
          });
          return { changes: 1, lastInsertRowId: id };
        }

        if (sql.includes('UPDATE processed_nws_alerts')) {
          const [status, processedAt, stormEventId, alertId] = params;
          const row = this.processedWarnings.get(alertId as string);
          assert(row != null, 'processed warning missing during update');
          row.status = status;
          row.processedAt = processedAt;
          row.storm_event_id = stormEventId;
          return { changes: 1, lastInsertRowId: 0 };
        }

        throw new Error(`unexpected runAsync SQL: ${sql}`);
      },
      getFirstAsync: async (sql: string, params: unknown[] = []) => {
        if (sql.includes('FROM processed_nws_alerts')) {
          const row = this.processedWarnings.get(params[0] as string);
          return row ? { id: row.id } : null;
        }
        throw new Error(`unexpected getFirstAsync SQL: ${sql}`);
      },
      getAllAsync: async (sql: string) => {
        if (sql.includes('WHERE endTime IS NULL')) {
          return this.stormEvents.filter((row) => row.endTime == null);
        }
        if (sql.includes('FROM storm_events')) return this.stormEvents;
        throw new Error(`unexpected getAllAsync SQL: ${sql}`);
      },
      withTransactionAsync: async (task: () => Promise<void>) => task(),
    } as unknown as StormLogDatabase;
  }
}

async function main() {
  await test('normalized alerts retain complete warning identity', async () => {
    const [alert] = normalizeNwsAlerts([
      {
        id: 'urn:oid:2.49.0.1.840.alert-identity',
        properties: {
          event: 'Tornado Warning',
          headline: 'Radar-indicated rotation',
          severity: 'Extreme',
          urgency: 'Immediate',
          certainty: 'Observed',
          onset: '2026-08-24T00:00:00Z',
          expires: '2026-08-24T01:00:00Z',
          areaDesc: 'Test County',
        },
      },
    ], Date.parse('2026-08-24T00:10:00Z'));

    assert(alert != null, 'normalized alert missing');
    assertEqual(alert.id, 'urn:oid:2.49.0.1.840.alert-identity');
    assertEqual(alert.event, 'Tornado Warning');
    assertEqual(alert.headline, 'Radar-indicated rotation');
    assertEqual(alert.severity, 'Extreme');
    assertEqual(alert.urgency, 'Immediate');
    assertEqual(alert.certainty, 'Observed');
    assertEqual(alert.areaDesc, 'Test County');
    assertEqual(alert.expires, Date.parse('2026-08-24T01:00:00Z'));
  });

  await test('schema targets the warning identity foundation', async () => {
    assertEqual(CURRENT_SCHEMA_VERSION, 9);
  });

  await test('records a new NWS alert ID once', async () => {
    const fake = new FakeWarningDatabase();
    const first = await recordProcessedNwsAlert(
      { nwsAlertId: 'alert-one', firstSeenAt: 10, processedAt: 20 },
      fake.database
    );
    const second = await recordProcessedNwsAlert(
      { nwsAlertId: 'alert-one', firstSeenAt: 30, processedAt: 40 },
      fake.database
    );
    assertEqual(first.recorded, true);
    assertEqual(first.processedWarningId, 201);
    assertEqual(second.recorded, false);
    assertEqual(fake.processedWarnings.size, 1);
  });

  await test('stores automatic warning metadata transactionally', async () => {
    const fake = new FakeWarningDatabase();
    const result = await createStormEventForWarning(
      {
        location: { latitude: 40.0379, longitude: -82.4999 },
        warning: { nwsAlertId: 'alert-auto', event: 'Tornado Warning' },
        nowMs: 12345,
      },
      fake.database
    );

    assertEqual(result.outcome, 'created');
    assert(result.outcome === 'created', 'expected created outcome');
    assertEqual(result.eventId, 101);
    assertDeepEqual(fake.eventInsertParams?.slice(4), ['alert-auto', 'NWS_WARNING', 1]);
    assertEqual(fake.processedWarnings.get('alert-auto')?.status, 'STORM_EVENT_CREATED');
  });

  await test('manual creation remains metadata-free', async () => {
    const fake = new FakeWarningDatabase();
    const eventId = await createStormEvent(
      40.0379, -82.4999, 'Field event', undefined, fake.database
    );
    assertEqual(eventId, 101);
    assertDeepEqual(fake.eventInsertParams?.slice(4), [null, null, null]);
  });

  await test('legacy event rows without new columns remain readable', async () => {
    const fake = new FakeWarningDatabase();
    fake.stormEvents.push({
      id: 7, startTime: 100, endTime: null, startLatitude: 40, startLongitude: -82,
      endLatitude: null, endLongitude: null, eventName: 'Legacy event', notes: '',
    });
    const events = await getAllStormEvents(fake.database);
    assertEqual(events.length, 1);
    assertEqual(events[0].nwsAlertId, null);
    assertEqual(events[0].triggerSource, null);
    assertEqual(events[0].isAutomatic, null);
  });

  await test('an active event prevents duplicate automatic creation', async () => {
    const fake = new FakeWarningDatabase();
    fake.stormEvents.push({
      id: 50, startTime: 1, endTime: null, startLatitude: 40, startLongitude: -82,
      endLatitude: null, endLongitude: null, eventName: 'Active', notes: '',
    });
    const result = await createStormEventForWarning(
      {
        location: { latitude: 40, longitude: -82 },
        warning: { nwsAlertId: 'alert-active-guard', event: 'Severe Thunderstorm Warning' },
      },
      fake.database
    );
    assertEqual(result.outcome, 'skipped_active_event');
    assertEqual(fake.eventInsertParams, null);
  });

  await test('missing coordinates remain unknown rather than zero-zero', async () => {
    const fake = new FakeWarningDatabase();
    const result = await createAutomaticStormEvent({
      location: null,
      alert: { id: 'alert-no-location', event: 'Tornado Warning' },
      database: fake.database,
    });
    assertEqual(result.outcome, 'skipped_missing_location');
  });

  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main();
