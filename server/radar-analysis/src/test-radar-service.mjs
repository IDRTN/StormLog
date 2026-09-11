import assert from 'node:assert/strict';
import { analyzeRadar, createRadarServer, nearestRadarSite } from './radar-service.mjs';

const site = nearestRadarSite(40.04, -82.46);
assert.equal(site?.id, 'KILN');
assert.ok(site.distanceKm > 0 && site.distanceKm < 200);

const result = await analyzeRadar(40.04, -82.46, { volumeCount: 3 });
assert.equal(result.stationId, 'KILN');
assert.equal(result.available, true, result.unavailableReason ?? 'radar unavailable');
assert.ok(Number.isFinite(result.latestFrameTime));
assert.ok(Number.isFinite(result.maxReflectivityDbz));
assert.ok(Array.isArray(result.velocityPoints) && result.velocityPoints.length > 0, 'velocity sample points missing');
assert.ok(Array.isArray(result.couplets));
assert.ok(result.scanCount >= 1 && result.scanCount <= 3);
assert.ok(['UNKNOWN', 'PERSISTENT', 'STRENGTHENING', 'RAPIDLY_INTENSIFYING', 'WEAKENING'].includes(result.trend));
if (result.correlationCoefficient != null) assert.ok(Number.isFinite(result.correlationCoefficient));
if (result.differentialReflectivity != null) assert.ok(Number.isFinite(result.differentialReflectivity));

const server = await createRadarServer({ port: 0 });
try {
  const port = server.address().port;
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200);
  const hp = await health.json();
  assert.equal(hp.ok, true);

  const response = await fetch(`http://127.0.0.1:${port}/radar?lat=40.04&lon=-82.46`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.available, true);
  assert.equal(payload.stationId, 'KILN');
  assert.ok(Array.isArray(payload.velocityPoints) && payload.velocityPoints.length > 0);
  assert.ok(Number.isFinite(payload.maxReflectivityDbz));
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log('LIVE_RADAR_SERVICE_TEST_PASS');
