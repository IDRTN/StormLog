import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import {
  collectLightningAutomatic,
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
  const pendingLoadRef = useRef(false);

  const load = useCallback(async () => {
    if (inFlightRef.current) {
      pendingLoadRef.current = true;
      return;
    }

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
      if (pendingLoadRef.current) {
        pendingLoadRef.current = false;
        setTimeout(() => {
          void load();
        }, 0);
      }
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    const unsubscribe = getLightningCoordinator().subscribe(() => {
      void load();
    });
    void load();

    // Prefer a recent OS fix so the first lightning collection is not blocked
    // by Android waiting for a brand-new GNSS/network fix. If no recent point
    // exists, fall back to a fresh Balanced fix. The coordinator still owns
    // cadence, quota, backoff, and duplicate-request protection.
    void (async () => {
      try {
        const providerStatus = getLightningProviderStatus();
        if (!providerStatus.configured) return;

        const permission = await Location.getForegroundPermissionsAsync();
        if (disposed || permission.status !== 'granted') return;

        let resolved = await Location.getLastKnownPositionAsync({
          maxAge: 2 * 60 * 1000,
          requiredAccuracy: 5_000,
        });

        if (!resolved) {
          resolved = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
        }

        if (disposed) return;
        if (!resolved) {
          throw new Error('No current or recent location available for lightning startup refresh');
        }

        await collectLightningAutomatic({
          location: {
            latitude: resolved.coords.latitude,
            longitude: resolved.coords.longitude,
          },
          stormEventId: null,
        });

        if (!disposed) await load();
      } catch (error) {
        console.warn(
          '[LIGHTNING-SAFETY] Initial live collection failed:',
          error instanceof Error ? error.message : String(error),
        );
        if (!disposed) await load();
      }
    })();

    return () => {
      disposed = true;
      pendingLoadRef.current = false;
      unsubscribe();
    };
  }, [load]);

  return {
    ...state,
    refresh: load,
  };
}
