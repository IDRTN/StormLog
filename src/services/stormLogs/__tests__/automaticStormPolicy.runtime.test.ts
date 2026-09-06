import {
  AUTO_STOP_REVIEW_GRACE_MS,
  LIGHTNING_AUTO_START_RADIUS_KM,
  LIGHTNING_AUTO_STOP_RADIUS_KM,
  classifyAutomaticStormEvidence,
  isLightningAutoStartCandidate,
  isLightningStillRelevant,
  isStopReviewGraceExpired,
} from '../automaticStormPolicy';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  assert(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

function test(name: string, fn: () => void): void {
  fn();
  console.log(`PASS: ${name}`);
}

test('20-mile boundary auto-starts and anything farther does not', () => {
  assertEqual(
    isLightningAutoStartCandidate({ count: 1, nearestDistanceKm: LIGHTNING_AUTO_START_RADIUS_KM }),
    true,
    '20-mile boundary',
  );
  assertEqual(
    isLightningAutoStartCandidate({ count: 1, nearestDistanceKm: LIGHTNING_AUTO_START_RADIUS_KM + 0.01 }),
    false,
    'outside start radius',
  );
});

test('20/30-mile hysteresis prevents threshold flapping', () => {
  const between = (LIGHTNING_AUTO_START_RADIUS_KM + LIGHTNING_AUTO_STOP_RADIUS_KM) / 2;
  assertEqual(
    isLightningAutoStartCandidate({ count: 1, nearestDistanceKm: between }),
    false,
    '25-mile lightning cannot create a new event',
  );
  assertEqual(
    isLightningStillRelevant({ count: 1, nearestDistanceKm: between }),
    true,
    '25-mile lightning keeps an existing event active',
  );
});

test('30-mile boundary remains active and farther lightning is clear', () => {
  assertEqual(
    isLightningStillRelevant({ count: 1, nearestDistanceKm: LIGHTNING_AUTO_STOP_RADIUS_KM }),
    true,
    '30-mile boundary',
  );
  assertEqual(
    isLightningStillRelevant({ count: 1, nearestDistanceKm: LIGHTNING_AUTO_STOP_RADIUS_KM + 0.01 }),
    false,
    'outside stop radius',
  );
});

test('active NWS or lightning evidence keeps recording', () => {
  assertEqual(classifyAutomaticStormEvidence({
    nwsFresh: true,
    nwsActive: true,
    lightningFresh: true,
    lightningRelevant: false,
  }), 'active', 'NWS trigger active');
  assertEqual(classifyAutomaticStormEvidence({
    nwsFresh: true,
    nwsActive: false,
    lightningFresh: true,
    lightningRelevant: true,
  }), 'active', 'lightning trigger active');
});

test('stale evidence can never be treated as an all-clear', () => {
  assertEqual(classifyAutomaticStormEvidence({
    nwsFresh: false,
    nwsActive: false,
    lightningFresh: true,
    lightningRelevant: false,
  }), 'unknown', 'stale NWS evidence');
  assertEqual(classifyAutomaticStormEvidence({
    nwsFresh: true,
    nwsActive: false,
    lightningFresh: false,
    lightningRelevant: false,
  }), 'unknown', 'stale lightning evidence');
});

test('both fresh and inactive streams form a clear state', () => {
  assertEqual(classifyAutomaticStormEvidence({
    nwsFresh: true,
    nwsActive: false,
    lightningFresh: true,
    lightningRelevant: false,
  }), 'clear', 'fresh all-clear');
});

test('unanswered stop review waits full 30-minute grace', () => {
  const requested = 1_000_000;
  assertEqual(
    isStopReviewGraceExpired(requested, requested + AUTO_STOP_REVIEW_GRACE_MS - 1),
    false,
    'one millisecond before grace',
  );
  assertEqual(
    isStopReviewGraceExpired(requested, requested + AUTO_STOP_REVIEW_GRACE_MS),
    true,
    'grace boundary',
  );
});

console.log('Automatic storm lifecycle policy tests passed.');
