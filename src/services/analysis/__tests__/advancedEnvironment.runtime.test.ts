import { strict as assert } from 'node:assert';
import { analyzeAdvancedEnvironment } from '../advancedEnvironment';

const profile = [
  { pressureHpa: 1000, heightM: 0, temperatureC: 28, dewPointC: 20, windSpeedKt: 10, windDirectionDeg: 170 },
  { pressureHpa: 925, heightM: 800, temperatureC: 24, dewPointC: 17, windSpeedKt: 20, windDirectionDeg: 190 },
  { pressureHpa: 850, heightM: 1500, temperatureC: 20, dewPointC: 12, windSpeedKt: 30, windDirectionDeg: 210 },
  { pressureHpa: 700, heightM: 3000, temperatureC: 8, dewPointC: -2, windSpeedKt: 40, windDirectionDeg: 230 },
  { pressureHpa: 500, heightM: 5800, temperatureC: -8, dewPointC: -22, windSpeedKt: 50, windDirectionDeg: 250 },
  { pressureHpa: 450, heightM: 6500, temperatureC: -14, dewPointC: -28, windSpeedKt: 55, windDirectionDeg: 260 },
];

const result = analyzeAdvancedEnvironment({
  levels: profile,
  capeJkg: 2200,
  cinJkg: -50,
  stormMotionDirectionDeg: 230,
  stormMotionSpeedKt: 25,
});

assert.equal(result.sourceLevelCount, 6);
assert.equal(result.availability, 'AVAILABLE');
assert.ok((result.lowLevelShear01KmKt ?? 0) > 0);
assert.ok((result.lowLevelShear03KmKt ?? 0) > (result.lowLevelShear01KmKt ?? 0));
assert.ok((result.deepLayerShear06KmKt ?? 0) > 0);
assert.ok(result.lclHeightM != null && result.lclHeightM > 0);
assert.ok(result.srh01M2s2 != null);
assert.ok(result.srh03M2s2 != null);
assert.ok(result.significantTornadoParameter != null);
assert.ok(result.supercellCompositeParameter != null);

const missingMotion = analyzeAdvancedEnvironment({ levels: profile, capeJkg: 1000, cinJkg: -25 });
assert.equal(missingMotion.srh01M2s2, null);
assert.ok(missingMotion.limitations.some(item => item.includes('Storm motion unavailable')));

const empty = analyzeAdvancedEnvironment({ levels: [] });
assert.equal(empty.availability, 'UNAVAILABLE');
assert.equal(empty.lowLevelShear01KmKt, null);
assert.ok(empty.limitations.includes('No vertical wind profile supplied'));

console.log('advancedEnvironment.runtime.test.ts: PASS');
