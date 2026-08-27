// Lightning Events — Database layer tests
// Uses module-level mocking of getDatabase() to test persistence/query primitives
// without requiring expo-sqlite at runtime.

// Minimal module mock (no @types/node dependency needed)
const Module: any = (function () { return require('module'); })();

class FakeDatabase {
  // Helper to safely cast params for comparisons
  private static p(params: unknown[], i: number): number { return params[i] as number; }

  private tables: Record<string, Record<string, unknown>[]> = {};
  private autoIncrement: Record<string, number> = {};

  async execAsync(_sql: string): Promise<void> {
    if (_sql.includes('CREATE TABLE IF NOT EXISTS lightning_events')) {
      this.tables['lightning_events'] = [];
      this.autoIncrement['lightning_events'] = 1;
    }
  }

  async getFirstAsync<T>(_sql: string, _params: any[] = []): Promise<T | null> {
    const rows = this.tables['lightning_events'] ?? [];
    if (_sql.includes('SELECT COUNT(*)')) {
      let filtered = rows;
      if (_sql.includes('stormEventId IS NULL')) {
        filtered = rows.filter((r: any) =>
          r.stormEventId === null && r.timestamp >= _params[0] && r.timestamp <= _params[1]);
      } else if (_sql.includes('stormEventId = ?') && _sql.includes('timestamp >= ?')) {
        filtered = rows.filter((r: any) =>
          r.stormEventId === _params[2] && r.timestamp >= _params[0] && r.timestamp <= _params[1]);
      } else if (_sql.includes('stormEventId = ?')) {
        filtered = rows.filter((r: any) => r.stormEventId === _params[0]);
      } else if (_sql.includes('timestamp >= ?')) {
        filtered = rows.filter((r: any) => r.timestamp >= _params[0] && r.timestamp <= _params[1]);
      }
      return { count: filtered.length } as T;
    }
    let filtered = [...rows];
    if (_sql.includes('stormEventId = ?') && !_sql.includes('IS NULL'))
      filtered = filtered.filter((r: any) => r.stormEventId === _params[0]);
    if (_sql.includes('ORDER BY distanceToObserverKm ASC'))
      filtered.sort((a: any, b: any) => a.distanceToObserverKm - b.distanceToObserverKm);
    else if (_sql.includes('ORDER BY timestamp DESC'))
      filtered.sort((a: any, b: any) => b.timestamp - a.timestamp);
    else if (_sql.includes('ORDER BY timestamp ASC'))
      filtered.sort((a: any, b: any) => a.timestamp - b.timestamp);
    if (_sql.includes('LIMIT 1')) return (filtered[0] as T) ?? null;
    return null;
  }

  async getAllAsync<T>(_sql: string, _params: any[] = []): Promise<T[]> {
    const rows = this.tables['lightning_events'] ?? [];
    let filtered = [...rows];
    if (_sql.includes('distanceToObserverKm <= ?') && _sql.includes('stormEventId = ?'))
      filtered = filtered.filter((r: any) => r.distanceToObserverKm <= _params[0] && r.stormEventId === _params[1]);
    else if (_sql.includes('distanceToObserverKm <= ?'))
      filtered = filtered.filter((r: any) => r.distanceToObserverKm <= _params[0]);
    else if (_sql.includes('stormEventId = ?') && _sql.includes('timestamp >= ?'))
      filtered = filtered.filter((r: any) => r.stormEventId === _params[2] && r.timestamp >= _params[0] && r.timestamp <= _params[1]);
    else if (_sql.includes('stormEventId = ?'))
      filtered = filtered.filter((r: any) => r.stormEventId === _params[0]);
    else if (_sql.includes('timestamp >= ?'))
      filtered = filtered.filter((r: any) => r.timestamp >= _params[0] && r.timestamp <= _params[1]);
    if (_sql.includes('ORDER BY distanceToObserverKm ASC'))
      filtered.sort((a: any, b: any) => a.distanceToObserverKm - b.distanceToObserverKm);
    else if (_sql.includes('ORDER BY timestamp ASC'))
      filtered.sort((a: any, b: any) => a.timestamp - b.timestamp);
    else if (_sql.includes('ORDER BY timestamp DESC'))
      filtered.sort((a: any, b: any) => b.timestamp - a.timestamp);
    return filtered as T[];
  }

