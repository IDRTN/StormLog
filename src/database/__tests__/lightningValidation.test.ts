// ============================================================
// Phase 8 — Lightning Validation Record Tests
//
// Tests comparison metrics (pure) and database persistence.
// The pure calculateComparisonMetrics tests require no mocking.
// The database tests use module-level mocking of getDatabase().
// ============================================================

// Set up module mock BEFORE any imports that touch the database
const Module: any = (function () { return require('module'); })();

class FakeDatabase {
  private tables: Record<string, Record<string, unknown>[]> = {};
  private autoIncrement: Record<string, number> = {};

  async execAsync(_sql: string): Promise<void> {
    if (_sql.includes('CREATE TABLE IF NOT EXISTS lightning_validation_records')) {
      this.tables['lightning_validation_records'] = [];
      this.autoIncrement['lightning_validation_records'] = 1;
    }
    if (_sql.includes('CREATE TABLE IF NOT EXISTS lightning_events')) {
      this.tables['lightning_events'] = [];
      this.autoIncrement['lightning_events'] = 1;
    }
  }

  async getFirstAsync<T>(_sql: string, _params: any[] = []): Promise<T | null> {
    if (_sql.includes('lightning_validation_records')) {
      const rows = this.tables['lightning_validation_records'] ?? [];
      if (_sql.includes('SELECT COUNT(*)')) {
        const filtered = rows.filter((r: any) => r.stormEventId === _params[0]);
        return { count: filtered.length } as T;
      }
      return null;
    }
    // For getLightningSummary calls (lightning_events table)
    if (_sql.includes('lightning_events')) {
      const rows = this.tables['lightning_events'] ?? [];
      if (_sql.includes('SELECT COUNT(*)')) {
        let filtered = rows;
        if (_sql.includes('stormEventId = ?')) {
          filtered = rows.filter((r: any) => r.stormEventId === _params[0]);
        }
        if (_sql.includes('AND providerTerminology = ?')) {
          const term = _params[_params.length - 1];
          filtered = filtered.filter((r: any) => r.providerTerminology === term);
        }
        if (_sql.includes('AND classification = ?')) {
          const cls = _params[_params.length - 1];
          filtered = filtered.filter((r: any) => r.classification === cls);
        }
        if (_sql.includes('AND distanceToObserverKm <= ?')) {
          const maxDist = _params[_params.length - 1];
          filtered = filtered.filter((r: any) => r.distanceToObserverKm <= maxDist);
        }
        if (_sql.includes('AND timestamp >= ?') && _sql.includes('AND timestamp <= ?')) {
          const since = _params[_params.length - 2];
          const until = _params[_params.length - 1];
          filtered = filtered.filter((r: any) => r.timestamp >= since && r.timestamp <= until);
        } else if (_sql.includes('AND timestamp >= ? AND timestamp < ?')) {
          const since = _params[_params.length - 2];
          const until = _params[_params.length - 1];
          filtered = filtered.filter((r: any) => r.timestamp >= since && r.timestamp < until);
        } else if (_sql.includes('AND timestamp >= ?')) {
          const since = _params[_params.length - 1];
          filtered = filtered.filter((r: any) => r.timestamp >= since);
        }
        return { count: filtered.length } as T;
      }
      if (_sql.includes('SELECT MIN(distanceToObserverKm)')) {
        let filtered = rows;
        if (_sql.includes('stormEventId = ?')) {
          filtered = rows.filter((r: any) => r.stormEventId === _params[0]);
        }
        const minDist = filtered.length > 0
          ? Math.min(...filtered.map((r: any) => r.distanceToObserverKm))
          : null;
        return { min_dist: minDist } as T;
      }
      return null;
    }
    return null;
  }

