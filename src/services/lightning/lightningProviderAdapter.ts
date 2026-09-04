// ============================================================
// Lightning Provider Adapter — Contract & Types
//
// Phase 3: Provider abstraction boundary.
// All provider-specific behavior lives in concrete adapters.
// The coordinator never knows provider-specific details.
// ============================================================

import type { LightningUsageHeaders } from './lightningUsageGuard';

// ---- Normalized provider event ----

export interface LightningProviderEvent {
  providerEventId: string | null;
  timestamp: number;
  latitude: number;
  longitude: number;
  providerTerminology: string;
  classification: string | null;
  polarity: string | null;
  peakCurrentAmperes: number | null;
  multiplicity: number | null;
  sensorCount: number | null;
  accuracyKm: number | null;
  rawPayload: unknown;
}

// ---- Provider result wrapper ----

export interface LightningProviderResult {
  events: LightningProviderEvent[];
  fetchedAt: number;
  rateLimitRetryAfterMs?: number;
  usage?: LightningUsageHeaders;
}

// ---- Provider adapter contract ----

export interface LightningProviderAdapter {
  readonly providerName: string;

  fetchEventsNearPoint(
    latitude: number,
    longitude: number,
    radiusKm: number,
    sinceMs: number,
    untilMs: number,
  ): Promise<LightningProviderResult>;
}
