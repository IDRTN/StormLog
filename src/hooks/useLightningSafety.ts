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
      // Coordinator notifications can arrive while the initial database/usage
      // read is still running. Do not drop that newer state change; queue one
      // follow-up read so a successful collection cannot leave the UI stuck on
      // the older "Waiting for lightning data" snapshot.
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
        // Let the current async turn finish before replaying the queued read.
        // This guarantees the coordinator's newest state wins over the startup
        // snapshot without creating overlapping database work.
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

    // Seed one real foreground collection on app start. Prefer a current
    // Balanced fix, but fall back to Android's last-known fix if GPS/network
    // location is temporarily slow. A missing fresh fix should not leave the
    // safety card permanently waiting when a recent OS location is available.
    // Cadence, backoff, and quota protection still remain inside the existing
    // coordinator/usage guard.
    void (async () => {
      try {
        const providerStatus = getLightningProviderStatus();
        if (!providerStatus.configured) return;

        const permission = await Location.getForegroundPermissionsAsync();
        if (disposed || permission.status !== 'granted') return;

        let resolved: Location.LocationObject | null = null;
        try {
          resolved = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
        } catch (currentError) {
          console.warn(
            '[LIGHTNING-SAFETY] Current location unavailable; trying last-known location:',
            currentError instanceof Error ? currentError.message : String(currentError),
          );
          resolved = await Location.getLastKnownPositionAsync({
            maxAge: 15 * 60 * 1000,
            requiredAccuracy: 10_000,
          });
        }

        if (disposed) return;
        if (!resolved) {
          throw new Error('No current or recent last-known location available for lightning startup refresh');
        }

        await collectLightningAutomatic({
          location: {
            latitude: resolved.coords.latitude,
            longitude: resolved.coords.longitude,
          },
          stormEventId: null,
        });

        // Explicitly request a post-collection read. If a coordinator callback
        // already started one, load() queues this as the final read instead of
        // discarding it, eliminating the startup race seen on-device.
        if (!disposed) await load();
      } catch (error) {
        // Provider/location failures are represented by coordinator state when
        // possible; keep the banner mounted and refresh its diagnostic view.
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