  async getAllAsync<T>(_sql: string, _params: any[] = []): Promise<T[]> {
    if (_sql.includes('lightning_validation_records')) {
      const rows = this.tables['lightning_validation_records'] ?? [];
      let filtered = [...rows];
      if (_sql.includes('WHERE stormEventId = ?')) {
        filtered = filtered.filter((r: any) => r.stormEventId === _params[0]);
      }
      if (_sql.includes('ORDER BY recordedAtMs DESC')) {
        filtered.sort((a: any, b: any) => b.recordedAtMs - a.recordedAtMs);
      } else if (_sql.includes('ORDER BY recordedAtMs ASC')) {
        filtered.sort((a: any, b: any) => a.recordedAtMs - b.recordedAtMs);
      }
      if (_sql.includes('LIMIT 1')) return filtered[0] != null ? [filtered[0] as T] : [];
      return filtered as T[];
    }
    return [] as T[];
  }

  async runAsync(_sql: string, _params: any[] = []): Promise<{ changes: number; lastInsertRowId: number }> {
    if (_sql.includes('INSERT INTO lightning_validation_records')) {
      const rows = this.tables['lightning_validation_records'] ?? [];
      const id = this.autoIncrement['lightning_validation_records'] ?? 1;
      const record: Record<string, unknown> = { id };
      const columns = [
        'stormEventId', 'recordedAtMs', 'observerLatitude', 'observerLongitude',
        'comparisonRadiusKm', 'timeWindowSinceMs', 'timeWindowUntilMs',
        'independentSourceEventCount', 'independentSourceNearestDistanceKm',
        'independentSourceRatePerMinute', 'independentSourceTrend',
        'independentSourceTerminology', 'humanObservationNotes',
        'stormlogEventCount', 'stormlogNearestDistanceKm',
        'stormlogRatePerMinute', 'stormlogTrend',
        'eventCountDifference', 'eventCountPctDifference', 'notes',
      ];
      for (let i = 0; i < columns.length && i < _params.length; i++) {
        record[columns[i]] = _params[i];
      }
      rows.push(record);
      this.tables['lightning_validation_records'] = rows;
      this.autoIncrement['lightning_validation_records'] = id + 1;
      return { changes: 1, lastInsertRowId: id };
    }
    return { changes: 0, lastInsertRowId: 0 };
  }

  async withTransactionAsync(fn: () => Promise<void>): Promise<void> {
    await fn();
  }
}

const fakeDb = new FakeDatabase();
const originalResolveFilename = (Module as any)._resolveFilename;
const originalLoad = (Module as any)._load;

(Module as any)._resolveFilename = function (request: string, parent: any) {
  if (request.includes('/database') && !request.includes('lightningValidation') && !request.includes('lightningSummaries') && !request.includes('lightningTrend')) {
    return request;
  }
  return originalResolveFilename.call(this, request, parent);
};

