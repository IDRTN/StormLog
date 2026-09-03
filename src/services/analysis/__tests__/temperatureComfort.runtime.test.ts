import { strict as assert } from 'node:assert';
import { calculateTemperatureComfort, calculateWindChill } from '../temperatureComfort';

function run(): void {
  const mildHumid = calculateTemperatureComfort(73, 94, 3);
  assert.equal(mildHumid.method, 'AIR_TEMPERATURE');
  assert.equal(mildHumid.feelsLikeF, 73);
  assert.equal(mildHumid.heatIndexF, null);
  assert.equal(mildHumid.windChillF, null);

  const hotHumid = calculateTemperatureComfort(95, 60, 8);
  assert.equal(hotHumid.method, 'HEAT_INDEX');
  assert.ok(hotHumid.heatIndexF != null && hotHumid.heatIndexF > 95);
  assert.equal(hotHumid.feelsLikeF, hotHumid.heatIndexF);

  const coldWindy = calculateTemperatureComfort(30, 70, 15);
  assert.equal(coldWindy.method, 'WIND_CHILL');
  assert.ok(coldWindy.windChillF != null && coldWindy.windChillF < 30);
  assert.equal(coldWindy.feelsLikeF, coldWindy.windChillF);

  const calmCold = calculateWindChill(30, 2);
  assert.equal(calmCold.windChillF, null);

  const missing = calculateTemperatureComfort(null, 50, 10);
  assert.equal(missing.method, 'UNAVAILABLE');
  assert.equal(missing.feelsLikeF, null);

  console.log('temperatureComfort.runtime.test passed');
}

run();
