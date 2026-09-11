import assert from 'node:assert/strict';
import { trackRotationAcrossScans } from './scan-tracker.mjs';
import { evaluateDualPolEvidence } from './dual-pol-evidence.mjs';

const scans = [
  { timestamp: 1000, couplets: [{ azimuthDeg: 120, rangeKm: 40, deltaVKt: 40, rotationalVelocityKt: 20, strength: 'WEAK' }] },
  { timestamp: 2000, couplets: [{ azimuthDeg: 121.2, rangeKm: 41, deltaVKt: 48, rotationalVelocityKt: 24, strength: 'MODERATE' }] },
  { timestamp: 3000, couplets: [{ azimuthDeg: 122, rangeKm: 42, deltaVKt: 64, rotationalVelocityKt: 32, strength: 'STRONG' }] },
];
const tracks = trackRotationAcrossScans(scans);
assert.equal(tracks.length, 1);
assert.equal(tracks[0].scanCount, 3);
assert.equal(tracks[0].persistent, true);
assert.equal(tracks[0].trend, 'RAPIDLY_INTENSIFYING');

const separated = trackRotationAcrossScans([
  { timestamp: 1000, couplets: [{ azimuthDeg: 10, rangeKm: 20, deltaVKt: 50 }] },
  { timestamp: 2000, couplets: [{ azimuthDeg: 80, rangeKm: 80, deltaVKt: 55 }] },
]);
assert.equal(separated.length, 2);
assert.equal(separated[0].persistent, false);

const debris = evaluateDualPolEvidence({ correlationCoefficient: 0.70, differentialReflectivity: 0.5, reflectivityDbz: 45, hasVelocityCouplet: true, lowLevel: true });
assert.equal(debris.available, true);
assert.equal(debris.debrisSignature, true);
assert.ok(debris.confidence >= 50);

const noVelocity = evaluateDualPolEvidence({ correlationCoefficient: 0.70, differentialReflectivity: 0.5, reflectivityDbz: 45, hasVelocityCouplet: false, lowLevel: true });
assert.equal(noVelocity.debrisSignature, false);

const weakReflectivity = evaluateDualPolEvidence({ correlationCoefficient: 0.70, reflectivityDbz: 5, hasVelocityCouplet: true, lowLevel: true });
assert.equal(weakReflectivity.debrisSignature, false);

const missing = evaluateDualPolEvidence({ correlationCoefficient: null, hasVelocityCouplet: true, lowLevel: true });
assert.equal(missing.available, false);
assert.equal(missing.debrisSignature, false);

console.log('ADVANCED_RADAR_EVIDENCE_TEST_PASS');
