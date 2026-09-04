import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getLightningCoordinator,
  getLightningProviderStatus,
  getLightningUsageSnapshot,
} from '../services/lightning/lightningService';
import { getLightningSafetySnapshot } from '../services/lightning/lightningSafetyRepository';
import { getLightningSafetyState, type LightningSafetyState } from '../services/lightning/lightningSafety';
import type { LightningUsageSnapshot } from '../services/lightning/lightningUsageGuard';

export type LightningSafetyHookState = {
  safety: LightningSafetyState;
  usage: LightningUsageSnapshot | null;
  loading: boolean;
  lastRefreshMs: number | null;
  error: string | null;
};

const INITIAL_SAFETY = getLightningSafetyState({
  nowMs: Date.now(),
  providerConfigured: getLightningProviderStatus().configured,
  nearestDistanceKm: null,
  nearestBearingDegrees: null,
  latestEventTimestampMs: null,
  lastSuccessfulCollectionMs: null,
  lastAttemptMs: null,
  lastError: null,
});

export function useLightningSafety(): LightningSafetyHookState & { refresh: () => void } {
  const [state, setState] = useState<LightningSafetyHookState>({
    safety: INITIAL_SAFETY,
    usage: null,
    loading: false,
    lastRefreshMs: null,
    error: null,
  });
  const inFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setState((current) => ({ ...current, loading: true }));

    try {
      const coordinatorState = getLightningCoordinator().getState();
      const providerStatus = getLightningProviderStatus();
      const [snapshot, usage] = await Promise.all([
        getLightningSafetySnapshot(Date.now()),
        getLightningUsageSnapshot(),
      ]);
      const coordinatorError = coordinatorState.lastResult?.success === false
        ? coordinatorState.lastResult.error ?? 'Lightning refresh failed'
        : null;
      const safety = getLightningSafetyState({
        nowMs: Date.now(),
        providerConfigured: providerStatus.configured,
        nearestDistanceKm: snapshot.nearestDistanceKm,
        nearestBearingDegrees: snapshot.nearestBearingDegrees,
        latestEventTimestampMs: snapshot.latestEventTimestampMs,
        lastSuccessfulCollectionMs: coordinatorState.lastSuccessfulCollectionMs,
        lastAttemptMs: coordinatorState.lastAttemptMs,
        lastError: coordinatorError,
      });
      setState({
        safety,
        usage,
        loading: false,
        lastRefreshMs: Date.now(),
        error: coordinatorError,
      });
    } catch (error: any) {
      setState((current) => ({
        ...current,
        loading: false,
        lastRefreshMs: Date.now(),
        error: error?.message || 'Lightning safety data unavailable',
      }));
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    const unsubscribe = getLightningCoordinator().subscribe(() => {
      load();
    });
    load();
    return unsubscribe;
  }, [load]);

  return {
    ...state,
    refresh: load,
  };
}
