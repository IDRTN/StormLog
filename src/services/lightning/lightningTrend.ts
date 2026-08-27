// ============================================================
// Lightning Trend — Pure deterministic trend calculation
//
// No database dependencies. Fully testable in isolation.
// ============================================================

export type LightningTrend = 'NONE' | 'DECREASING' | 'STABLE' | 'INCREASING';

/**
 * Deterministic trend calculation from two 5-minute windows.
 *
 * Trend semantics:
 * - recent = event count in [now-5m, now]
 * - prior  = event count in [now-10m, now-5m)
 *
 * Rules (evaluated in order):
 * 1. recent == 0 AND prior == 0 → NONE
 * 2. recent == 0 AND prior > 0  → DECREASING  (zero-transition)
 * 3. recent > 0  AND prior == 0 → INCREASING  (zero-transition)
 * 4. recent > prior * 1.5        → INCREASING  (needs >= 3 recent events)
 * 5. recent < prior * 0.5        → DECREASING  (needs >= 3 recent events)
 * 6. Otherwise                   → STABLE
 *
 * Minimum-event safeguard:
 * - Rules 4 and 5 require at least 3 events in the recent window.
 * - If recent < 3 and there is activity in either window, return STABLE.
 * - Zero-transition rules (2, 3) remain meaningful regardless of count.
 */
export function calculateTrend(
  recentCount: number,
  priorCount: number,
): LightningTrend {
  if (recentCount === 0 && priorCount === 0) return 'NONE';
  if (recentCount === 0 && priorCount > 0) return 'DECREASING';
  if (recentCount > 0 && priorCount === 0) return 'INCREASING';

  if (recentCount >= 3) {
    if (recentCount > priorCount * 1.5) return 'INCREASING';
    if (recentCount < priorCount * 0.5) return 'DECREASING';
  }

  return 'STABLE';
}
