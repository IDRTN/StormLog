// ============================================================
// Local timezone date utilities
//
// ALL date logic in the app uses these functions to ensure
// consistent local-date handling. No hard-coded timezones.
// ============================================================

/**
 * Get the local date string (YYYY-MM-DD) for a given Date.
 * Uses the device's local timezone via Date.getMonth/getDate.
 */
export function getLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get the local date string for "right now".
 */
export function getTodayLocalDateString(): string {
  return getLocalDateString(new Date());
}

/**
 * Get the epoch timestamp (ms) for the START of a local calendar day (00:00:00.000).
 *
 * CRITICAL: Uses 'YYYY-MM-DDT00:00:00' (no Z suffix) so JavaScript creates
 * a Date in the device's local timezone, NOT UTC.
 */
export function getLocalDayStart(dateString: string): number {
  return new Date(`${dateString}T00:00:00`).getTime();
}

/**
 * Get the epoch timestamp (ms) for the END of a local calendar day
 * (= next day 00:00:00.000). Exclusive — use with `timestamp < end`.
 */
export function getLocalDayEnd(dateString: string): number {
  return getLocalDayStart(dateString) + 86400000;
}

/**
 * Get the milliseconds remaining until the next local midnight.
 * Useful for scheduling a collection that aligns to calendar-day boundaries.
 */
export function msUntilNextMidnight(): number {
  const now = Date.now();
  const today = getLocalDateString(new Date());
  const nextMidnight = getLocalDayEnd(today);
  return nextMidnight - now;
}

/**
 * Round an interval-anchored time UP to the next clean interval boundary.
 *
 * Example: now=11:07, intervalMs=900000 (15 min) → next=11:15 (8 min from now)
 *          now=11:52, intervalMs=900000 (15 min) → next=12:00 (8 min from now)
 *
 * Returns the epoch ms of the next clean boundary.
 * If we are exactly ON a boundary, returns the next one (now + intervalMs).
 */
export function getNextIntervalBoundary(intervalMs: number): number {
  const now = Date.now();
  const today = getLocalDateString(new Date());
  const dayStart = getLocalDayStart(today);
  // How many ms since local midnight?
  const msSinceMidnight = now - dayStart;
  // How many full intervals have elapsed since midnight?
  const intervalsSinceMidnight = Math.floor(msSinceMidnight / intervalMs);
  // The next boundary is midnight + (intervalsSinceMidnight + 1) * intervalMs
  const nextBoundary = dayStart + (intervalsSinceMidnight + 1) * intervalMs;
  // Safety: if the boundary is in the past (shouldn't happen, but guard),
  // advance by one interval
  if (nextBoundary <= now) {
    return now + intervalMs;
  }
  return nextBoundary;
}

/**
 * Format a Date as a human-readable local timestamp for logging.
 */
export function formatLocalDateTime(date: Date): string {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}
