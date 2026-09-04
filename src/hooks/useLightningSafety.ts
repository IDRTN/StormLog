import { useCallback, useEffect, useRef, useState } from 'react';
import { getLightningCoordinator, getLightningProviderStatus } from '../services/lightning/lightningService';
import { getLightningSafetySnapshot } from '../services/lightning/lightningSafetyRepository';
import { getLightningSafetyState, type LightningSafetyState } from '../services/lightning/lightningSafety';

export type LightningSafetyHookState = {
  safety: LightningSafetyState;
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
      const snapshot = await getLightningSafetySnapshot(Date.now());
      const safety = getLightningSafetyState({
        nowMs: Date.now(),
        providerConfigured: providerStatus.configured,
        nearestDistanceKm: snapshot.nearestDistanceKm,
        nearestBearingDegrees: snapshot.nearestBearingDegrees,
        latestEventTimestampMs: snapshot.latestEventTimestampMs,
        lastSuccessfulCollectionMs: coordinatorState.lastSuccessfulCollectionMs,
        lastAttemptMs: coordinatorState.lastAttemptMs,
        lastError: coordinatorState.lastResult?.error ?? null,
      });
      setState({ safety, loading: false, lastRefreshMs: Date.now(), error: null });
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
