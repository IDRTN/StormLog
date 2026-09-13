import { useState, useEffect, useCallback, useRef } from 'react';
import * as Location from 'expo-location';
import type { LocationData } from '../models/types';

export interface LocationState {
  location: LocationData | null;
  permission: boolean;
  loading: boolean;
  error: string | null;
}

const LAST_KNOWN_MAX_AGE_MS = 2 * 60 * 1000;

export function useLocation() {
  const [state, setState] = useState<LocationState>({
    location: null,
    permission: false,
    loading: true,
    error: null,
  });
  const inFlightRef = useRef<Promise<LocationData | null> | null>(null);

  const requestPermission = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setState({
        location: null,
        permission: false,
        loading: false,
        error: 'Location permission denied',
      });
      return false;
    }

    setState((s) => ({ ...s, permission: true }));
    return true;
  }, []);

  const getCurrentLocation = useCallback(async () => {
    if (inFlightRef.current) return inFlightRef.current;

    const promise = (async (): Promise<LocationData | null> => {
      setState((s) => ({ ...s, loading: true, error: null }));

      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') {
          setState((s) => ({
            ...s,
            permission: false,
            loading: false,
            error: 'Location permission not granted',
          }));
          return null;
        }

        // Android can take several seconds to produce a fresh GNSS/network fix
        // immediately after app startup. Seed the UI with a very recent OS fix
        // when one exists, then replace it with the fresh Balanced fix below.
        const lastKnown = await Location.getLastKnownPositionAsync({
          maxAge: LAST_KNOWN_MAX_AGE_MS,
          requiredAccuracy: 5_000,
        });
        if (lastKnown) {
          const warmLocation: LocationData = {
            latitude: lastKnown.coords.latitude,
            longitude: lastKnown.coords.longitude,
          };
          setState((s) => ({
            ...s,
            location: warmLocation,
            permission: true,
            loading: true,
          }));
        }

        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        const locationData: LocationData = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        };

        setState((s) => ({
          ...s,
          location: locationData,
          permission: true,
          loading: false,
        }));

        return locationData;
      } catch (err: any) {
        setState((s) => ({
          ...s,
          loading: false,
          error: err?.message || 'Failed to get location',
        }));
        return null;
      } finally {
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    (async () => {
      const granted = await requestPermission();
      if (granted) {
        await getCurrentLocation();
      } else {
        setState((s) => ({ ...s, loading: false }));
      }
    })();
  }, [requestPermission, getCurrentLocation]);

  return {
    ...state,
    requestPermission,
    getCurrentLocation,
  };
}
