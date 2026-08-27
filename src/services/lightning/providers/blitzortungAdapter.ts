// ============================================================
// Blitzortung Adapter — Stub / Not Configured
//
// Phase 3: The adapter boundary exists but Blitzortung cannot
// be safely activated without:
//   - A backend proxy (Blitzortung requires websocket auth
//     that cannot be embedded in a mobile client)
//   - An authorized Blitzortung registration
//   - A server-side endpoint that maintains the websocket
//     connection and exposes an HTTP API
//
// This adapter fails deterministically with an actionable
// error. No network requests are attempted.
// ============================================================

import type {
  LightningProviderAdapter,
  LightningProviderResult,
} from '../lightningProviderAdapter';

const UNSUPPORTED_MESSAGE =
  'Blitzortung provider is not configured. ' +
  'Activation requires a backend proxy with websocket relay. ' +
  'See lightning/providers/blitzortungAdapter.ts for requirements.';

export class BlitzortungAdapter implements LightningProviderAdapter {
  readonly providerName = 'Blitzortung';

  async fetchEventsNearPoint(
    _latitude: number,
    _longitude: number,
    _radiusKm: number,
    _sinceMs: number,
    _untilMs: number,
  ): Promise<LightningProviderResult> {
    throw new Error(UNSUPPORTED_MESSAGE);
  }
}