  private nextId(table: string): number {
    const c = this.autoIncrement[table] ?? 1;
    this.autoIncrement[table] = c + 1;
    return c;
  }

  // Column order matches lightningEvents.ts INSERT exactly
  private static COLUMNS = [
    'stormEventId', 'providerName', 'providerEventId', 'timestamp',
    'eventLatitude', 'eventLongitude', 'providerTerminology',
    'classification', 'polarity', 'peakCurrentAmperes', 'multiplicity',
    'sensorCount', 'accuracyKm', 'distanceToObserverKm',
    'observerLatitude', 'observerLongitude', 'ingestedAt',
    'rawProviderPayload',
  ];

  async runAsync(_sql: string, _params: any[] = []): Promise<{ changes: number; lastInsertRowId: number }> {
    if (_sql.includes('INSERT OR IGNORE INTO lightning_events')) {
      const rows = this.tables['lightning_events'] ?? [];
      const row: Record<string, unknown> = { id: this.nextId('lightning_events') };
      FakeDatabase.COLUMNS.forEach((col: string, i: number) => { row[col] = _params[i]; });
      const isDup = row.providerEventId != null &&
        rows.some((r: any) => r.providerName === row.providerName && r.providerEventId === row.providerEventId);
      if (isDup) return { changes: 0, lastInsertRowId: 0 };
      rows.push(row);
      this.tables['lightning_events'] = rows;
      return { changes: 1, lastInsertRowId: row.id as number };
    }
    if (_sql.includes('UPDATE lightning_events')) {
      const stormEventId = _params[0];
      const sinceMs = _params[1] as number;
      const untilMs = _params[2] as number;
      const rows = this.tables['lightning_events'] ?? [];
      let count = 0;
      for (const r of rows) {
        if ((r as any).stormEventId === null && (r as any).timestamp >= sinceMs && (r as any).timestamp <= untilMs) {
          (r as any).stormEventId = stormEventId;
          count++;
        }
      }
      return { changes: count, lastInsertRowId: 0 };
    }
    return { changes: 0, lastInsertRowId: 0 };
  }

  async withTransactionAsync(fn: () => Promise<void>): Promise<void> { await fn(); }
}

// Module mock — intercept ./database resolution
const fakeDb = new FakeDatabase();
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, parent: any, isMain: boolean, options: any) {
  if (request === './database') return '/test/lightningEvents.ts';
  return origResolve.call(this, request, parent, isMain, options);
};
const origLoad = Module._load;
Module._load = function (request: string, parent: any, isMain: boolean) {
  if (request === './database') return { getDatabase: async () => fakeDb };
  return origLoad.call(this, request, parent, isMain);
};

// Import after mock setup — these are typed as `any` from require()
const lightningEvents = require('../lightningEvents') as Record<string, (...args: any[]) => Promise<any>>;
const insertLightningEvent: (event: any) => Promise<number> = lightningEvents.insertLightningEvent;
const insertLightningEvents: (events: any[]) => Promise<number> = lightningEvents.insertLightningEvents;
const queryLightningEventsByStormEvent: (id: number) => Promise<any[]> = lightningEvents.queryLightningEventsByStormEvent;
const queryLightningEventsByTimeRange: (since: number, until: number, stormId?: number) => Promise<any[]> = lightningEvents.queryLightningEventsByTimeRange;
const queryLightningEventsNearObserver: (maxDist: number, stormId?: number) => Promise<any[]> = lightningEvents.queryLightningEventsNearObserver;
const countLightningEventsByStormEvent: (id: number) => Promise<number> = lightningEvents.countLightningEventsByStormEvent;
const countLightningEventsByTimeRange: (since: number, until: number, stormId?: number) => Promise<number> = lightningEvents.countLightningEventsByTimeRange;
const findNearestLightningEvent: (id: number) => Promise<any> = lightningEvents.findNearestLightningEvent;
const getLatestLightningEvent: (id: number) => Promise<any> = lightningEvents.getLatestLightningEvent;
const countUnlinkedLightningEvents: (since: number, until: number) => Promise<number> = lightningEvents.countUnlinkedLightningEvents;
const associateUnlinkedLightningEvents: (stormId: number, since: number, until: number) => Promise<number> = lightningEvents.associateUnlinkedLightningEvents;

