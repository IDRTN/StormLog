import { useState, useEffect, useCallback } from 'react';
import * as Location from 'expo-location';
import type { LocationData } from '../models/types';

export interface LocationState {
  location: LocationData | null;
  permission: boolean;
  loading: boolean;
  error: string | null;
}

export function useLocation() {
  const [state, setState] = useState<LocationState>({
    location: null,
    permission: false,
    loading: true,
    error: null,
  });

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
    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        setState((s) => ({
          ...s,
          loading: false,
          error: 'Location permission not granted',
        }));
        return null;
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
    }
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
