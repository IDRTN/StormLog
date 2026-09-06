import { CURRENT_SCHEMA_VERSION } from '../schema';
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

function assertEqual(actual: unknown, expected: unknown, message = 'values differ'): void {
  assert(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

async function test(name: string, task: () => Promise<void> | void): Promise<void> {
  try {
    await task();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(error instanceof Error ? error.message : String(error));
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
          const idValue = String(alertId);
          if (this.processedWarnings.has(idValue)) {
            return { changes: 0, lastInsertRowId: 0 };
          }
          const id = this.nextProcessedId++;
          this.processedWarnings.set(idValue, {
            id,
            nws_alert_id: idValue,
            status: String(status),
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
            startTime: Number(startTime),
            endTime: null,
            startLatitude: Number(startLatitude),
            startLongitude: Number(startLongitude),
            eventName: String(eventName),
            notes: '',
            nws_alert_id: nwsAlertId == null ? null : String(nwsAlertId),
            current_nws_alert_id: null,
            trigger_source: triggerSource == null ? null : String(triggerSource),
            is_automatic: Number(isAutomatic),
            warning_status: null,
            warning_ends_at: null,
          });
          return { changes: 1, lastInsertRowId: id };
        }

        if (sql.includes('SET current_nws_alert_id = ?')) {
          const [currentId, status, endsAt, eventId] = params;
          const event = this.events.find((row) => row.id === Number(eventId));
          if (!event || event.endTime != null || event.is_automatic !== 1) {
            return { changes: 0, lastInsertRowId: 0 };
          }
          event.current_nws_alert_id = String(currentId);
          event.warning_status = String(status);
          event.warning_ends_at = endsAt == null ? null : Number(endsAt);
          return { changes: 1, lastInsertRowId: 0 };
        }

        if (
          sql.includes('UPDATE storm_events')
          && sql.includes('SET warning_status = ?, warning_ends_at = ?')
        ) {
          const [status, endsAt, eventId] = params;
          const event = this.events.find((row) => row.id === Number(eventId));
          if (!event || event.endTime != null || event.is_automatic !== 1) {
            return { changes: 0, lastInsertRowId: 0 };
          }
          event.warning_status = String(status);
          event.warning_ends_at = endsAt == null ? null : Number(endsAt);
          return { changes: 1, lastInsertRowId: 0 };
        }

        if (
          sql.includes('UPDATE storm_events')
          && sql.includes('SET warning_status = ?')
          && !sql.includes('warning_ends_at = ?')
        ) {
          const [status, eventId] = params;
          const event = this.events.find((row) => row.id === Number(eventId));
          if (!event || event.endTime != null || event.is_automatic !== 1) {
            return { changes: 0, lastInsertRowId: 0 };
          }
          event.warning_status = String(status);
          return { changes: 1, lastInsertRowId: 0 };
        }

        if (sql.includes('UPDATE processed_nws_alerts') && sql.includes('WHERE nws_alert_id = ?')) {
          const [status, , eventId, alertId] = params;
          const warning = this.processedWarnings.get(String(alertId));
          assert(warning != null, 'processed warning disappeared');
          warning.status = String(status);
          warning.storm_event_id = Number(eventId);
          return { changes: 1, lastInsertRowId: 0 };
        }

        if (sql.includes('UPDATE processed_nws_alerts') && sql.includes('WHERE storm_event_id = ?')) {
          const [status, eventId, createdStatus, updatedStatus] = params;
          for (const warning of this.processedWarnings.values()) {
            if (
              warning.storm_event_id === Number(eventId)
              && (warning.status === createdStatus || warning.status === updatedStatus)
            ) {
              warning.status = String(status);
            }
          }
          return { changes: 1, lastInsertRowId: 0 };
        }

        throw new Error(`unexpected runAsync SQL: ${sql}`);
      },

      getFirstAsync: async (sql: string, params: unknown[] = []) => {
        if (sql.includes('FROM processed_nws_alerts')) {
          const warning = this.processedWarnings.get(String(params[0]));
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
          const [status, now] = params;
          return this.events
            .filter((event) =>
              event.endTime == null
              && event.is_automatic === 1
              && event.warning_status === status
              && event.warning_ends_at != null
              && event.warning_ends_at <= Number(now)
            )
            .map((event) => ({ id: event.id }));
        }

        throw new Error(`unexpected getAllAsync SQL: ${sql}`);
      },

      withTransactionAsync: async (task: () => Promise<void>) => task(),
    } as unknown as StormLogDatabase;
  }
}

