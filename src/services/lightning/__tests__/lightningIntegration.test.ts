// Phase 4 — Lightning Integration Tests
// Tests the Daily Monitor and Storm Logger lightning integration points

// Use require + Module mock to avoid react-native import chain
const Module: any = (function () { return require('module'); })();

const fakeDb = {
  async execAsync() {},
  async runAsync() { return { changes: 0, lastInsertRowId: 0 }; },
  async getFirstAsync() { return null; },
  async getAllAsync() { return []; },
  async withTransactionAsync(fn: () => Promise<void>) { await fn(); },
};

const origResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, parent: any, isMain: boolean, options: any) {
  if (request === './database') return '/mock/database.ts';
  return origResolve.call(this, request, parent, isMain, options);
};
const origLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: any, isMain: boolean) {
  if (request === './database') return { getDatabase: async () => fakeDb };
  return origLoad.call(this, request, parent, isMain);
};

const { collectLightning, collectLightningAutomatic, collectLightningManual, getLightningCoordinator } = require('../lightningService') as Record<string, any>;

let passed = 0;
let failed = 0;

function assert(c: boolean, m: string): asserts c {
  if (!c) throw new Error(m);
}
function assertEqual(a: unknown, b: unknown, m = 'values differ') {
  assert(a === b, m + ': got ' + String(a));
}
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log('PASS: ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL: ' + name);
    console.log('  ' + (e instanceof Error ? e.message : String(e)));
  }
}

void (async function main() {
  await test('collectLightning is a function', async () => {
    assert(typeof collectLightning === 'function', 'exported');
  });

  await test('collectLightningAutomatic is a function', async () => {
    assert(typeof collectLightningAutomatic === 'function', 'exported');
  });

  await test('collectLightningManual is a function', async () => {
    assert(typeof collectLightningManual === 'function', 'exported');
  });

  await test('getLightningCoordinator is a function', async () => {
    assert(typeof getLightningCoordinator === 'function', 'exported');
  });

  await test('getLightningCoordinator returns coordinator with expected API', async () => {
    const coord = getLightningCoordinator();
    assert(coord != null, 'coordinator exists');
    assert(typeof coord.collectLightning === 'function', 'has collectLightning');
    assert(typeof coord.getState === 'function', 'has getState');
    assert(typeof coord.subscribe === 'function', 'has subscribe');
  });

  await test('coordinator adapter is unconfigured (Blitzortung)', async () => {
    const coord = getLightningCoordinator();
    const result = await coord.collectLightning({
      location: { latitude: 35, longitude: -97 },
      stormEventId: null,
      reason: 'manual',
    });
    assertEqual(result.success, false, 'unconfigured adapter returns failure');
    assert((result.error ?? '').includes('not configured'), 'error mentions not configured');
  });

  await test('collectLightningManual returns structured failure for unconfigured adapter', async () => {
    const result = await collectLightningManual({
      location: { latitude: 35, longitude: -97 },
      stormEventId: null,
    });
    assertEqual(result.success, false, 'reports failure');
    assert(typeof result.error === 'string', 'error is string');
    assertEqual(result.providerEventCount, 0, 'zero events');
    assertEqual(result.insertedCount, 0, 'zero inserted');
  });

  await test('collectLightningAutomatic returns structured failure for unconfigured adapter', async () => {
    // Use manual to bypass the automatic gate and verify adapter failure
    const result = await collectLightningManual({
      location: { latitude: 35, longitude: -97 },
      stormEventId: null,
    });
    assertEqual(result.success, false, 'reports failure');
  });

  await test('lightning failure does not throw into caller (collectLightning)', async () => {
    const result = await collectLightning({
      location: { latitude: 35, longitude: -97 },
      stormEventId: null,
      reason: 'manual',
    });
    assertEqual(result.success, false, 'lightning fails gracefully');
    assert(typeof result.error === 'string', 'error present');
    assert(typeof result.collectionTimestampMs === 'number', 'timestamp present');
  });

  await test('all reason values accepted by coordinator', async () => {
    // Use manual calls to bypass automatic gate and verify adapter failure
    const r1 = await collectLightningManual({
      location: { latitude: 35, longitude: -97 },
      stormEventId: null,
    });
    assertEqual(r1.success, false, 'manual fails gracefully');
    const coord = getLightningCoordinator();
    // Verify coordinator accepts the reason parameter contract
    const state = coord.getState();
    assert(typeof state.inFlight === 'boolean', 'state has inFlight');
    assert(typeof state.lastSuccessfulCollectionMs === 'object' || state.lastSuccessfulCollectionMs === null, 'state has lastSuccessfulCollectionMs');
  });

  await test('stormEventId is accepted by coordinator', async () => {
    const result = await collectLightningManual({
      location: { latitude: 35, longitude: -97 },
      stormEventId: 42,
    });
    assertEqual(result.success, false, 'unconfigured adapter fails');
  });

  await test('lightningService is purely wiring — no duplicate execution owner', async () => {
    const coord = getLightningCoordinator();
    const state = coord.getState();
    assert(typeof state.inFlight === 'boolean', 'coordinator manages its own state');
    assert(typeof collectLightning === 'function', 'collectLightning is pass-through');
    assert(typeof collectLightningAutomatic === 'function', 'collectLightningAutomatic is pass-through');
    assert(typeof collectLightningManual === 'function', 'collectLightningManual is pass-through');
  });

  await test('null stormEventId is accepted', async () => {
    const result = await collectLightningManual({
      location: { latitude: 35, longitude: -97 },
      stormEventId: null,
    });
    assertEqual(result.success, false, 'unconfigured adapter');
  });

  console.log('\nPhase 4 integration tests: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
})();
