import type { NwsAlert } from '../../models/types';
import { createRateLimitError, guardedRequest } from '../network/requestGuard';

const NWS_API = 'https://api.weather.gov';

export function normalizeNwsAlerts(features: any[], nowMs: number = Date.now()): NwsAlert[] {
  const alertsById = new Map<string, NwsAlert>();
  for (const feature of features) {
    const props = feature?.properties ?? {};
    const expires = props.expires ? new Date(props.expires).getTime() : null;
    if (expires != null && expires <= nowMs) continue;
    const alert: NwsAlert = {
      id: feature.id || '',
      event: props.event || 'Unknown',
      headline: props.headline || null,
      severity: props.severity || null,
      urgency: props.urgency || null,
      certainty: props.certainty || null,
      onset: props.onset ? new Date(props.onset).getTime() : null,
      expires,
      areaDesc: props.areaDesc || null,
    };
    const key = alert.id || `${alert.event}:${alert.onset ?? ''}`;
    if (!alertsById.has(key)) alertsById.set(key, alert);
  }
  return [...alertsById.values()];
}

export async function fetchNwsAlerts(
  latitude: number,
  longitude: number,
  nowMs?: number
): Promise<NwsAlert[]> {
  const cacheKey = `${latitude.toFixed(3)},${longitude.toFixed(3)}:${Math.floor((nowMs ?? Date.now()) / 60000)}`;
  return guardedRequest<NwsAlert[]>({
    service: 'NWS alerts',
    key: cacheKey,
    cacheTtlMs: 30 * 1000,
    execute: async () => {
      const url = `${NWS_API}/alerts/active?point=${latitude},${longitude}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'StormLog/1.0 (stormlog@example.com)',
          Accept: 'application/geo+json',
        },
      });
      if (response.status === 429) throw createRateLimitError('NWS alerts', response);
      if (!response.ok) throw new Error(`NWS alerts HTTP ${response.status}`);

      const json = await response.json();
      return normalizeNwsAlerts(json.features || [], nowMs ?? Date.now());
    },
  });
}

export async function getActiveAlertTypes(
  latitude: number,
  longitude: number,
  nowMs?: number
): Promise<string[]> {
  const alerts = await fetchNwsAlerts(latitude, longitude, nowMs!);
  return [...new Set(alerts.map((a) => a.event))];
}

export async function getAlertCount(
  latitude: number,
  longitude: number,
  nowMs?: number
): Promise<number> {
  const alerts = await fetchNwsAlerts(latitude, longitude, nowMs!);
  return alerts.length;
}
