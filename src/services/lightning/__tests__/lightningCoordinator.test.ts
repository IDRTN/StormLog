// Lightning Coordinator Tests
// Uses injected fake dependencies — no network, no database, no timers

import { LightningCoordinator } from '../lightningCoordinator';
import type {
  LightningCoordinatorDependencies,
  LightningProviderEvent,
  LightningCollectionResult,
} from '../lightningCoordinator';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(
  actual: unknown,
  expected: unknown,
  message = 'values differ',
) {
  assert(
    actual === expected,
    `${message}: expected ${String(expected)}, got ${String(actual)}`,
  );
}

async function test(
  name: string,
  fn: () => Promise<void> | void,
) {
  try {
    await fn();
    passed++;
    console.log('PASS: ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL: ' + name);
    console.log(
      '  ' + (e instanceof Error ? e.message : String(e)),
    );
  }
}

// ---- Fake dependencies ----

function fakeEvent(
  overrides: Partial<LightningProviderEvent> = {},
): LightningProviderEvent {
  return {
    providerEventId: 'evt-001',
    timestamp: 1_700_000_000_000,
    latitude: 35.0,
    longitude: -97.0,
    providerTerminology: 'flash',
    classification: null,
    polarity: null,
    peakCurrentAmperes: null,
    multiplicity: null,
    sensorCount: null,
    accuracyKm: null,
    rawPayload: null,
    ...overrides,
  };
}

type FakeState = {
  fetchCalls: Array<{
    latitude: number;
    longitude: number;
    radiusKm: number;
    sinceMs: number;
    untilMs: number;
  }>;
  fetchEvents: LightningProviderEvent[];
  fetchError: Error | null;
  dbInserted: number;
  dbInsertCalls: Array<Array<Record<string, unknown>>>;
  dbError: Error | null;
};

function fakeDependencies(state?: Partial<FakeState>): {
  deps: LightningCoordinatorDependencies;
  state: FakeState;
} {
  const s: FakeState = {
    fetchCalls: [],
    fetchEvents: [],
    fetchError: null,
    dbInserted: 0,
    dbInsertCalls: [],
    dbError: null,
    ...state,
  };

  const deps: LightningCoordinatorDependencies = {
    adapter: {
      providerName: 'test-provider',
      fetchEventsNearPoint: async (latitude, longitude, radiusKm, sinceMs, untilMs) => {
        s.fetchCalls.push({ latitude, longitude, radiusKm, sinceMs, untilMs });
        if (s.fetchError) throw s.fetchError;
        return { events: s.fetchEvents, fetchedAt: Date.now() };
      },
    },
    database: {
      insertLightningEvents: async (events) => {
        s.dbInsertCalls.push(events);
        if (s.dbError) throw s.dbError;
        return s.dbInserted;
      },
    },
    now: () => 1_000_000_000,
  };

  return { deps, state: s };
}

function makeContext(
  overrides: Record<string, unknown> = {},
) {
  return {
    location: { latitude: 35.1, longitude: -97.1 },
    stormEventId: null,
    reason: 'manual' as const,
    ...overrides,
  };
}

// ---- Tests ----

