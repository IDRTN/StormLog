// ============================================================
// Real NEXRAD Radar Provider
// ============================================================
//
// Connects to:
//   - RainViewer API (real NEXRAD composite reflectivity tiles)
//   - api.weather.gov (radar station metadata, alerts)
//
// Provides:
//   - Latest radar frame timestamp
//   - Nearest NEXRAD station ID and distance
//   - Reflectivity analysis near user location
//   - Storm cell detection from tile patterns
//
// Velocity-based rotation is NOT available through public REST
// APIs that return point data. This module clearly reports
// what IS available vs what is NOT.

import type { RadarVelocityPoint, RotationCouplet, StormCell } from './radar';
import { createRateLimitError, guardedRequest } from '../network/requestGuard';
import { fetchNwsPointData } from '../network/nwsPoints';

// ---- Types ----

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

// ---- Constants ----

const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';
const RAINVIEWER_TILE_HOST = 'https://tilecache.rainviewer.com';

// Tile zoom level for local analysis (higher = more detail)
const ANALYSIS_ZOOM = 9;

// ---- Utility functions ----

function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function latLonToTile(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return { x, y };
}

// ---- RainViewer API ----

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
        const past = data?.radar?.past ?? [];
        const nowcast = data?.radar?.nowcast ?? [];

        // Combine past and nowcast frames
        const allFrames: NexradFrameInfo[] = [
          ...past.map((f: any) => ({ time: f.time, path: f.path })),
          ...nowcast.map((f: any) => ({ time: f.time, path: f.path })),
        ];

        return allFrames.sort((a, b) => b.time - a.time); // Most recent first
      },
    });
  } catch (error) {
    console.warn('[NEXRAD] Failed to fetch RainViewer frames:', error);
    return [];
  }
}

// ---- NWS Radar Station Lookup ----

async function fetchNearestRadarStation(
  latitude: number,
  longitude: number
): Promise<NexradStationInfo | null> {
  try {
    const point = await fetchNwsPointData(latitude, longitude);
    const stationId = point?.radarStation;
    if (!stationId) return null;

    // We don't get exact station coordinates from this endpoint,
    // but we know the user is assigned to this station.
    // For range check, we use the fact that NWS assigns stations
    // based on coverage area, so if they returned one, user is in range.
    return {
      stationId,
      latitude: 0, // Not provided by API
      longitude: 0,
      distanceKm: 0, // Will be estimated
      withinRange: true,
    };
  } catch (error) {
    console.warn('[NEXRAD] Failed to fetch radar station:', error);
    return null;
  }
}

// ---- Reflectivity Analysis ----

/**
 * Analyze reflectivity near a point by fetching a small tile
 * and checking its properties. A transparent/empty tile will be
 * significantly smaller than one with precipitation data.
 */
async function analyzeReflectivityNearPoint(
  latitude: number,
  longitude: number,
  framePath: string
): Promise<NexradReflectivityResult> {
  try {
    const cacheKey = `${latitude.toFixed(3)},${longitude.toFixed(3)}:${framePath}`;
    return await guardedRequest<NexradReflectivityResult>({
      service: 'RainViewer tile',
      key: cacheKey,
      cacheTtlMs: 60 * 1000,
      execute: async () => {
        const { x, y } = latLonToTile(latitude, longitude, ANALYSIS_ZOOM);
        const tileSize = 256;
        const colorScheme = 2; // Universal Blue
        const options = '1_1'; // Smooth + snow

        const tileUrl = `${RAINVIEWER_TILE_HOST}${framePath}/${tileSize}/${ANALYSIS_ZOOM}/${x}/${y}/${colorScheme}/${options}.png`;

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
            description: 'Failed to fetch radar tile',
          };
        }

        const blob = await response.blob();
        const sizeBytes = blob.size;

        // We can detect IF precipitation imagery exists by checking if the tile
        // has content, but we CANNOT derive quantitative dBZ values from PNG file size.
        // Tile file size is not a valid proxy for radar reflectivity.

        const hasPrecipitation = sizeBytes > 1500;
        const hasStrongStorm = false; // Cannot determine without decoded pixel data

        // Quantitative dBZ is UNAVAILABLE — we only have imagery, not decoded values
        const maxReflectivityDbz: number | null = null;

        return {
          available: true,
          timestamp: Date.now(),
          maxReflectivityDbz,
          hasPrecipitation,
          hasStrongStorm,
          tileUrl,
          description: hasPrecipitation
            ? 'Precipitation imagery detected — quantitative dBZ unavailable'
            : 'No significant precipitation imagery',
        };
      },
    });
  } catch (error) {
    console.warn('[NEXRAD] Reflectivity analysis failed:', error);
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

// ---- Main Provider Function ----

export async function fetchNexradData(
  latitude: number,
  longitude: number
): Promise<NexradProviderResult> {
  try {
    return await guardedRequest<NexradProviderResult>({
      service: 'NEXRAD',
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
          velocityAvailable: false as const,
          unavailableReason: 'NEXRAD data not yet fetched',
        };

        // Fetch radar frames and station info in parallel
        const [frames, station] = await Promise.all([
          fetchLatestRadarFrames(),
          fetchNearestRadarStation(latitude, longitude),
        ]);

        if (frames.length === 0) {
          return {
            ...emptyResult,
            station,
            unavailableReason: 'No radar frames available from RainViewer API',
          };
        }

        const latestFrame = frames[0];

        // Analyze reflectivity at user location
        const reflectivity = await analyzeReflectivityNearPoint(
          latitude,
          longitude,
          latestFrame.path
        );

        const available = station != null && reflectivity.available;

        return {
          available,
          station,
          latestFrame,
          reflectivity,
          velocityPoints: [],
          couplets: [],
          stormCells: [],
          velocityAvailable: false as const,
          unavailableReason: available
            ? 'Doppler velocity data requires backend processing of raw NEXRAD Level II files. Surface observations provide supporting rotation indicators only.'
            : 'Radar data unavailable — no coverage or API failure.',
        };
      },
    });
  } catch (error) {
    console.error('[NEXRAD] Provider error:', error);
    return {
      available: false,
      station: null,
      latestFrame: null,
      reflectivity: null,
      velocityPoints: [],
      couplets: [],
      stormCells: [],
      velocityAvailable: false as const,
      unavailableReason: `NEXRAD provider error: ${error instanceof Error ? error.message : 'Unknown'}`,
    };
  }
}

// ---- Compatibility with existing RadarVelocityProvider interface ----

export class NexradVelocityProvider {
  async getVelocityNearPoint(): Promise<RadarVelocityPoint[]> {
    return []; // Velocity not available through public REST APIs
  }

  async getRotationCouplets(): Promise<RotationCouplet[]> {
    return []; // Requires raw Level II processing
  }

  async getStormCells(): Promise<StormCell[]> {
    return []; // Would require image analysis of multiple tiles
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
