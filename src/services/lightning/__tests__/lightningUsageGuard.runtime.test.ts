import assert from 'node:assert/strict';
import {
  applyLightningUsageResponse,
  createEmptyLightningUsageSnapshot,
  evaluateLightningUsage,
  getEffectiveRemaining,
  parseXweatherReset,
} from '../lightningUsageGuard';

const now = Date.UTC(2026, 8, 4, 4, 0, 0);

const empty = createEmptyLightningUsageSnapshot();
assert.equal(getEffectiveRemaining(empty), 15_000);
assert.equal(evaluateLightningUsage(empty, now).allowed, true);

const normal = applyLightningUsageResponse(empty, {
  costTokens: 10,
  periodLimit: 15_000,
  periodRemaining: 11_990,
  periodResetAtMs: now + 20 * 24 * 60 * 60_000,
  periodType: 'month',
}, now);
assert.equal(normal.lastCostTokens, 10);
assert.equal(normal.periodRemaining, 11_990);
assert.equal(normal.locallyTrackedTokens, 10);
assert.equal(evaluateLightningUsage(normal, now).reason, 'ok');

const soft = {
  ...normal,
  periodRemaining: 2_900,
  nextAllowedAtMs: 0,
};
const softDecision = evaluateLightningUsage(soft, now);
assert.equal(softDecision.allowed, true);
assert.equal(softDecision.reason, 'soft_throttle');
const softUpdated = applyLightningUsageResponse(soft, {
  costTokens: 10,
  periodLimit: 15_000,
  periodRemaining: 2_890,
  periodResetAtMs: soft.periodResetAtMs,
  periodType: 'month',
}, now);
const throttledDecision = evaluateLightningUsage(softUpdated, now + 60_000);
assert.equal(throttledDecision.allowed, false);
assert.equal(throttledDecision.reason, 'soft_throttle');

const hard = {
  ...normal,
  periodRemaining: 1_505,
};
const hardDecision = evaluateLightningUsage(hard, now);
assert.equal(hardDecision.allowed, false);
assert.equal(hardDecision.reason, 'reserve_protected');
assert.equal(hardDecision.reserveTokens, 1_500);

const reset = {
  ...hard,
  periodResetAtMs: now - 1,
};
const afterReset = evaluateLightningUsage(reset, now);
assert.equal(afterReset.allowed, true);
assert.equal(afterReset.reason, 'ok');

assert.equal(parseXweatherReset('60', now), now + 60_000);
assert.equal(parseXweatherReset(String(Math.floor(now / 1000) + 3600), now), now + 3_600_000);
assert.equal(parseXweatherReset(new Date(now + 7_200_000).toUTCString(), now), now + 7_200_000);

console.log('lightningUsageGuard.runtime.test: PASS');