void (async function main() {
  // --- 1. Successful collection ---
  await test('successful collection returns success', async () => {
    const { deps, state } = fakeDependencies({
      fetchEvents: [fakeEvent()],
      dbInserted: 1,
    });
    const coord = new LightningCoordinator(deps, { now: () => 1_000_000_000 });
    const result = await coord.collectLightning(makeContext());
    assert(result.success, 'collection succeeded');
    assertEqual(result.providerEventCount, 1);
    assertEqual(result.insertedCount, 1);
  });

  // --- 2. Provider receives correct location ---
  await test('provider receives correct location', async () => {
    const { deps, state } = fakeDependencies({ dbInserted: 0 });
    const coord = new LightningCoordinator(deps, { now: () => 1_000_000_000 });
    await coord.collectLightning(
      makeContext({ location: { latitude: 40.5, longitude: -82.3 } }),
    );
    assertEqual(state.fetchCalls.length, 1);
    assertEqual(state.fetchCalls[0].latitude, 40.5);
    assertEqual(state.fetchCalls[0].longitude, -82.3);
  });

  // --- 3. Provider receives correct radius ---
  await test('provider receives default 50km radius', async () => {
    const { deps, state } = fakeDependencies({ dbInserted: 0 });
    const coord = new LightningCoordinator(deps, { now: () => 1_000_000_000 });
    await coord.collectLightning(makeContext());
    assertEqual(state.fetchCalls[0].radiusKm, 50);
  });

  await test('provider receives custom radius', async () => {
    const { deps, state } = fakeDependencies({ dbInserted: 0 });
    const coord = new LightningCoordinator(deps, {
      now: () => 1_000_000_000,
      radiusKm: 100,
    });
    await coord.collectLightning(makeContext());
    assertEqual(state.fetchCalls[0].radiusKm, 100);
  });

  // --- 4. Provider receives correct since/until window ---
  await test('provider receives correct query window', async () => {
    const { deps, state } = fakeDependencies({ dbInserted: 0 });
    const now = 1_000_000_000;
    const coord = new LightningCoordinator(deps, { now: () => now });
    await coord.collectLightning(
      makeContext({ sinceMs: now - 60_000, untilMs: now }),
    );
    assertEqual(state.fetchCalls[0].sinceMs, now - 60_000);
    assertEqual(state.fetchCalls[0].untilMs, now);
  });

  // --- 5. Initial collection uses configured lookback ---
  await test('initial collection uses 5-minute lookback', async () => {
    const { deps, state } = fakeDependencies({ dbInserted: 0 });
    const now = 1_000_000_000;
    const coord = new LightningCoordinator(deps, {
      now: () => now,
      initialLookbackMs: 300_000,
    });
    await coord.collectLightning(makeContext());
    assertEqual(state.fetchCalls[0].sinceMs, now - 300_000);
    assertEqual(state.fetchCalls[0].untilMs, now);
  });

  // --- 6. Subsequent collection uses last successful minus overlap ---
  await test('subsequent collection uses overlap from last success', async () => {
    const { deps, state } = fakeDependencies({ dbInserted: 1 });
    const now = 1_000_000_000;
    const coord = new LightningCoordinator(deps, {
      overlapMs: 180_000,
    });
    // First successful collection
    await coord.collectLightning(makeContext());
    assertEqual(state.fetchCalls.length, 1);

    // Second collection — should use last success - overlap
    const now2 = now + 300_000;
    (deps.now as () => number) = () => now2;
    await coord.collectLightning(makeContext());
    assertEqual(state.fetchCalls.length, 2);
    assertEqual(state.fetchCalls[1].sinceMs, now - 180_000);
    assertEqual(state.fetchCalls[1].untilMs, now2);
  });

  // --- 7. Failed collection does not advance lastSuccessfulCollectionMs ---
  await test('failed collection does not advance last success', async () => {
    const { deps, state } = fakeDependencies({
      fetchError: new Error('network down'),
      dbInserted: 0,
    });
    const now = 1_000_000_000;
    const coord = new LightningCoordinator(deps, { now: () => now });
    const result = await coord.collectLightning(makeContext());
    assert(!result.success, 'collection failed');
    assertEqual(coord.getState().lastSuccessfulCollectionMs, null);
  });

  // --- 8. Successful collection advances lastSuccessfulCollectionMs ---
  await test('successful collection advances last success', async () => {
    const { deps, state } = fakeDependencies({
      fetchEvents: [fakeEvent()],
      dbInserted: 1,
    });
    const now = 1_000_000_000;
    const coord = new LightningCoordinator(deps, { now: () => now });
    await coord.collectLightning(makeContext());
    assertEqual(coord.getState().lastSuccessfulCollectionMs, now);
  });

  // --- 9. In-flight guard prevents concurrent calls ---
  await test('in-flight guard prevents concurrent provider calls', async () => {
    let fetchCount = 0;
    const { deps } = fakeDependencies({ dbInserted: 0 });
    deps.adapter!.fetchEventsNearPoint = async () => {
      fetchCount++;
      await new Promise((r) => setTimeout(r, 50));
      return { events: [], fetchedAt: Date.now() };
    };
    const coord = new LightningCoordinator(deps, { now: () => 1_000_000_000 });

    const p1 = coord.collectLightning(makeContext());
    const p2 = coord.collectLightning(makeContext());

    const [r1, r2] = await Promise.all([p1, p2]);
    assertEqual(fetchCount, 1, 'only one provider call');
    assert(r1 === r2, 'same promise returned');
  });

  // --- 10. In-flight clears after success ---
  await test('in-flight clears after success', async () => {
    const { deps } = fakeDependencies({
      fetchEvents: [fakeEvent()],
      dbInserted: 1,
    });
    const coord = new LightningCoordinator(deps, { now: () => 1_000_000_000 });
    await coord.collectLightning(makeContext());
    assertEqual(coord.getState().inFlight, false);
  });

  // --- 11. In-flight clears after failure ---
  await test('in-flight clears after failure', async () => {
    const { deps } = fakeDependencies({
      fetchError: new Error('boom'),
    });
    const coord = new LightningCoordinator(deps, { now: () => 1_000_000_000 });
    await coord.collectLightning(makeContext());
    assertEqual(coord.getState().inFlight, false);
  });

  // --- 12. Automatic gate prevents rapid duplicate automatic calls ---
  await test('automatic gate prevents rapid duplicate calls', async () => {
    const { deps, state } = fakeDependencies({ dbInserted: 0 });
    const now = 1_000_000_000;
    const coord = new LightningCoordinator(deps, {
      now: () => now,
      automaticGateMs: 60_000,
    });
    await coord.collectAutomatic(makeContext());
    assertEqual(state.fetchCalls.length, 1, 'first auto call went through');

    // Second auto call within gate — should be skipped
    const result = await coord.collectAutomatic(makeContext());
    assertEqual(state.fetchCalls.length, 1, 'second auto call skipped');
    assertEqual(result.providerEventCount, 0);
  });

  // --- 13. Manual collection bypasses automatic gate ---
  await test('manual collection bypasses automatic gate', async () => {
    const { deps, state } = fakeDependencies({ dbInserted: 0 });
    const now = 1_000_000_000;
    const coord = new LightningCoordinator(deps, {
      now: () => now,
      automaticGateMs: 60_000,
    });
    await coord.collectAutomatic(makeContext());
    assertEqual(state.fetchCalls.length, 1);

    // Manual call should still work
    await coord.collectManual(makeContext());
    assertEqual(state.fetchCalls.length, 2, 'manual call went through');
  });

  // --- 14. Rate-limit response establishes backoff ---
  await test('rate-limit response establishes backoff', async () => {
    const rateLimitError = Object.assign(new Error('429 Too Many'), {
      status: 429,
      retryAfterMs: 30_000,
    });
    const { deps, state } = fakeDependencies({
      fetchError: rateLimitError,
    });
    const now = 1_000_000_000;
    const coord = new LightningCoordinator(deps, { now: () => now });
    await coord.collectAutomatic(makeContext());
    assertEqual(coord.getState().backoffUntilMs, now + 30_000);
  });

  // --- 15. Automatic collection skipped during backoff ---
  await test('automatic collection skipped during backoff', async () => {
    const rateLimitError = Object.assign(new Error('429'), {
      status: 429,
      retryAfterMs: 30_000,
    });
    const { deps, state } = fakeDependencies({
      fetchError: rateLimitError,
    });
    const now = 1_000_000_000;
    const coord = new LightningCoordinator(deps, { now: () => now });

    // First call triggers backoff
    await coord.collectAutomatic(makeContext());
    state.fetchError = null; // Clear the error
    state.fetchEvents = [fakeEvent()];
    state.dbInserted = 1;

    // Second call within backoff — should skip
    const result = await coord.collectAutomatic(makeContext());
    assertEqual(state.fetchCalls.length, 1, 'second call skipped during backoff');
    assertEqual(result.providerEventCount, 0);
  });

  // --- 16. Valid events are persisted ---
  await test('valid events are persisted to database', async () => {
    const { deps, state } = fakeDependencies({
      fetchEvents: [fakeEvent({ providerEventId: 'e1' }), fakeEvent({ providerEventId: 'e2' })],
      dbInserted: 2,
    });
    const coord = new LightningCoordinator(deps, { now: () => 1_000_000_000 });
    const result = await coord.collectLightning(makeContext());
    assertEqual(state.dbInsertCalls.length, 1);
    assertEqual(state.dbInsertCalls[0].length, 2);
    assertEqual(result.insertedCount, 2);
  });

  // --- 17. Invalid event coordinates are skipped ---
  await test('events with invalid coordinates are skipped', async () => {
    const { deps, state } = fakeDependencies({ dbInserted: 0 });
    deps.adapter!.fetchEventsNearPoint = async () => ({
      events: [
        fakeEvent({ providerEventId: 'good', latitude: 35, longitude: -97 }),
        fakeEvent({ providerEventId: 'bad-lat', latitude: 999, longitude: -97 }),
        fakeEvent({ providerEventId: 'bad-lon', latitude: 35, longitude: 999 }),
        fakeEvent({ providerEventId: 'nan', latitude: NaN, longitude: -97 }),
      ],
      fetchedAt: Date.now(),
    })
    const coord = new LightningCoordinator(deps, { now: () => 1_000_000_000 });
    await coord.collectLightning(makeContext());
    // Only the valid event + the NaN-latitude event should be in db calls
    // Actually NaN check: Number.isFinite(NaN) = false, so it's skipped
    assertEqual(state.dbInsertCalls[0].length, 1);
    assertEqual(state.dbInsertCalls[0][0].providerEventId, 'good');
  });

  // --- 18. Malformed events do not fail valid events ---
  await test('provider error returns structured failure', async () => {
    const { deps } = fakeDependencies({
      fetchError: new Error('provider exploded'),
    });
    const coord = new LightningCoordinator(deps, { now: () => 1_000_000_000 });
    const result = await coord.collectLightning(makeContext());
    assert(!result.success, 'provider error should fail');
    assert((result.error ?? '').includes('provider exploded'), 'error message preserved');
  });

  // --- 19. stormEventId is preserved when supplied ---
  await test('stormEventId is preserved in persisted events', async () => {
    const { deps, state } = fakeDependencies({
      fetchEvents: [fakeEvent()],
      dbInserted: 1,
    });
    const coord = new LightningCoordinator(deps, { now: () => 1_000_000_000 });
    await coord.collectLightning(
      makeContext({ stormEventId: 42 }),
    );
    assertEqual(state.dbInsertCalls[0][0].stormEventId, 42);
  });

  // --- 20. NULL stormEventId is allowed ---
  await test('null stormEventId is allowed', async () => {
    const { deps, state } = fakeDependencies({
      fetchEvents: [fakeEvent()],
      dbInserted: 1,
    });
    const coord = new LightningCoordinator(deps, { now: () => 1_000_000_000 });
    await coord.collectLightning(makeContext({ stormEventId: null }));
    assertEqual(state.dbInsertCalls[0][0].stormEventId, null);
  });

  // --- 21. Observer coordinates are persisted ---
  await test('observer coordinates from collection context are persisted', async () => {
    const { deps, state } = fakeDependencies({
      fetchEvents: [fakeEvent()],
      dbInserted: 1,
    });
    const coord = new LightningCoordinator(deps, { now: () => 1_000_000_000 });
    await coord.collectLightning(
      makeContext({ location: { latitude: 40.0, longitude: -80.0 } }),
    );
    assertEqual(state.dbInsertCalls[0][0].observerLatitude, 40.0);
    assertEqual(state.dbInsertCalls[0][0].observerLongitude, -80.0);
  });

  // --- 22. distanceToObserverKm is calculated using haversine ---
  await test('distanceToObserverKm is calculated with haversine', async () => {
    const { deps, state } = fakeDependencies({
      fetchEvents: [
        fakeEvent({ latitude: 35.0, longitude: -97.0 }),
      ],
      dbInserted: 1,
    });
    let haversineCalled = false;
    deps.haversine = (lat1, lon1, lat2, lon2) => {
      haversineCalled = true;
      assertEqual(lat1, 35.1);
      assertEqual(lon1, -97.1);
      assertEqual(lat2, 35.0);
      assertEqual(lon2, -97.0);
      return 12.34;
    };
    const coord = new LightningCoordinator(deps, { now: () => 1_000_000_000 });
    await coord.collectLightning(
      makeContext({ location: { latitude: 35.1, longitude: -97.1 } }),
    );
    assert(haversineCalled, 'haversine was called');
    assertEqual(state.dbInsertCalls[0][0].distanceToObserverKm, 12.34);
  });

  // --- 23. No provider adapter returns failure ---
  await test('missing adapter returns failure', async () => {
    const { deps } = fakeDependencies();
    deps.adapter = null;
    const coord = new LightningCoordinator(deps, { now: () => 1_000_000_000 });
    const result = await coord.collectLightning(makeContext());
    assert(!result.success, 'missing adapter should fail');
    assert((result.error ?? '').includes('No lightning provider'), 'error message preserved');
  });

  // --- 24. All entry points converge ---
  await test('collectAutomatic and collectManual converge on collectLightning', async () => {
    const { deps, state } = fakeDependencies({ dbInserted: 0 });
    const coord = new LightningCoordinator(deps, { now: () => 1_000_000_000 });

    await coord.collectAutomatic(makeContext());
    assertEqual(state.fetchCalls.length, 1);
    assertEqual(state.fetchCalls[0].latitude, 35.1);

    await coord.collectManual(makeContext());
    assertEqual(state.fetchCalls.length, 2);
  });

  // --- 25. Unexpected errors still clear in-flight state ---
  await test('unexpected error clears in-flight state', async () => {
    const { deps } = fakeDependencies();
    deps.database.insertLightningEvents = async () => {
      throw new Error('unexpected db crash');
    };
    deps.adapter!.fetchEventsNearPoint = async () => ({ events: [fakeEvent()], fetchedAt: Date.now() });
    const coord = new LightningCoordinator(deps, { now: () => 1_000_000_000 });
    await coord.collectLightning(makeContext());
    assertEqual(coord.getState().inFlight, false);
  });

  // --- 26. Listeners receive state changes ---
  await test('listeners receive state changes', async () => {
    const { deps } = fakeDependencies({ dbInserted: 0 });
    const coord = new LightningCoordinator(deps, { now: () => 1_000_000_000 });
    const states: boolean[] = [];
    coord.subscribe((s) => states.push(s.inFlight));
    await coord.collectLightning(makeContext());
    // Should have received: false (initial), true (in-flight), false (done)
    assert(states.includes(true), 'saw in-flight = true');
    assert(states[states.length - 1] === false, 'ended with in-flight = false');
  });

  // --- 27. Duplicate database results reported correctly ---
  await test('duplicate database results reflected in counts', async () => {
    const { deps, state } = fakeDependencies({
      fetchEvents: [fakeEvent({ providerEventId: 'e1' }), fakeEvent({ providerEventId: 'e2' })],
      dbInserted: 1, // 1 of 2 actually inserted
    });
    const coord = new LightningCoordinator(deps, { now: () => 1_000_000_000 });
    const result = await coord.collectLightning(makeContext());
    assertEqual(result.providerEventCount, 2);
    assertEqual(result.insertedCount, 1);
    assertEqual(result.skippedCount, 1);
  });

  console.log('\nLightning Coordinator tests: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
})();
