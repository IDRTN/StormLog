import { CURRENT_SCHEMA_VERSION } from '../schema';
import { getAllStormEvents } from '../stormEvents';
import { normalizeNwsAlerts } from '../../services/nws/alerts';
import {
  createStormEventForWarning,
  expireDueAutomaticWarnings,
  type StormLogDatabase,
  type WarningStormEventInput,
} from '../warningEvents';

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

type LifecycleEvent = {
  id: number;
  startTime: number;
  endTime: number | null;
  startLatitude: number;
  startLongitude: number;
  eventName: string;
  notes: string;
  nws_alert_id: string | null;
  current_nws_alert_id: string | null;
  trigger_source: string | null;
  is_automatic: number | null;
  warning_status: string | null;
  warning_ends_at: number | null;
};

type ProcessedWarning = {
  id: number;
  nws_alert_id: string;
  status: string;
  storm_event_id: number | null;
};

class LifecycleDatabase {
  events: LifecycleEvent[] = [];
  processedWarnings = new Map<string, ProcessedWarning>();
  private nextEventId = 101;
  private nextProcessedId = 201;

  get database(): StormLogDatabase {
    return {
      runAsync: async (sql: string, params: unknown[] = []) => {
        if (sql.includes('INSERT INTO processed_nws_alerts')) {
          const [alertId, , , status] = params;
          if (this.processedWarnings.has(alertId as string)) {
            return { changes: 0, lastInsertRowId: 0 };
          }
          const id = this.nextProcessedId++;
          this.processedWarnings.set(alertId as string, {
            id,
            nws_alert_id: alertId as string,
            status: status as string,
            storm_event_id: null,
          });
          return { changes: 1, lastInsertRowId: id };
        }

        if (sql.includes('INSERT INTO storm_events')) {
          const [
            startTime,
            startLatitude,
            startLongitude,
            eventName,
            nwsAlertId,
            triggerSource,
            isAutomatic,
          ] = params;
          const id = this.nextEventId++;
          this.events.push({
            id,
            startTime: startTime as number,
            endTime: null,
            startLatitude: startLatitude as number,
            startLongitude: startLongitude as number,
            eventName: eventName as string,
            notes: '',
            nws_alert_id: nwsAlertId as string,
            current_nws_alert_id: null,
            trigger_source: triggerSource as string,
            is_automatic: isAutomatic as number,
            warning_status: null,
            warning_ends_at: null,
          });
          return { changes: 1, lastInsertRowId: id };
        }

        if (sql.includes('SET current_nws_alert_id')) {
          const [currentId, status, endsAt, eventId] = params;
          const event = this.events.find((row) => row.id === eventId);
          if (!event || event.endTime != null || event.is_automatic !== 1) {
            return { changes: 0, lastInsertRowId: 0 };
          }
          event.current_nws_alert_id = currentId as string;
          event.warning_status = status as string;
          event.warning_ends_at = endsAt as number | null;
          return { changes: 1, lastInsertRowId: 0 };
        }

        if (sql.includes('SET endTime = ?, warning_status = ?')) {
          const [endTime, status, eventId] = params;
          const event = this.events.find((row) => row.id === eventId);
          if (!event || event.endTime != null || event.is_automatic !== 1) {
            return { changes: 0, lastInsertRowId: 0 };
          }
          event.endTime = endTime as number;
          event.warning_status = status as string;
          return { changes: 1, lastInsertRowId: 0 };
        }

        if (sql.includes('SET endTime = warning_ends_at')) {
          const [status, eventId] = params;
          const event = this.events.find((row) => row.id === eventId);
          if (!event || event.endTime != null || event.is_automatic !== 1) {
            return { changes: 0, lastInsertRowId: 0 };
          }
          event.endTime = event.warning_ends_at;
          event.warning_status = status as string;
          return { changes: 1, lastInsertRowId: 0 };
        }

        if (sql.includes('UPDATE processed_nws_alerts') && sql.includes('WHERE nws_alert_id')) {
          const [status, processedAt, eventId, alertId] = params;
          const warning = this.processedWarnings.get(alertId as string);
          assert(warning != null, 'processed warning disappeared');
          warning.status = status as string;
          warning.storm_event_id = eventId as number;
          void processedAt;
          return { changes: 1, lastInsertRowId: 0 };
        }

        if (sql.includes('UPDATE processed_nws_alerts') && sql.includes('WHERE storm_event_id')) {
          const [status, eventId, createdStatus, updatedStatus] = params;
          for (const warning of this.processedWarnings.values()) {
            if (
              warning.storm_event_id === eventId
              && (warning.status === createdStatus || warning.status === updatedStatus)
            ) {
              warning.status = status as string;
            }
          }
          return { changes: 1, lastInsertRowId: 0 };
        }

        throw new Error(`unexpected runAsync SQL: ${sql}`);
      },
      getFirstAsync: async (sql: string, params: unknown[] = []) => {
        if (sql.includes('FROM processed_nws_alerts')) {
          const warning = this.processedWarnings.get(params[0] as string);
          return warning ? { id: warning.id } : null;
        }
        throw new Error(`unexpected getFirstAsync SQL: ${sql}`);
      },
      getAllAsync: async (sql: string, params: unknown[] = []) => {
        if (sql.includes('current_nws_alert_id IN')) {
          return this.events.filter((event) =>
            event.endTime == null
            && event.is_automatic === 1
            && params.some((identity) =>
              identity === event.nws_alert_id || identity === event.current_nws_alert_id
            )
          );
        }

        if (sql.includes('SELECT * FROM storm_events')) {
          return this.events.filter((event) => event.endTime == null);
        }

        if (sql.includes('warning_ends_at <= ?')) {
          const now = params[0] as number;
          return this.events
            .filter((event) => event.endTime == null
              && event.is_automatic === 1
              && event.warning_ends_at != null
              && event.warning_ends_at <= now)
            .map((event) => ({ id: event.id }));
        }

        throw new Error(`unexpected getAllAsync SQL: ${sql}`);
      },
      withTransactionAsync: async (task: () => Promise<void>) => task(),
    } as unknown as StormLogDatabase;
  }
}

