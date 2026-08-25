import type { LocationData, NwsAlert } from '../../models/types';
import { createRateLimitError, guardedRequest } from '../network/requestGuard';

const NWS_API = 'https://api.weather.gov';

export interface NormalizedNwsAlert extends NwsAlert {
  representativePoint?: LocationData | null;
  status?: string | null;
  messageType?: string | null;
  effective?: number | null;
  ends?: number | null;
  references?: string[];
}

function normalizeAlertTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function getReferenceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item): string[] => {
    if (typeof item === 'string' && item.trim().length > 0) return [item];
    if (!isRecord(item)) return [];
    const identifier = item.identifier;
    return typeof identifier === 'string' && identifier.trim().length > 0
      ? [identifier]
      : [];
  }))];
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function polygonCentroid(ring: unknown): LocationData | null {
  if (!Array.isArray(ring) || ring.length < 4) return null;

  let signedArea = 0;
  let centroidX = 0;
  let centroidY = 0;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const point = ring[index];
    const nextPoint = ring[index + 1];
    if (!Array.isArray(point) || !Array.isArray(nextPoint)) return null;

    const [longitude, latitude] = point;
    const [nextLongitude, nextLatitude] = nextPoint;
    if (!isFiniteCoordinate(longitude) || !isFiniteCoordinate(latitude)
      || !isFiniteCoordinate(nextLongitude) || !isFiniteCoordinate(nextLatitude)) {
      return null;
    }

    const crossProduct = longitude * nextLatitude - nextLongitude * latitude;
    signedArea += crossProduct;
    centroidX += (longitude + nextLongitude) * crossProduct;
    centroidY += (latitude + nextLatitude) * crossProduct;
  }

  if (Math.abs(signedArea) < Number.EPSILON) {
    let longitudeSum = 0;
    let latitudeSum = 0;
    for (const point of ring.slice(0, -1)) {
      if (!Array.isArray(point)) return null;
      const [longitude, latitude] = point;
      if (!isFiniteCoordinate(longitude) || !isFiniteCoordinate(latitude)) return null;
      longitudeSum += longitude;
      latitudeSum += latitude;
    }
    const vertexCount = ring.length - 1;
    return { latitude: latitudeSum / vertexCount, longitude: longitudeSum / vertexCount };
  }

  return {
    latitude: centroidY / (3 * signedArea),
    longitude: centroidX / (3 * signedArea),
  };
}

function ringArea(ring: unknown): number {
  if (!Array.isArray(ring) || ring.length < 4) return 0;

  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [longitude, latitude] = ring[index] ?? [];
    const [nextLongitude, nextLatitude] = ring[index + 1] ?? [];
    if (!isFiniteCoordinate(longitude) || !isFiniteCoordinate(latitude)
      || !isFiniteCoordinate(nextLongitude) || !isFiniteCoordinate(nextLatitude)) {
      return 0;
    }
    area += longitude * nextLatitude - nextLongitude * latitude;
  }
  return Math.abs(area / 2);
}

function getRepresentativePoint(geometry: any): LocationData | null {
  if (geometry?.type === 'Point') {
    const [longitude, latitude] = geometry.coordinates ?? [];
    return isFiniteCoordinate(longitude) && isFiniteCoordinate(latitude)
      ? { latitude, longitude }
      : null;
  }

  if (geometry?.type === 'Polygon') {
    return polygonCentroid(geometry.coordinates?.[0]);
  }

  if (geometry?.type === 'MultiPolygon') {
    let largestRing: unknown = null;
    let largestArea = 0;
    for (const polygon of geometry.coordinates ?? []) {
      const outerRing = polygon?.[0];
      const area = ringArea(outerRing);
      if (area > largestArea) {
        largestArea = area;
        largestRing = outerRing;
      }
    }
    return polygonCentroid(largestRing);
  }

  return null;
}

export function normalizeNwsAlerts(features: any[], nowMs: number = Date.now()): NormalizedNwsAlert[] {
  const alertsById = new Map<string, NormalizedNwsAlert>();
  for (const feature of features) {
    const props = feature?.properties ?? {};
    const expires = props.expires ? new Date(props.expires).getTime() : null;
    if (expires != null && expires <= nowMs) continue;
    const ends = normalizeAlertTimestamp(props.ends) ?? expires;
    const alert: NormalizedNwsAlert = {
      id: feature.id || '',
      event: props.event || 'Unknown',
      headline: props.headline || null,
      severity: props.severity || null,
      urgency: props.urgency || null,
      certainty: props.certainty || null,
      onset: props.onset ? new Date(props.onset).getTime() : null,
      expires,
      areaDesc: props.areaDesc || null,
      representativePoint: getRepresentativePoint(feature.geometry),
      status: typeof props.status === 'string' ? props.status : null,
      messageType: typeof props.messageType === 'string' ? props.messageType : null,
      effective: normalizeAlertTimestamp(props.effective),
      ends,
      references: getReferenceIds(props.references),
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
