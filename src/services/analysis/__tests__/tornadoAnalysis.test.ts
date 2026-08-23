import { analyzeStorm } from '../tornadoAnalysis';
import type { AnalysisInput } from '../types';

const BASE_INPUT: AnalysisInput = {
  temperature: 85,
  humidity: 65,
  pressure: 29.92,
  windSpeed: 15,
  windDirection: 220,
  windGust: 25,
  dewPoint: 68,
  latitude: 35.0,
  longitude: -97.0,
  cape: 2000,
  recentObservations: [],
  nearbyStations: [],
  nwsAlerts: [],
};

describe('Tornado Analysis — Hard Gating Rules', () => {
  it('favorable environment + no storm → LOW or below', () => {
    const result = analyzeStorm(BASE_INPUT);
    expect(['VERY_LOW', 'LOW']).toContain(result.overallAssessment);
  });

  it('no radar velocity → capped at MODERATE', () => {
    const input = {
      ...BASE_INPUT,
      radarData: {
        available: true, hasPrecipitation: true, maxReflectivityDbz: 55,
        velocityPoints: [], couplets: [], stormCells: [],
      },
    };
    const result = analyzeStorm(input);
    const order = ['VERY_LOW','LOW','MARGINAL','MODERATE','HIGH','VERY_HIGH'];
    expect(order.indexOf(result.overallAssessment)).toBeLessThanOrEqual(3);
  });

  it('radar unavailable → rotation marked unavailable', () => {
    const result = analyzeStorm(BASE_INPUT);
    expect(result.rotation.velocityDataAvailable).toBe(false);
    expect(result.dataQuality.velocityData).toBe('UNAVAILABLE');
  });

  it('NWS tornado warning shown separately', () => {
    const input = { ...BASE_INPUT, nwsAlerts: [{ event: 'Tornado Warning', severity: 'Extreme', headline: null }] };
    const result = analyzeStorm(input);
    expect(result.nwsStatus.tornadoWarning).toBe(true);
  });

  it('whatWouldIncreaseConcern is populated', () => {
    const result = analyzeStorm(BASE_INPUT);
    expect(result.whatWouldIncreaseConcern.length).toBeGreaterThan(0);
  });

  it('confidence reduced without velocity', () => {
    const result = analyzeStorm(BASE_INPUT);
    expect(['LOW', 'UNKNOWN', 'MODERATE']).toContain(result.dataQuality.level);
  });
});
