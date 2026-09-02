import { analyzeStorm } from '../tornadoAnalysis';
import type { AnalysisInput } from '../types';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const base: AnalysisInput = {
  temperature: 85,
  humidity: 65,
  pressure: 29.92,
  windSpeed: 15,
  windDirection: 220,
  windGust: 25,
  dewPoint: 68,
  latitude: 35,
  longitude: -97,
  cape: 2000,
  recentObservations: [],
  nearbyStations: [],
  nwsAlerts: [],
};

const noRadar = analyzeStorm(base);
assert(noRadar.rotation.velocityDataAvailable === false, 'velocity must be unavailable without radar');
assert(noRadar.dataQuality.velocityData === 'UNAVAILABLE', 'data quality must reflect missing velocity');
assert(noRadar.overallAssessment === 'LOW' || noRadar.overallAssessment === 'VERY_LOW', 'environment alone must remain low');

const radarNoVelocity = analyzeStorm({
  ...base,
  radarData: {
    available: true,
    hasPrecipitation: true,
    maxReflectivityDbz: 55,
    velocityPoints: [],
    couplets: [],
    stormCells: [],
  },
});
assert(radarNoVelocity.rotation.velocityDataAvailable === false, 'empty velocity array must not count as velocity');
assert(radarNoVelocity.overallAssessment !== 'HIGH' && radarNoVelocity.overallAssessment !== 'VERY_HIGH', 'missing velocity must prevent high assessment');

const advanced = analyzeStorm({
  ...base,
  advancedEnvironment: {
    sourceLevelCount: 20,
    lowLevelShear01KmKt: 25,
    lowLevelShear03KmKt: 35,
    deepLayerShear06KmKt: 55,
    srh01M2s2: 100,
    srh03M2s2: 150,
    lclHeightM: 900,
    capeJkg: 3000,
    cinJkg: -50,
    significantTornadoParameter: 2,
    supercellCompositeParameter: 4,
    availability: 'AVAILABLE',
    limitations: [],
  },
});
assert(advanced.environment.cape === 3000, 'advanced CAPE must reach environmental assessment');
assert(advanced.environment.cin === -50, 'advanced CIN must reach environmental assessment');
assert(advanced.environment.deepLayerShear === 55, 'deep-layer shear must reach environmental assessment');
assert(advanced.environment.srh === 150, 'SRH must reach environmental assessment');
assert(advanced.environment.lclHeight === 900, 'LCL must reach environmental assessment');
assert(advanced.environment.dataAvailability.shear === 'AVAILABLE', 'advanced shear availability must be exposed');
assert(advanced.environment.dataAvailability.helicity === 'AVAILABLE', 'advanced helicity availability must be exposed');
assert(advanced.environment.dataAvailability.compositeParams === 'AVAILABLE', 'advanced composite availability must be exposed');

const warning = analyzeStorm({
  ...base,
  nwsAlerts: [{ event: 'Tornado Warning', severity: 'Extreme', headline: 'Test warning' }],
});
assert(warning.nwsStatus.tornadoWarning === true, 'NWS tornado warning must remain separate and authoritative');

console.log('tornadoAnalysis.runtime.test.ts: PASS');
