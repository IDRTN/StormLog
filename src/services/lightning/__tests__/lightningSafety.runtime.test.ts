import {
  bearingToCompass,
  calculateBearingDegrees,
  getLightningSafetyState,
} from '../lightningSafety';

function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) throw new Error(message ?? `Expected ${String(expected)}, received ${String(actual)}`);
}

function assertNear(actual: number | null, expected: number, tolerance: number, message?: string): void {
  if (actual == null || Math.abs(actual - expected) > tolerance) {
    throw new Error(message ?? `Expected ${expected}±${tolerance}, received ${String(actual)}`);
  }
}

function run(): void {
  const nowMs = Date.UTC(2026, 8, 4, 3, 0, 0);
  const freshCollection = nowMs - 60_000;
  const recentEvent = nowMs - 2 * 60_000;

  assertEqual(bearingToCompass(0), 'N');
  assertEqual(bearingToCompass(91), 'E');
  assertEqual(bearingToCompass(225), 'SW');
  assertNear(calculateBearingDegrees(40, -82, 41, -82), 0, 0.5);

  assertEqual(getLightningSafetyState({
    nowMs,
    providerConfigured: false,
    nearestDistanceKm: null,
    nearestBearingDegrees: null,
    latestEventTimestampMs: null,
    lastSuccessfulCollectionMs: null,
    lastAttemptMs: null,
    lastError: null,
  }).level, 'UNAVAILABLE');

  assertEqual(getLightningSafetyState({
    nowMs,
    providerConfigured: true,
    nearestDistanceKm: 5,
    nearestBearingDegrees: 180,
    latestEventTimestampMs: recentEvent,
    lastSuccessfulCollectionMs: freshCollection,
    lastAttemptMs: freshCollection,
  }).level, 'VERY_CLOSE');

  assertEqual(getLightningSafetyState({
    nowMs,
    providerConfigured: true,
    nearestDistanceKm: 12,
    nearestBearingDegrees: 90,
    latestEventTimestampMs: recentEvent,
    lastSuccessfulCollectionMs: freshCollection,
    lastAttemptMs: freshCollection,
  }).level, 'NEARBY');

  assertEqual(getLightningSafetyState({
    nowMs,
    providerConfigured: true,
    nearestDistanceKm: 30,
    nearestBearingDegrees: 270,
    latestEventTimestampMs: recentEvent,
    lastSuccessfulCollectionMs: freshCollection,
    lastAttemptMs: freshCollection,
  }).level, 'IN_AREA');

  assertEqual(getLightningSafetyState({
    nowMs,
    providerConfigured: true,
    nearestDistanceKm: 48,
    nearestBearingDegrees: 45,
    latestEventTimestampMs: recentEvent,
    lastSuccessfulCollectionMs: freshCollection,
    lastAttemptMs: freshCollection,
  }).level, 'CLEAR');

  assertEqual(getLightningSafetyState({
    nowMs,
    providerConfigured: true,
    nearestDistanceKm: 5,
    nearestBearingDegrees: 180,
    latestEventTimestampMs: recentEvent,
    lastSuccessfulCollectionMs: nowMs - 21 * 60_000,
    lastAttemptMs: nowMs - 21 * 60_000,
  }).level, 'STALE');

  assertEqual(getLightningSafetyState({
    nowMs,
    providerConfigured: true,
    nearestDistanceKm: 5,
    nearestBearingDegrees: 180,
    latestEventTimestampMs: nowMs - 31 * 60_000,
    lastSuccessfulCollectionMs: freshCollection,
    lastAttemptMs: freshCollection,
  }).level, 'CLEAR');

  console.log('lightningSafety.runtime.test passed');
}

run();
