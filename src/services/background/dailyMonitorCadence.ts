const MAX_CADENCE_JITTER_MS = 3 * 60 * 1000;

/**
 * Minimum age a previous automatic attempt/success must reach before the next
 * scheduled collection is admitted.
 *
 * Native AlarmManager owns elapsed cadence, while Headless JS startup latency
 * varies from cycle to cycle. Requiring a full interval between JavaScript
 * entry times can therefore reject a legitimate alarm that arrived on time at
 * the native layer. The bounded jitter allowance blocks duplicate recovery
 * callbacks without turning normal process-start jitter into a missed slot.
 */
export function minimumAutomaticCadenceAgeMs(intervalMs: number): number {
  const safeIntervalMs = Math.max(60_000, intervalMs);
  const jitterAllowanceMs = Math.min(
    MAX_CADENCE_JITTER_MS,
    Math.max(30_000, Math.floor(safeIntervalMs / 5)),
  );
  return Math.max(30_000, safeIntervalMs - jitterAllowanceMs);
}
