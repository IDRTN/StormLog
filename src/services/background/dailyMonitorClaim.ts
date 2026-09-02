import { getDatabase } from '../../database/database';

/**
 * Cross-process automatic collection gate.
 * AsyncStorage persistence is not an atomic read/modify/write operation across
 * Android JS runtimes, so the claim itself is serialized by SQLite.
 */
export async function claimAutomaticCollection(
  attemptAtMs: number,
  intervalMs: number,
): Promise<boolean> {
  const db = await getDatabase();
  let claimed = false;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT OR IGNORE INTO daily_monitor_automatic_gate (id, last_attempt_ms)
       VALUES (1, 0)`,
    );

    const result = await db.runAsync(
      `UPDATE daily_monitor_automatic_gate
       SET last_attempt_ms = ?
       WHERE id = 1
         AND (? - last_attempt_ms) >= ?`,
      attemptAtMs,
      attemptAtMs,
      intervalMs,
    );

    claimed = result.changes > 0;
  });

  return claimed;
}