(Module as any)._load = function (request: string, parent: any, isMain: boolean) {
  if (request.includes('/database') && !request.includes('lightningValidation') && !request.includes('lightningSummaries') && !request.includes('lightningTrend')) {
    return { getDatabase: async () => fakeDb };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let passed = 0;
let failed = 0;

function assert(c: boolean, m: string): asserts c {
  if (!c) throw new Error(m);
}
function assertEqual(a: unknown, b: unknown, m = 'values differ') {
  assert(a === b, m + ': expected ' + String(b) + ', got ' + String(a));
}
function assertApprox(a: number, b: number, tolerance: number, m = 'values differ') {
  assert(Math.abs(a - b) <= tolerance, m + ': expected ~' + String(b) + ', got ' + String(a));
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

// Now import the module under test (with mocked database)
const {
  calculateComparisonMetrics,
  insertValidationRecord,
  getValidationRecordsByStormEvent,
  getLatestValidationRecord,
  getAllValidationRecords,
} = require('../lightningValidation');

void (async function main() {
  // ============================================================
  // Comparison Metrics (pure function, no database)
  // ============================================================

  await test('both zero → bothZero=true, countsMatch=true', () => {
    const m = calculateComparisonMetrics(0, 0, null, null, 0, 0);
    assertEqual(m.eventCountDifference, 0);
    assertEqual(m.eventCountPctDifference, null);
    assertEqual(m.countsMatch, true);
    assertEqual(m.bothZero, true);
  });

  await test('matching counts → countsMatch=true', () => {
    const m = calculateComparisonMetrics(10, 10, 5.0, 4.8, 2.0, 1.8);
    assertEqual(m.eventCountDifference, 0);
    assertEqual(m.countsMatch, true);
    assertEqual(m.bothZero, false);
  });

  await test('StormLog higher → positive difference', () => {
    const m = calculateComparisonMetrics(15, 10, null, null, 3.0, 2.0);
    assertEqual(m.eventCountDifference, 5);
    assert(m.eventCountPctDifference != null, 'pct should not be null');
    assertApprox(m.eventCountPctDifference, 50.0, 0.1);
    assertEqual(m.countsMatch, false);
  });

  await test('StormLog lower → negative difference', () => {
    const m = calculateComparisonMetrics(5, 10, null, null, 1.0, 2.0);
    assertEqual(m.eventCountDifference, -5);
    assert(m.eventCountPctDifference != null, 'pct should not be null');
    assertApprox(m.eventCountPctDifference, -50.0, 0.1);
  });

  await test('independent count zero → pctDifference is null', () => {
    const m = calculateComparisonMetrics(5, 0, null, null, 1.0, 0);
    assertEqual(m.eventCountPctDifference, null);
    assertEqual(m.eventCountDifference, 5);
  });

  await test('independent count null → no percentage, no match', () => {
    const m = calculateComparisonMetrics(12, null, 3.0, null, 2.4, null);
    assertEqual(m.eventCountDifference, 12);
    assertEqual(m.eventCountPctDifference, null);
    assertEqual(m.countsMatch, false);
    assertEqual(m.bothZero, false);
  });

  await test('nearest distance close → within 1 km note', () => {
    const m = calculateComparisonMetrics(10, 10, 5.0, 5.3, 2.0, 2.0);
    assert(m.summaryText.includes('within 1 km'), 'should mention within 1 km');
  });

  await test('nearest distance far → shows both values', () => {
    const m = calculateComparisonMetrics(10, 10, 5.0, 12.0, 2.0, 2.0);
    assert(m.summaryText.includes('5.0 km'), 'should include StormLog distance');
    assert(m.summaryText.includes('12.0 km'), 'should include independent distance');
  });

  await test('summaryText includes rate when rate > 0', () => {
    const m = calculateComparisonMetrics(5, 5, null, null, 1.0, 0.8);
    assert(m.summaryText.includes('Rate'), 'should mention rate');
    assert(m.summaryText.includes('1.0/min'), 'should include StormLog rate');
    assert(m.summaryText.includes('0.8/min'), 'should include independent rate');
  });

  await test('zero rates → no rate line', () => {
    const m = calculateComparisonMetrics(0, 0, null, null, 0, 0);
    assert(!m.summaryText.includes('Rate'), 'should not mention rate when both zero');
  });

  await test('percentage precision — 1/3 ≈ 33.3%', () => {
    const m = calculateComparisonMetrics(4, 3, null, null, 1.0, 0.75);
    assert(m.eventCountPctDifference != null, 'pct should not be null');
    assertApprox(m.eventCountPctDifference, 33.3, 0.2);
  });

  await test('summaryText includes count match when matching', () => {
    const m = calculateComparisonMetrics(7, 7, null, null, 1.4, 1.4);
    assert(m.summaryText.includes('match'), 'should mention match');
  });

  await test('summaryText includes both-zero when both zero', () => {
    const m = calculateComparisonMetrics(0, 0, null, null, 0, 0);
    assert(m.summaryText.includes('zero events'), 'should mention zero events');
  });

  await test('summaryText shows independent source data note when null', () => {
    const m = calculateComparisonMetrics(8, null, null, null, 1.6, null);
    assert(m.summaryText.includes('no independent source data'), 'should note missing data');
  });

  // ============================================================
  // Database persistence
  // ============================================================

  await test('insertValidationRecord returns an id', async () => {
    const id = await insertValidationRecord({
      stormEventId: 1,
      recordedAtMs: 1000,
      observerLatitude: 35.0,
      observerLongitude: -97.0,
      comparisonRadiusKm: 50,
      timeWindowSinceMs: 500,
      timeWindowUntilMs: 1000,
      independentSourceEventCount: 10,
      independentSourceNearestDistanceKm: 5.0,
      independentSourceRatePerMinute: 2.0,
      independentSourceTrend: 'INCREASING',
      independentSourceTerminology: 'strikes',
      humanObservationNotes: 'saw lightning',
      stormlogEventCount: 12,
      stormlogNearestDistanceKm: 4.8,
      stormlogRatePerMinute: 2.4,
      stormlogTrend: 'INCREASING',
      eventCountDifference: 0,
      eventCountPctDifference: null,
      notes: null,
    });
    assert(id > 0, 'inserted id should be > 0');
  });

  await test('getValidationRecordsByStormEvent returns records', async () => {
    const records = await getValidationRecordsByStormEvent(1);
    assert(records.length > 0, 'should have at least 1 record');
    assertEqual(records[0].stormEventId, 1);
    assertEqual(records[0].observerLatitude, 35.0);
    assertEqual(records[0].observerLongitude, -97.0);
  });

  await test('getLatestValidationRecord returns most recent', async () => {
    await insertValidationRecord({
      stormEventId: 1,
      recordedAtMs: 2000,
      observerLatitude: 35.1,
      observerLongitude: -97.1,
      comparisonRadiusKm: 30,
      timeWindowSinceMs: 1500,
      timeWindowUntilMs: 2000,
      independentSourceEventCount: 5,
      independentSourceNearestDistanceKm: null,
      independentSourceRatePerMinute: 1.0,
      independentSourceTrend: 'STABLE',
      independentSourceTerminology: 'flashes',
      humanObservationNotes: null,
      stormlogEventCount: 8,
      stormlogNearestDistanceKm: 3.0,
      stormlogRatePerMinute: 1.6,
      stormlogTrend: 'INCREASING',
      eventCountDifference: 0,
      eventCountPctDifference: null,
      notes: 'second comparison',
    });
    const latest = await getLatestValidationRecord(1);
    assert(latest != null, 'latest should not be null');
    assertEqual(latest!.recordedAtMs, 2000);
    assertEqual(latest!.notes, 'second comparison');
  });

  await test('different stormEventIds are isolated', async () => {
    await insertValidationRecord({
      stormEventId: 99,
      recordedAtMs: 3000,
      observerLatitude: 36.0,
      observerLongitude: -98.0,
      comparisonRadiusKm: 25,
      timeWindowSinceMs: 2500,
      timeWindowUntilMs: 3000,
      independentSourceEventCount: 3,
      independentSourceNearestDistanceKm: null,
      independentSourceRatePerMinute: null,
      independentSourceTrend: null,
      independentSourceTerminology: null,
      humanObservationNotes: 'storm 99 only',
      stormlogEventCount: 3,
      stormlogNearestDistanceKm: null,
      stormlogRatePerMinute: 0.6,
      stormlogTrend: 'STABLE',
      eventCountDifference: 0,
      eventCountPctDifference: null,
      notes: null,
    });
    const records99 = await getValidationRecordsByStormEvent(99);
    assertEqual(records99.length, 1);
    assertEqual(records99[0].humanObservationNotes, 'storm 99 only');

    const records1 = await getValidationRecordsByStormEvent(1);
    assert(records1.length >= 2, 'storm 1 should have at least 2 records');
  });

  await test('null independent source fields are stored correctly', async () => {
    await insertValidationRecord({
      stormEventId: 2,
      recordedAtMs: 4000,
      observerLatitude: 34.0,
      observerLongitude: -96.0,
      comparisonRadiusKm: 50,
      timeWindowSinceMs: 3500,
      timeWindowUntilMs: 4000,
      independentSourceEventCount: null,
      independentSourceNearestDistanceKm: null,
      independentSourceRatePerMinute: null,
      independentSourceTrend: null,
      independentSourceTerminology: null,
      humanObservationNotes: null,
      stormlogEventCount: 7,
      stormlogNearestDistanceKm: 2.5,
      stormlogRatePerMinute: 1.4,
      stormlogTrend: 'INCREASING',
      eventCountDifference: 7,
      eventCountPctDifference: null,
      notes: 'no independent source data available',
    });
    const records = await getValidationRecordsByStormEvent(2);
    assertEqual(records.length, 1);
    assertEqual(records[0].independentSourceEventCount, null);
    assertEqual(records[0].independentSourceNearestDistanceKm, null);
    assertEqual(records[0].humanObservationNotes, null);
    assertEqual(records[0].notes, 'no independent source data available');
  });

  await test('stormlogEventCount=0 with independent=0 → bothZero metrics', async () => {
    await insertValidationRecord({
      stormEventId: 3,
      recordedAtMs: 5000,
      observerLatitude: 33.0,
      observerLongitude: -95.0,
      comparisonRadiusKm: 50,
      timeWindowSinceMs: 4500,
      timeWindowUntilMs: 5000,
      independentSourceEventCount: 0,
      independentSourceNearestDistanceKm: null,
      independentSourceRatePerMinute: 0,
      independentSourceTrend: 'NONE',
      independentSourceTerminology: null,
      humanObservationNotes: null,
      stormlogEventCount: 0,
      stormlogNearestDistanceKm: null,
      stormlogRatePerMinute: 0,
      stormlogTrend: 'NONE',
      eventCountDifference: 0,
      eventCountPctDifference: null,
      notes: null,
    });
    const records = await getValidationRecordsByStormEvent(3);
    assertEqual(records.length, 1);
    assertEqual(records[0].eventCountDifference, 0);
    assertEqual(records[0].eventCountPctDifference, null);
  });

  await test('getAllValidationRecords returns all records', async () => {
    const all = await getAllValidationRecords();
    assert(all.length >= 4, 'should have at least 4 records across all storm events');
  });

  await test('insertValidationRecord computes metrics correctly', async () => {
    await insertValidationRecord({
      stormEventId: 5,
      recordedAtMs: 6000,
      observerLatitude: 37.0,
      observerLongitude: -99.0,
      comparisonRadiusKm: 40,
      timeWindowSinceMs: 5500,
      timeWindowUntilMs: 6000,
      independentSourceEventCount: 10,
      independentSourceNearestDistanceKm: 5.0,
      independentSourceRatePerMinute: 2.0,
      independentSourceTrend: 'STABLE',
      independentSourceTerminology: 'strikes',
      humanObservationNotes: null,
      stormlogEventCount: 15,
      stormlogNearestDistanceKm: 4.5,
      stormlogRatePerMinute: 3.0,
      stormlogTrend: 'INCREASING',
      eventCountDifference: 0,
      eventCountPctDifference: null,
      notes: null,
    });
    const records = await getValidationRecordsByStormEvent(5);
    assertEqual(records.length, 1);
    assertEqual(records[0].eventCountDifference, 5);
    assert(records[0].eventCountPctDifference != null, 'pct should be computed');
    assertApprox(records[0].eventCountPctDifference, 50.0, 0.1);
  });

  // ============================================================
  // Cleanup
  // ============================================================

  (Module as any)._resolveFilename = originalResolveFilename;
  (Module as any)._load = originalLoad;

  // Summary
  console.log('\nPhase 8 lightning validation tests: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
})();
