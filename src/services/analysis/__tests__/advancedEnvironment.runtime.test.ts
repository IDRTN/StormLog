import { analyzeAdvancedEnvironment } from '../advancedEnvironment';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

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

assert(result.sourceLevelCount === 6, 'source level count');
assert(result.availability === 'AVAILABLE', 'complete profile availability');
assert((result.lowLevelShear01KmKt ?? 0) > 0, '0–1 km shear');
assert((result.lowLevelShear03KmKt ?? 0) > (result.lowLevelShear01KmKt ?? 0), '0–3 km shear');
assert((result.deepLayerShear06KmKt ?? 0) > 0, '0–6 km shear');
assert(result.lclHeightM != null && result.lclHeightM > 0, 'LCL');
assert(result.srh01M2s2 != null, '0–1 km SRH');
assert(result.srh03M2s2 != null, '0–3 km SRH');
assert(result.significantTornadoParameter != null, 'STP');
assert(result.supercellCompositeParameter != null, 'SCP');

const missingMotion = analyzeAdvancedEnvironment({ levels: profile, capeJkg: 1000, cinJkg: -25 });
assert(missingMotion.srh01M2s2 === null, 'SRH requires storm motion');
assert(missingMotion.limitations.some(item => item.includes('Storm motion unavailable')), 'missing-motion limitation');

const empty = analyzeAdvancedEnvironment({ levels: [] });
assert(empty.availability === 'UNAVAILABLE', 'empty profile availability');
assert(empty.lowLevelShear01KmKt === null, 'empty profile shear');
assert(empty.limitations.includes('No vertical wind profile supplied'), 'empty profile limitation');

console.log('advancedEnvironment.runtime.test.ts: PASS');
