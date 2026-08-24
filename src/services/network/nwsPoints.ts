import { createRateLimitError, guardedRequest } from './requestGuard';

export type FetchJson = typeof fetch;

export interface NwsPointData {
  forecast?: string;
  forecastHourly?: string;
  gridId?: string;
  gridX?: number;
  gridY?: number;
  timezone?: string;
  radarStation?: string;
  [key: string]: any;
}

export async function fetchNwsPointData(
  latitude: number,
  longitude: number,
  fetchJson: FetchJson = fetch,
): Promise<NwsPointData> {
  const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;

  return guardedRequest<NwsPointData>({
    service: 'NWS points',
    key,
    cacheTtlMs: 10 * 60 * 1000,
    execute: async () => {
      const endpoint = `https://api.weather.gov/points/${latitude},${longitude}`;
      const response = await fetchJson(endpoint, {
        headers: {
          Accept: 'application/geo+json',
          'User-Agent': 'StormLog/1.0 (weather@stormlog.example)',
        },
      });
      if (response.status === 429) throw createRateLimitError('NWS points', response);
      if (!response.ok) throw new Error(`NWS points HTTP ${response.status}`);
      const json = await response.json();
      return json?.properties ?? {};
    },
  });
}
