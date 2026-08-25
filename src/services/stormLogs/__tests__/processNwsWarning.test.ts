import { normalizeNwsAlerts, type NormalizedNwsAlert } from '../../nws/alerts';
import type { StormLogDatabase } from '../../../database/warningEvents';
import { processNwsWarningForStormEvent } from '../processNwsWarning';

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

function assertCoordinateClose(
  actual: { latitude: number; longitude: number } | null | undefined,
  expected: { latitude: number; longitude: number },
  message = 'coordinates differ'
) {
  assert(actual != null, `${message}: actual coordinates missing`);
  assert(Math.abs(actual.latitude - expected.latitude) < 1e-9, `${message}: latitude differs`);
  assert(Math.abs(actual.longitude - expected.longitude) < 1e-9, `${message}: longitude differs`);
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
          if (this.processedWarnings.has(alertId as string)) {
            return { changes: 0, lastInsertRowId: 0 };
          }
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

        if (sql.includes('INSERT INTO storm_events')) {
          const [startTime, startLatitude, startLongitude, eventName, nwsAlertId, triggerSource, isAutomatic] = params;
          this.eventInsertParams = params;
          const id = this.nextEventId++;
          this.stormEvents.push({
            id,
            startTime,
            endTime: null,
            startLatitude,
            startLongitude,
            eventName,
            notes: '',
            nwsAlertId,
            triggerSource,
            isAutomatic,
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

const nowMs = Date.parse('2026-08-24T00:10:00Z');

function polygonFeature(id: string): unknown {
  return {
    id,
    geometry: {
      type: 'Polygon',
      coordinates: [[[-82.5, 40], [-82.3, 40], [-82.3, 40.2], [-82.5, 40.2], [-82.5, 40]]],
    },
    properties: {
      event: 'Tornado Warning',
      severity: 'Extreme',
      expires: '2026-08-24T01:00:00Z',
    },
  };
}

function normalizedPolygonAlert(id = 'alert-polygon'): NormalizedNwsAlert {
  const [alert] = normalizeNwsAlerts([polygonFeature(id)], nowMs);
  assert(alert != null, 'normalized warning missing');
  return alert;
}

async function main() {
  await test('normalizes polygon geometry to one representative point', () => {
    assertCoordinateClose(normalizedPolygonAlert().representativePoint, {
      latitude: 40.1,
      longitude: -82.4,
    });
  });

  await test('eligible warning requests automatic event creation', async () => {
    const fake = new FakeWarningDatabase();
    const result = await processNwsWarningForStormEvent({
      ...normalizedPolygonAlert('alert-created'),
      representativePoint: { latitude: 40.12, longitude: -82.34 },
    }, fake.database);

    assertEqual(result.outcome, 'created');
    assert(result.outcome === 'created', 'expected created outcome');
    assertEqual(result.eventId, 101);
    assertDeepEqual(fake.eventInsertParams?.slice(1, 4), [40.12, -82.34, 'Automatic Tornado Warning']);
    assertDeepEqual(fake.eventInsertParams?.slice(4), ['alert-created', 'NWS_WARNING', 1]);
  });

  await test('same alert identity cannot create twice', async () => {
    const fake = new FakeWarningDatabase();
    const alert = normalizedPolygonAlert('alert-duplicate');
    const first = await processNwsWarningForStormEvent(alert, fake.database);

    const createdEvent = fake.stormEvents[0];
    assert(createdEvent != null, 'first warning did not create an event');
    createdEvent.endTime = Date.now() + 1;
    const second = await processNwsWarningForStormEvent(alert, fake.database);

    assertEqual(first.outcome, 'created');
    assertEqual(second.outcome, 'skipped_duplicate_alert');
    assertEqual(fake.stormEvents.length, 1);
  });

  await test('missing warning coordinates remain missing', async () => {
    const fake = new FakeWarningDatabase();
    const result = await processNwsWarningForStormEvent({
      ...normalizedPolygonAlert('alert-no-location'),
      representativePoint: null,
    }, fake.database);

    assertEqual(result.outcome, 'skipped_missing_location');
    assertEqual(fake.stormEvents.length, 0);
  });

  await test('ineligible non-storm warning is explicitly skipped', async () => {
    const fake = new FakeWarningDatabase();
    const result = await processNwsWarningForStormEvent({
      ...normalizedPolygonAlert('alert-heat'),
      event: 'Extreme Heat Warning',
    }, fake.database);

    assertEqual(result.outcome, 'skipped_ineligible_alert');
    assertEqual(fake.stormEvents.length, 0);
    assertEqual(fake.processedWarnings.size, 0);
  });

  await test('active automatic event preserves Phase 1 active guard', async () => {
    const fake = new FakeWarningDatabase();
    fake.stormEvents.push({
      id: 50,
      startTime: 1,
      endTime: null,
      startLatitude: 40,
      startLongitude: -82,
      eventName: 'Active',
      notes: '',
      is_automatic: 1,
    });
    const result = await processNwsWarningForStormEvent(
      normalizedPolygonAlert('alert-active'),
      fake.database
    );

    assertEqual(result.outcome, 'skipped_active_event');
  });

  await test('active manual event remains protected', async () => {
    const fake = new FakeWarningDatabase();
    fake.stormEvents.push({
      id: 60,
      startTime: 2,
      endTime: null,
      startLatitude: 40,
      startLongitude: -82,
      eventName: 'Manual',
      notes: '',
      is_automatic: null,
    });
    const result = await processNwsWarningForStormEvent(
      normalizedPolygonAlert('alert-manual-guard'),
      fake.database
    );

    assertEqual(result.outcome, 'skipped_active_event');
    assertEqual(fake.stormEvents.length, 1);
  });

  await test('alert identity reaches Phase 1 unchanged', async () => {
    const fake = new FakeWarningDatabase();
    const alertId = 'urn:oid:2.49.0.1.840.phase-two-identity';
    await processNwsWarningForStormEvent(normalizedPolygonAlert(alertId), fake.database);

    assert(fake.processedWarnings.has(alertId), 'stable alert ID was not preserved');
    assertEqual(fake.eventInsertParams?.[4], alertId);
  });

  await test('database transaction failures are surfaced', async () => {
    const failure = new Error('transaction failed');
    const failingDatabase = {
      runAsync: async () => {
        throw new Error('unexpected runAsync');
      },
      getFirstAsync: async () => null,
      getAllAsync: async () => [],
      withTransactionAsync: async () => {
        throw failure;
      },
    } as unknown as StormLogDatabase;

    let caught: unknown = null;
    try {
      await processNwsWarningForStormEvent(
        normalizedPolygonAlert('alert-failure'),
        failingDatabase
      );
    } catch (error) {
      caught = error;
    }
    assertEqual(caught, failure);
  });

  await test('invalid alert identity cannot write warning data', async () => {
    const fake = new FakeWarningDatabase();

    for (const alertId of ['', '   ']) {
      const result = await processNwsWarningForStormEvent(
        normalizedPolygonAlert(alertId),
        fake.database
      );

      assertEqual(result.outcome, 'skipped_invalid_alert');
      assert(result.outcome === 'skipped_invalid_alert', 'expected invalid-alert outcome');
      assertEqual(result.reason, 'missing_id');
    }

    assertEqual(fake.processedWarnings.size, 0);
    assertEqual(fake.stormEvents.length, 0);
  });

  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main();
