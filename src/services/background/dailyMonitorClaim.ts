import { getDatabase } from '../../database/database';

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

  // APKs before the hardening pass created this table with only
  // last_attempt_ms. Migrate it in place so an app update does not require a
  // database reset or a monitor restart.
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
 * The old gate treated an ATTEMPT as if it were a successful collection and
 * blocked every other scheduler for the full monitor interval. If location,
 * networking, or JS startup stalled, that consumed the 15-minute slot even
 * though no observation was written. The result was the 30/45/50-minute gaps
 * seen in the field.
 *
 * This gate now uses a short in-progress lease for de-duplication and only the
 * last SUCCESSFUL collection suppresses a full interval. A failed/stalled
 * attempt therefore becomes retryable after the lease instead of silently
 * losing the entire interval.
 */
export async function claimAutomaticCollection(attemptAtMs: number, intervalMs: number): Promise<boolean> {
  const db = await getDatabase();
  await ensureAutomaticGateSchema(db);

  const leaseMs = Math.min(
    MAX_LEASE_MS,
    Math.max(MIN_LEASE_MS, Math.floor(intervalMs / 4)),
  );
  const leaseUntilMs = attemptAtMs + leaseMs;
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
      intervalMs,
      attemptAtMs,
    );
    claimed = result.changes > 0;
  });

  return claimed;
}

/**
 * Commit a successful Daily Monitor observation to the cross-process gate.
 * Manual observations count as success too; this intentionally prevents an
 * automatic scheduler from writing a duplicate observation immediately after
 * the user has just collected one.
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
