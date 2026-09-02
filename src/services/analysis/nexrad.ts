// ============================================================
// Radar Composite Provider
// ============================================================
//
// Uses RainViewer's public radar composite plus NWS radar-site
// metadata. This is a radar-availability/imagery provider, not
// a raw NEXRAD Level-II decoder.
//
// Raw Doppler velocity, dual-pol fields, quantitative dBZ and
// storm-cell morphology are NOT inferred from PNG file size or
// other proxies. Those values remain unavailable until a real
// Level-II/Level-III processing path is connected.

import type { RadarVelocityPoint, RotationCouplet, StormCell } from './radar';
import { createRateLimitError, guardedRequest } from '../network/requestGuard';
import { fetchNwsPointData } from '../network/nwsPoints';

export interface NexradFrameInfo {
  time: number;
  path: string;
}

export interface NexradStationInfo {
  stationId: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  withinRange: boolean;
}

export interface NexradReflectivityResult {
  available: boolean;
  timestamp: number | null;
  maxReflectivityDbz: number | null;
  hasPrecipitation: boolean;
  hasStrongStorm: boolean;
  tileUrl: string | null;
  description: string;
}

export interface NexradProviderResult {
  available: boolean;
  station: NexradStationInfo | null;
  latestFrame: NexradFrameInfo | null;
  reflectivity: NexradReflectivityResult | null;
  velocityPoints: RadarVelocityPoint[];
  couplets: RotationCouplet[];
  stormCells: StormCell[];
  velocityAvailable: false;
  unavailableReason: string;
}

const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';
const RAINVIEWER_TILE_HOST = 'https://tilecache.rainviewer.com';
const ANALYSIS_ZOOM = 9;

function latLonToTile(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return { x, y };
}

async function fetchLatestRadarFrames(): Promise<NexradFrameInfo[]> {
  try {
    return await guardedRequest<NexradFrameInfo[]>({
      service: 'RainViewer',
      key: 'latest-frames',
      cacheTtlMs: 60 * 1000,
      execute: async () => {
        const response = await fetch(RAINVIEWER_API, {
          headers: { Accept: 'application/json' },
        });
        if (response.status === 429) throw createRateLimitError('RainViewer', response);
        if (!response.ok) return [];

        const data = await response.json();
        const past = Array.isArray(data?.radar?.past) ? data.radar.past : [];
        const nowcast = Array.isArray(data?.radar?.nowcast) ? data.radar.nowcast : [];

        return [...past, ...nowcast]
          .filter((frame: any) => Number.isFinite(frame?.time) && typeof frame?.path === 'string')
          .map((frame: any) => ({ time: frame.time, path: frame.path }))
          .sort((a, b) => b.time - a.time);
      },
    });
  } catch (error) {
    console.warn('[Radar composite] Failed to fetch RainViewer frames:', error);
    return [];
  }
}

async function fetchNearestRadarStation(
  latitude: number,
  longitude: number,
): Promise<NexradStationInfo | null> {
  try {
    const point = await fetchNwsPointData(latitude, longitude);
    const stationId = point?.radarStation;
    if (!stationId) return null;

    return {
      stationId,
      latitude: 0,
      longitude: 0,
      distanceKm: 0,
      withinRange: true,
    };
  } catch (error) {
    console.warn('[Radar composite] Failed to fetch radar station:', error);
    return null;
  }
}

async function buildRadarTile(
  latitude: number,
  longitude: number,
  framePath: string,
): Promise<NexradReflectivityResult> {
  try {
    const cacheKey = `${latitude.toFixed(3)},${longitude.toFixed(3)}:${framePath}`;
    return await guardedRequest<NexradReflectivityResult>({
      service: 'RainViewer tile',
      key: cacheKey,
      cacheTtlMs: 60 * 1000,
      execute: async () => {
        const { x, y } = latLonToTile(latitude, longitude, ANALYSIS_ZOOM);
        const tileUrl = `${RAINVIEWER_TILE_HOST}${framePath}/256/${ANALYSIS_ZOOM}/${x}/${y}/2/1_1.png`;
        const response = await fetch(tileUrl);
        if (response.status === 429) throw createRateLimitError('RainViewer tile', response);
        if (!response.ok) {
          return {
            available: false,
            timestamp: null,
            maxReflectivityDbz: null,
            hasPrecipitation: false,
            hasStrongStorm: false,
            tileUrl: null,
            description: `Radar imagery request failed (HTTP ${response.status})`,
          };
        }

        // A successful image fetch proves imagery availability only. PNG byte
        // size is not a valid proxy for precipitation intensity or dBZ.
        await response.blob();
        return {
          available: true,
          timestamp: Date.now(),
          maxReflectivityDbz: null,
          hasPrecipitation: false,
          hasStrongStorm: false,
          tileUrl,
          description: 'Radar composite imagery available; quantitative dBZ and pixel-level precipitation classification are unavailable in the mobile client',
        };
      },
    });
  } catch (error) {
    console.warn('[Radar composite] Tile fetch failed:', error);
    return {
      available: false,
      timestamp: null,
      maxReflectivityDbz: null,
      hasPrecipitation: false,
      hasStrongStorm: false,
      tileUrl: null,
      description: `Radar tile fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function fetchNexradData(
  latitude: number,
  longitude: number,
): Promise<NexradProviderResult> {
  try {
    return await guardedRequest<NexradProviderResult>({
      service: 'Radar composite',
      key: `${latitude.toFixed(3)},${longitude.toFixed(3)}`,
      cacheTtlMs: 60 * 1000,
      execute: async () => {
        const emptyResult: NexradProviderResult = {
          available: false,
          station: null,
          latestFrame: null,
          reflectivity: null,
          velocityPoints: [],
          couplets: [],
          stormCells: [],
          velocityAvailable: false,
          unavailableReason: 'Radar composite data not yet fetched',
        };

        const [frames, station] = await Promise.all([
          fetchLatestRadarFrames(),
          fetchNearestRadarStation(latitude, longitude),
        ]);

        if (frames.length === 0) {
          return {
            ...emptyResult,
            station,
            unavailableReason: 'No radar composite frames available from RainViewer',
          };
        }

        const latestFrame = frames[0];
        const reflectivity = await buildRadarTile(latitude, longitude, latestFrame.path);
        const available = station != null && reflectivity.available;

        return {
          available,
          station,
          latestFrame,
          reflectivity,
          velocityPoints: [],
          couplets: [],
          stormCells: [],
          velocityAvailable: false,
          unavailableReason: available
            ? 'Radar imagery available. Raw NEXRAD Level-II velocity/dual-pol processing is not connected, so rotation and quantitative reflectivity remain unavailable.'
            : 'Radar imagery unavailable — no coverage or API failure.',
        };
      },
    });
  } catch (error) {
    console.error('[Radar composite] Provider error:', error);
    return {
      available: false,
      station: null,
      latestFrame: null,
      reflectivity: null,
      velocityPoints: [],
      couplets: [],
      stormCells: [],
      velocityAvailable: false,
      unavailableReason: `Radar provider error: ${error instanceof Error ? error.message : 'Unknown'}`,
    };
  }
}

export class NexradVelocityProvider {
  async getVelocityNearPoint(): Promise<RadarVelocityPoint[]> {
    return [];
  }

  async getRotationCouplets(): Promise<RotationCouplet[]> {
    return [];
  }

  async getStormCells(): Promise<StormCell[]> {
    return [];
  }

  async isAvailable(): Promise<boolean> {
    try {
      const frames = await fetchLatestRadarFrames();
      return frames.length > 0;
    } catch {
      return false;
    }
  }
}
