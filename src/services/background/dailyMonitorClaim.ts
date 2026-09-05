import { getDatabase } from '../../database/database';

const GATE_TABLE = 'daily_monitor_automatic_gate';
const MAX_LEASE_MS = 2 * 60 * 1000;
const MIN_LEASE_MS = 30 * 1000;
const MAX_CADENCE_JITTER_MS = 3 * 60 * 1000;

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

function minimumSuccessAgeMs(intervalMs: number): number {
  const safeIntervalMs = Math.max(60_000, intervalMs);
  const jitterAllowanceMs = Math.min(
    MAX_CADENCE_JITTER_MS,
    Math.max(30_000, Math.floor(safeIntervalMs / 5)),
  );
  return Math.max(30_000, safeIntervalMs - jitterAllowanceMs);
}

/**
 * Cross-process automatic collection gate backed by SQLite transaction
 * serialization.
 *
 * A short lease prevents simultaneous triggers from starting duplicate work.
 * A recent successful collection also suppresses duplicate watchdog callbacks,
 * but the success guard intentionally allows a small cadence-jitter window.
 *
 * Why the jitter window matters: the native exact alarm is an elapsed cadence,
 * while a successful observation is committed after location/network/database
 * work completes. Requiring a full interval from completion time can reject the
 * next legitimate alarm simply because the prior cycle took 20-90 seconds to
 * finish. That was one of the mechanisms behind the observed 15/30-minute
 * alternation. The guard now blocks true duplicates while preserving the next
 * scheduled interval.
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
  const minSuccessAgeMs = minimumSuccessAgeMs(safeIntervalMs);
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