type WarningInputOverrides = Partial<
  Omit<WarningStormEventInput['warning'], 'nwsAlertId'>
> & {
  nwsAlertId: string;
  severity?: string | null;
};

function warningInput(overrides: WarningInputOverrides): WarningStormEventInput {
  const { severity, ...warningOverrides } = overrides;
  return {
    location: { latitude: 40, longitude: -82 },
    warning: {
      event: 'Tornado Warning',
      triggerSource: 'NWS_WARNING',
      status: 'Actual',
      messageType: 'Alert',
      references: [],
      endsAt: null,
      ...warningOverrides,
    },
    nowMs: 1000,
  };
  void severity;
}

async function main() {
  await test('schema version targets warning lifecycle support', () => {
    assertEqual(CURRENT_SCHEMA_VERSION, 7);
  });

  await test('normalizes actual NWS lifecycle fields', () => {
    const [normalized] = normalizeNwsAlerts([{
      id: 'urn:oid:2.49.0.1.840.lifecycle',
      properties: {
        event: 'Tornado Warning',
        severity: 'Extreme',
        status: 'Actual',
        messageType: 'Update',
        effective: '2026-08-24T00:00:00Z',
        onset: '2026-08-24T00:01:00Z',
        ends: '2026-08-24T01:00:00Z',
        expires: '2026-08-24T01:30:00Z',
        references: [{ identifier: 'urn:oid:2.49.0.1.840.original' }],
      },
    }], Date.parse('2026-08-24T00:10:00Z'));

    assert(normalized != null, 'normalized lifecycle alert missing');
    assertEqual(normalized.status, 'Actual');
    assertEqual(normalized.messageType, 'Update');
    assertEqual(normalized.effective, Date.parse('2026-08-24T00:00:00Z'));
    assertEqual(normalized.ends, Date.parse('2026-08-24T01:00:00Z'));
    assertEqual(JSON.stringify(normalized.references), JSON.stringify([
      'urn:oid:2.49.0.1.840.original',
    ]));
  });

  await test('repeated identical warning identity does not create another event', async () => {
    const db = new LifecycleDatabase();
    const first = await createStormEventForWarning(
      warningInput({ nwsAlertId: 'same-id', endsAt: 2000 }), db.database
    );
    const second = await createStormEventForWarning(
      warningInput({ nwsAlertId: 'same-id', endsAt: 3000 }), db.database
    );

    assertEqual(first.outcome, 'created');
    assertEqual(second.outcome, 'skipped_duplicate_alert');
    assertEqual(db.events.length, 1);
  });

  await test('reference-linked update preserves original identity and refreshes state', async () => {
    const db = new LifecycleDatabase();
    await createStormEventForWarning(
      warningInput({ nwsAlertId: 'warning-original', endsAt: 1500 }), db.database
    );
    const result = await createStormEventForWarning(
      warningInput({
        nwsAlertId: 'warning-update',
        messageType: 'Update',
        references: ['warning-original'],
        endsAt: 2500,
        nowMsPlaceholder: undefined,
      } as Partial<WarningStormEventInput['warning']> & { nwsAlertId: string }), db.database
    );

    assertEqual(result.outcome, 'updated_event');
    const event = db.events[0];
    assertEqual(event.nws_alert_id, 'warning-original');
    assertEqual(event.current_nws_alert_id, 'warning-update');
    assertEqual(event.warning_status, 'ACTIVE');
    assertEqual(event.warning_ends_at, 2500);
    assertEqual(event.endTime, null);
    assertEqual(db.processedWarnings.get('warning-original')?.status, 'STORM_EVENT_CREATED');
    assertEqual(db.processedWarnings.get('warning-update')?.status, 'STORM_EVENT_UPDATED');
  });

  await test('reference-linked cancellation closes only the automatic event', async () => {
    const db = new LifecycleDatabase();
    await createStormEventForWarning(
      warningInput({ nwsAlertId: 'cancel-original', endsAt: 5000 }), db.database
    );
    const result = await createStormEventForWarning(
      warningInput({
        nwsAlertId: 'cancel-message',
        messageType: 'Cancel',
        severity: 'Unknown',
        references: ['cancel-original'],
      }), db.database
    );

    assertEqual(result.outcome, 'canceled_event');
    const event = db.events[0];
    assertEqual(event.endTime, 1000);
    assertEqual(event.warning_status, 'CANCELED');
    assertEqual(db.processedWarnings.get('cancel-message')?.status, 'STORM_EVENT_CANCELED');
  });

  await test('due automatic warnings expire during the existing collection boundary', async () => {
    const db = new LifecycleDatabase();
    await createStormEventForWarning(
      warningInput({ nwsAlertId: 'expiring-warning', endsAt: 900 }), db.database
    );
    const expiredCount = await expireDueAutomaticWarnings(1000, db.database);

    assertEqual(expiredCount, 1);
    const event = db.events[0];
    assertEqual(event.endTime, 900);
    assertEqual(event.warning_status, 'EXPIRED');
    assertEqual(db.processedWarnings.get('expiring-warning')?.status, 'STORM_EVENT_EXPIRED');
  });

  await test('a separate warning identity can become its own event', async () => {
    const db = new LifecycleDatabase();
    await createStormEventForWarning(
      warningInput({ nwsAlertId: 'warning-a', endsAt: 1200 }), db.database
    );
    await createStormEventForWarning(
      warningInput({ nwsAlertId: 'cancel-a', messageType: 'Cancel', references: ['warning-a'] }),
      db.database
    );
    const result = await createStormEventForWarning(
      warningInput({ nwsAlertId: 'warning-b', endsAt: 3000 }), db.database
    );

    assertEqual(result.outcome, 'created');
    assertEqual(db.events.length, 2);
    assertEqual(db.events[1]?.nws_alert_id, 'warning-b');
  });

  await test('manual events are protected from automatic cancellation', async () => {
    const db = new LifecycleDatabase();
    db.events.push({
      id: 50,
      startTime: 1,
      endTime: null,
      startLatitude: 40,
      startLongitude: -82,
      eventName: 'Manual observation',
      notes: '',
      nws_alert_id: 'manual-warning-id',
      current_nws_alert_id: 'manual-warning-id',
      trigger_source: null,
      is_automatic: 0,
      warning_status: null,
      warning_ends_at: null,
    });

    const result = await createStormEventForWarning(
      warningInput({
        nwsAlertId: 'manual-cancel',
        messageType: 'Cancel',
        references: ['manual-warning-id'],
      }), db.database
    );

    assertEqual(result.outcome, 'skipped_cancel_without_event');
    const manual = db.events.find((event) => event.id === 50);
    assert(manual != null, 'manual event missing');
    assertEqual(manual.endTime, null);
    assertEqual(manual.warning_status, null);
  });

  await test('legacy event rows remain readable with null lifecycle metadata', async () => {
    const legacyDatabase = {
      getAllAsync: async () => [{
        id: 7,
        startTime: 100,
        endTime: null,
        startLatitude: 40,
        startLongitude: -82,
        endLatitude: null,
        endLongitude: null,
        eventName: 'Legacy event',
        notes: '',
        nwsAlertId: null,
        triggerSource: null,
        isAutomatic: null,
        warningStatus: null,
        warningEndsAt: null,
        currentNwsAlertId: null,
      }],
    } as unknown as Parameters<typeof getAllStormEvents>[0];

    const events = await getAllStormEvents(legacyDatabase);
    assertEqual(events.length, 1);
    assertEqual(events[0]?.warningStatus, null);
    assertEqual(events[0]?.warningEndsAt, null);
    assertEqual(events[0]?.currentNwsAlertId, null);
  });

  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main();
