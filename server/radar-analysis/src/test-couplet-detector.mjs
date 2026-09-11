import assert from 'node:assert/strict';
import { classifyDeltaV, detectVelocityCouplets } from './couplet-detector.mjs';

assert.equal(classifyDeltaV(29.9), null);
assert.equal(classifyDeltaV(30), 'WEAK');
assert.equal(classifyDeltaV(45), 'MODERATE');
assert.equal(classifyDeltaV(60), 'STRONG');
assert.equal(classifyDeltaV(80), 'EXTREME');

const azimuths = [0, 1, 2, 3];
const velocityMoments = azimuths.map(() => ({
  gate_size: 0.25,
  first_gate: 0.125,
  moment_data: Array(100).fill(0),
}));

velocityMoments[1].moment_data[40] = -35;
velocityMoments[2].moment_data[40] = 38;

const couplets = detectVelocityCouplets({ azimuths, velocityMoments });
assert.ok(couplets.length >= 1, 'synthetic gate-to-gate couplet should be detected');
assert.equal(couplets[0].strength, 'STRONG');
assert.equal(couplets[0].deltaVKt, 73);
assert.equal(couplets[0].rotationalVelocityKt, 36.5);
assert.ok(Math.abs(couplets[0].rangeKm - 10.125) < 0.4);

const noCouplet = detectVelocityCouplets({
  azimuths,
  velocityMoments: azimuths.map(() => ({
    gate_size: 0.25,
    first_gate: 0.125,
    moment_data: Array(100).fill(12),
  })),
});
assert.equal(noCouplet.length, 0, 'same-sign flow must not be reported as rotation');

assert.throws(() => detectVelocityCouplets({
  azimuths: [0],
  velocityMoments: [],
}), /length mismatch/);

console.log('COUPLET_DETECTOR_TEST_PASS');
