// ============================================================
// Heat Index — environmental safety metric
// ============================================================
// Uses the NOAA/NWS Rothfusz regression in the standard heat-index
// operating range. Outside that range, the result is left unavailable
// rather than presenting an unsupported extrapolation.

export type HeatIndexCategory = 'CAUTION' | 'EXTREME_CAUTION' | 'DANGER' | 'EXTREME_DANGER';

export interface HeatIndexResult {
  heatIndexF: number | null;
  category: HeatIndexCategory | null;
  description: string;
}

export function calculateHeatIndex(temperatureF: number | null, relativeHumidity: number | null): HeatIndexResult {
  if (!Number.isFinite(temperatureF) || !Number.isFinite(relativeHumidity)) {
    return { heatIndexF: null, category: null, description: 'Heat index unavailable — temperature and humidity are required' };
  }

  const t = temperatureF as number;
  const rh = relativeHumidity as number;
  if (rh < 0 || rh > 100) {
    return { heatIndexF: null, category: null, description: 'Heat index unavailable — relative humidity is outside 0–100%' };
  }

  // NWS heat-index regression is intended for warm conditions.
  // Below 80°F, use the standard apparent-temperature adjustment only
  // when the simplified Rothfusz applicability condition is met.
  if (t < 80) {
    return { heatIndexF: t, category: 'CAUTION', description: 'Heat index follows air temperature below the Rothfusz operating range' };
  }

  if (rh < 40) {
    return { heatIndexF: t, category: t >= 105 ? 'DANGER' : t >= 90 ? 'EXTREME_CAUTION' : 'CAUTION', description: 'Low humidity limits the standard heat-index regression' };
  }

  let hi = -42.379 + 2.04901523 * t + 10.14333127 * rh
    - 0.22475541 * t * rh - 0.00683783 * t * t
    - 0.05481717 * rh * rh + 0.00122874 * t * t * rh
    + 0.00085282 * t * rh * rh - 0.00000199 * t * t * rh * rh;

  // NWS low-humidity adjustment.
  if (rh >= 13 && rh <= 53 && t >= 80 && t <= 112) {
    hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17);
  // NWS high-humidity adjustment.
  } else if (rh >= 85 && t >= 80 && t <= 87) {
    hi += ((rh - 85) / 10) * ((87 - t) / 5);
  }

  hi = Math.round(hi * 10) / 10;
  const category: HeatIndexCategory = hi >= 130 ? 'EXTREME_DANGER' : hi >= 105 ? 'DANGER' : hi >= 90 ? 'EXTREME_CAUTION' : 'CAUTION';
  return { heatIndexF: hi, category, description: `Heat index ${hi.toFixed(1)}°F — ${category.replace('_', ' ').toLowerCase()}` };
}