function warningInput(overrides: Partial<WarningStormEventInput['warning']> & { nwsAlertId: string }): WarningStormEventInput {
  return {
    location: { latitude: 40, longitude: -82 },
    warning: {
      event: 'Tornado Warning',
      triggerSource: 'NWS_WARNING',
      status: 'Actual',
      messageType: 'Alert',
      references: [],
      endsAt: null,
      ...overrides,
    },
    nowMs: 1000,
  };
}

async function main(): Promise<void> {
  await test('schema version includes warning lifecycle fields', () => {
    assertEqual(CURRENT_SCHEMA_VERSION, 7);
  });

  await test('normalizes NWS lifecycle fields and references', () => {
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
    assertEqual(normalized.ends, Date.parse('2026-08-24T01:00:00Z'));
    assertEqual(normalized.references[0], 'urn:oid:2.49.0.1.840.original');
  });

  await test('duplicate warning identity cannot create a second event', async () => {
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

  await test('reference-linked update preserves original event identity', async () => {
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
      }), db.database
    );

    assertEqual(result.outcome, 'updated_event');
    const event = db.events[0];
    assertEqual(event.nws_alert_id, 'warning-original');
    assertEqual(event.current_nws_alert_id, 'warning-update');
    assertEqual(event.warning_status, 'ACTIVE');
    assertEqual(event.warning_ends_at, 2500);
    assertEqual(event.endTime, null, 'an NWS update must not close the recording');
  });

  await test('NWS cancellation removes warning trigger but keeps storm recording open', async () => {
    const db = new LifecycleDatabase();
    await createStormEventForWarning(
      warningInput({ nwsAlertId: 'cancel-original', endsAt: 5000 }), db.database
    );
    const result = await createStormEventForWarning(
      warningInput({
        nwsAlertId: 'cancel-message',
        messageType: 'Cancel',
        references: ['cancel-original'],
      }), db.database
    );

    assertEqual(result.outcome, 'canceled_event');
    const event = db.events[0];
    assertEqual(event.warning_status, 'CANCELED');
    assertEqual(event.endTime, null, 'cancellation must defer stop to automaticStormLifecycle');
    assertEqual(db.processedWarnings.get('cancel-message')?.status, 'STORM_EVENT_CANCELED');
  });

  await test('NWS expiration marks lifecycle expired without silently ending recording', async () => {
    const db = new LifecycleDatabase();
    await createStormEventForWarning(
      warningInput({ nwsAlertId: 'expiring-warning', endsAt: 900 }), db.database
    );
    const expiredCount = await expireDueAutomaticWarnings(1000, db.database);

    assertEqual(expiredCount, 1);
    const event = db.events[0];
    assertEqual(event.warning_status, 'EXPIRED');
    assertEqual(event.endTime, null, 'expiration must defer stop to reviewed lifecycle');
    assertEqual(db.processedWarnings.get('expiring-warning')?.status, 'STORM_EVENT_EXPIRED');
  });

  await test('a different warning cannot create a competing event while reviewed recording remains open', async () => {
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

    assertEqual(result.outcome, 'skipped_active_event');
    assertEqual(db.events.length, 1);
    assertEqual(db.events[0].endTime, null);
  });

  await test('manual events are protected from automatic warning cancellation', async () => {
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
    assertEqual(db.events[0].endTime, null);
    assertEqual(db.events[0].warning_status, null);
  });

  console.log(`Warning lifecycle tests — Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

void main();
