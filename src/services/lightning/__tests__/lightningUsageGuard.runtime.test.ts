import {
  applyLightningUsageResponse,
  createEmptyLightningUsageSnapshot,
  evaluateLightningUsage,
  getEffectiveRemaining,
  parseXweatherReset,
} from '../lightningUsageGuard';

function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(message ?? `Expected ${String(expected)}, received ${String(actual)}`);
  }
}

const now = Date.UTC(2026, 8, 4, 4, 0, 0);

const empty = createEmptyLightningUsageSnapshot();
assertEqual(getEffectiveRemaining(empty), 15_000);
assertEqual(evaluateLightningUsage(empty, now).allowed, true);

const normal = applyLightningUsageResponse(empty, {
  costTokens: 10,
  periodLimit: 15_000,
  periodRemaining: 11_990,
  periodResetAtMs: now + 20 * 24 * 60 * 60_000,
  periodType: 'month',
}, now);
assertEqual(normal.lastCostTokens, 10);
assertEqual(normal.periodRemaining, 11_990);
assertEqual(normal.locallyTrackedTokens, 10);
assertEqual(evaluateLightningUsage(normal, now).reason, 'ok');

const soft = {
  ...normal,
  periodRemaining: 2_900,
  nextAllowedAtMs: 0,
};
const softDecision = evaluateLightningUsage(soft, now);
assertEqual(softDecision.allowed, true);
assertEqual(softDecision.reason, 'soft_throttle');
const softUpdated = applyLightningUsageResponse(soft, {
  costTokens: 10,
  periodLimit: 15_000,
  periodRemaining: 2_890,
  periodResetAtMs: soft.periodResetAtMs,
  periodType: 'month',
}, now);
const throttledDecision = evaluateLightningUsage(softUpdated, now + 60_000);
assertEqual(throttledDecision.allowed, false);
assertEqual(throttledDecision.reason, 'soft_throttle');

const hard = {
  ...normal,
  periodRemaining: 1_505,
};
const hardDecision = evaluateLightningUsage(hard, now);
assertEqual(hardDecision.allowed, false);
assertEqual(hardDecision.reason, 'reserve_protected');
assertEqual(hardDecision.reserveTokens, 1_500);

const reset = {
  ...hard,
  periodResetAtMs: now - 1,
};
const afterReset = evaluateLightningUsage(reset, now);
assertEqual(afterReset.allowed, true);
assertEqual(afterReset.reason, 'ok');

assertEqual(parseXweatherReset('60', now), now + 60_000);
assertEqual(parseXweatherReset(String(Math.floor(now / 1000) + 3600), now), now + 3_600_000);
assertEqual(parseXweatherReset(new Date(now + 7_200_000).toUTCString(), now), now + 7_200_000);

console.log('lightningUsageGuard.runtime.test: PASS');
