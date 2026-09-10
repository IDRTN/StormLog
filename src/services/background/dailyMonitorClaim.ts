import { getDatabase } from '../../database/database';
import { minimumAutomaticCadenceAgeMs } from './dailyMonitorCadence';

const GATE_TABLE = 'daily_monitor_automatic_gate';
const MAX_LEASE_MS = 2 * 60 * 1000;
const MIN_LEASE_MS = 30 * 1000;

async function ensureAutomaticGateSchema(db: Awaited<ReturnType<typeof getDatabase>>): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS ${GATE_TABLE} (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_attempt_ms INTEGER NOT NULL DEFAULT 0,
      last_success_ms INTEGER NOT NULL DEFAULT 0,
      lease_until_ms INTEGER NOT NULL DEFAULT 0
    )
  `);

  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${GATE_TABLE})`);
  const names = new Set(columns.map((column) => column.name));

  if (!names.has('last_success_ms')) {
    await db.execAsync(`ALTER TABLE ${GATE_TABLE} ADD COLUMN last_success_ms INTEGER NOT NULL DEFAULT 0`);
  }
  if (!names.has('lease_until_ms')) {
    await db.execAsync(`ALTER TABLE ${GATE_TABLE} ADD COLUMN lease_until_ms INTEGER NOT NULL DEFAULT 0`);
  }

  await db.runAsync(
    `INSERT OR IGNORE INTO ${GATE_TABLE} (id, last_attempt_ms, last_success_ms, lease_until_ms)
     VALUES (1, 0, 0, 0)`
  );
}

/**
 * Cross-process automatic collection gate backed by SQLite transaction
 * serialization.
 *
 * A short lease prevents simultaneous triggers from starting duplicate work.
 * A recent successful collection also suppresses duplicate watchdog callbacks.
 * The cadence-age rule is shared with DailyMonitorCoordinator so the local and
 * SQLite gates can never disagree about normal Headless JS startup jitter.
 */
export async function claimAutomaticCollection(attemptAtMs: number, intervalMs: number): Promise<boolean> {
  const db = await getDatabase();
  await ensureAutomaticGateSchema(db);

  const safeIntervalMs = Math.max(60_000, intervalMs);
  const leaseMs = Math.min(
    MAX_LEASE_MS,
    Math.max(MIN_LEASE_MS, Math.floor(safeIntervalMs / 4)),
  );
  const leaseUntilMs = attemptAtMs + leaseMs;
  const minSuccessAgeMs = minimumAutomaticCadenceAgeMs(safeIntervalMs);
  let claimed = false;

  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(
      `UPDATE ${GATE_TABLE}
       SET last_attempt_ms = ?, lease_until_ms = ?
       WHERE id = 1
         AND (? - last_success_ms) >= ?
         AND lease_until_ms <= ?`,
      attemptAtMs,
      leaseUntilMs,
      attemptAtMs,
      minSuccessAgeMs,
      attemptAtMs,
    );
    claimed = result.changes > 0;
  });

  return claimed;
}

/**
 * Commit a successful Daily Monitor observation to the cross-process gate.
 * Manual observations count as success too; this prevents an automatic
 * scheduler/watchdog from immediately duplicating a user-triggered collection.
 */
export async function markDailyMonitorCollectionSucceeded(completedAtMs: number = Date.now()): Promise<void> {
  const db = await getDatabase();
  await ensureAutomaticGateSchema(db);
  await db.runAsync(
    `UPDATE ${GATE_TABLE}
     SET last_success_ms = ?, lease_until_ms = 0
     WHERE id = 1`,
    completedAtMs,
  );
}

/** Release a stale/in-progress lease when a caller can explicitly do so. */
export async function releaseAutomaticCollectionLease(): Promise<void> {
  const db = await getDatabase();
  await ensureAutomaticGateSchema(db);
  await db.runAsync(
    `UPDATE ${GATE_TABLE} SET lease_until_ms = 0 WHERE id = 1`,
  );
}