// Test harness
let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): asserts c { if (!c) throw new Error(m); }
function assertEqual(a: unknown, b: unknown, m = 'values differ') { assert(a === (b as unknown), m + ': got ' + String(a)); }
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log('PASS: ' + name); }
  catch (e) { failed++; console.log('FAIL: ' + name); console.log('  ' + (e instanceof Error ? e.message : String(e))); }
}

function makeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { stormEventId: null, providerName: 'test-provider', providerEventId: 'evt-001',
    timestamp: 1700000000000, eventLatitude: 35.0, eventLongitude: -97.0,
    providerTerminology: 'flash', classification: null, polarity: null,
    peakCurrentAmperes: null, multiplicity: null, sensorCount: null, accuracyKm: null,
    distanceToObserverKm: 12.5, observerLatitude: 35.1, observerLongitude: -97.1,
    ingestedAt: 1700000001000, rawProviderPayload: null, ...overrides };
}

void (async function main() {
  // --- Insert tests ---
  await test('single insert returns positive id', async () => {
    const id = await insertLightningEvent(makeEvent({ providerEventId: 'ins-001' }));
    assert(id > 0, 'expected positive id');
  });

  await test('duplicate providerEventId is ignored', async () => {
    const id1 = await insertLightningEvent(makeEvent({ providerEventId: 'dup-001' }));
    const id2 = await insertLightningEvent(makeEvent({ providerEventId: 'dup-001' }));
    assert(id1 > 0, 'first insert should succeed');
    assertEqual(id2, 0, 'duplicate returns 0');
  });

  await test('batch insert counts only non-duplicate rows', async () => {
    const events = [
      makeEvent({ providerEventId: 'batch-001' }),
      makeEvent({ providerEventId: 'batch-002' }),
      makeEvent({ providerEventId: 'dup-001' }),
    ];
    const count = await insertLightningEvents(events);
    assertEqual(count, 2, 'only 2 new rows');
  });

  await test('batch insert handles empty array', async () => {
    assertEqual(await insertLightningEvents([]), 0);
  });

  // --- Query by storm event ---
  await test('query by storm event returns matching events ordered by timestamp', async () => {
    const sid = 42;
    await insertLightningEvent(makeEvent({ providerEventId: 'qse-001', stormEventId: sid, timestamp: 1700000000000 }));
    await insertLightningEvent(makeEvent({ providerEventId: 'qse-002', stormEventId: sid, timestamp: 1700000006000 }));
    const r = await queryLightningEventsByStormEvent(sid);
    assertEqual(r.length, 2, 'two events');
    assert(r[0].timestamp <= r[1].timestamp, 'ordered ASC');
  });

  // --- Query by time range ---
  await test('query by time range returns matching events', async () => {
    const r = await queryLightningEventsByTimeRange(1700000000000, 1700000006000);
    assert(r.length > 0, 'events found');
  });

  await test('query by time range with storm filter', async () => {
    const r = await queryLightningEventsByTimeRange(1700000000000, 1700000010000, 42);
    assertEqual(r.length, 2, 'two events for storm');
  });

  // --- Query near observer ---
  await test('query near observer returns events within radius', async () => {
    await insertLightningEvent(makeEvent({ providerEventId: 'near-001', distanceToObserverKm: 5.0 }));
    await insertLightningEvent(makeEvent({ providerEventId: 'far-001', distanceToObserverKm: 200.0 }));
    const near = await queryLightningEventsNearObserver(50);
    assert(near.length > 0, 'near events found');
    assert(near.every((e: any) => e.distanceToObserverKm <= 50), 'all within radius');
  });

  await test('query near observer with storm filter', async () => {
    const results = await queryLightningEventsNearObserver(50, 42);
    assert(results.length > 0, 'near events for storm found');
  });

  // --- Count functions ---
  await test('count by storm event returns correct count', async () => {
    assertEqual(await countLightningEventsByStormEvent(42), 2);
  });

  await test('count by time range returns correct count', async () => {
    const c = await countLightningEventsByTimeRange(1700000000000, 1700000006000);
    assert(c > 0, 'count > 0');
  });

  await test('count by time range with storm filter', async () => {
    assertEqual(await countLightningEventsByTimeRange(1700000000000, 1700000006000, 42), 2);
  });

  // --- Find nearest ---
  await test('find nearest returns closest event', async () => {
    const n = await findNearestLightningEvent(42);
    assert(n != null, 'found');
    assert(n.distanceToObserverKm <= 50, 'close');
  });

  // --- Get latest ---
  await test('get latest returns most recent event', async () => {
    const l = await getLatestLightningEvent(42);
    assert(l != null, 'found');
    assertEqual(l.providerEventId, 'qse-002', 'latest');
  });

  // --- Unlinked events ---
  await test('count unlinked finds null stormEventId', async () => {
    const c = await countUnlinkedLightningEvents(1700000000000 - 1000, 1700000010000 + 1000);
    assert(c > 0, 'unlinked found');
  });

  await test('associate unlinked sets stormEventId', async () => {
    const linked = await associateUnlinkedLightningEvents(99, 1700000000000 - 1000, 1700000010000 + 1000);
    assert(linked > 0, 'linked');
    assert(await countLightningEventsByStormEvent(99) > 0, 'queryable');
  });

  // --- Null handling ---
  await test('null stormEventId is accepted on insert', async () => {
    const id = await insertLightningEvent(makeEvent({ providerEventId: 'ns-001', stormEventId: null }));
    assert(id > 0, 'inserted with null stormEventId');
  });

  await test('nullable fields accept null', async () => {
    const id = await insertLightningEvent(makeEvent({
      providerEventId: 'nl-001', classification: null, polarity: null,
      peakCurrentAmperes: null, multiplicity: null, sensorCount: null,
      accuracyKm: null, rawProviderPayload: null,
    }));
    assert(id > 0, 'inserted with all nullable fields null');
  });

  // --- Raw payload ---
  await test('rawProviderPayload stores serialized JSON', async () => {
    const payload = JSON.stringify({ raw: 'data', quality: 0.95 });
    await insertLightningEvent(makeEvent({ providerEventId: 'rp-001', rawProviderPayload: payload }));
    const r = await queryLightningEventsByTimeRange(1700000000000 - 1000, 1700000010000 + 1000);
    const f = r.find((x: any) => x.providerEventId === 'rp-001');
    assert(f != null, 'found');
    assertEqual(f.rawProviderPayload, payload, 'payload preserved');
  });

  // --- Multiple providers ---
  await test('multiple providers can have same providerEventId', async () => {
    const id1 = await insertLightningEvent(makeEvent({ providerName: 'prov-A', providerEventId: 'mp-001' }));
    const id2 = await insertLightningEvent(makeEvent({ providerName: 'prov-B', providerEventId: 'mp-001' }));
    assert(id1 > 0, 'provider-A inserted');
    assert(id2 > 0, 'provider-B inserted');
  });

  await test('providerEventId null allows duplicate providerName', async () => {
    const id1 = await insertLightningEvent(makeEvent({ providerEventId: null }));
    const id2 = await insertLightningEvent(makeEvent({ providerEventId: null }));
    assert(id1 > 0, 'first null-eventId inserted');
    assert(id2 > 0, 'second null-eventId also inserted');
  });

  console.log('\nLightning Events tests: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
})();
