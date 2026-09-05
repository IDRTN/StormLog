import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import {
  getMonitorStatus,
  initializeDailyMonitorCoordinator,
  subscribeToDailyMonitor,
  startDailyMonitor,
  stopDailyMonitor,
  setDailyMonitorInterval,
  collectDailyWeatherManually,
} from '../services/background/dailyMonitor';

export interface DailyMonitorState {
  isActive: boolean;
  intervalMinutes: number;
  loading: boolean;
  lastCollectionTime: number | null;
  lastError: string | null;
  totalRecords: number;
  error: string | null;
}

const INTERVALS = [5, 10, 15, 30, 60];

export function useDailyMonitor() {
  const [state, setState] = useState<DailyMonitorState>({
    isActive: false,
    intervalMinutes: 15,
    loading: true,
    lastCollectionTime: null,
    lastError: null,
    totalRecords: 0,
    error: null,
  });

  const refreshFromService = useCallback(async () => {
    const [serviceStatus] = await Promise.all([
      getMonitorStatus(),
      initializeDailyMonitorCoordinator(),
    ]);
    setState((current) => ({
      ...current,
      totalRecords: serviceStatus.totalRecords,
      loading: false,
    }));
  }, []);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    void initializeDailyMonitorCoordinator()
      .then(() => {
        if (!mounted) return;
        unsubscribe = subscribeToDailyMonitor((monitorState) => {
          setState((current) => ({ ...current, ...monitorState }));
        });
        return refreshFromService();
      })
      .catch((error: unknown) => {
        if (mounted) {
          setState((current) => ({
            ...current,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [refreshFromService]);

  const startMonitor = useCallback(async (intervalMinutes?: number) => {
    const interval = intervalMinutes ?? state.intervalMinutes;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const foreground = await Location.requestForegroundPermissionsAsync();
      if (foreground.status !== 'granted') {
        throw new Error('Daily Monitor requires location permission.');
      }

      if (Platform.OS === 'android') {
        const background = await Location.requestBackgroundPermissionsAsync();
        if (background.status !== 'granted') {
          throw new Error(
            'Daily Monitor requires Allow all the time location access so scheduled background observations can get a fresh location.',
          );
        }
      }

      await startDailyMonitor(INTERVALS.includes(interval) ? interval : 15);
      await refreshFromService();
    } catch (error: unknown) {
      setState((s) => ({
        ...s,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    } finally {
      setState((s) => ({ ...s, loading: false }));
    }
  }, [state.intervalMinutes, refreshFromService]);

  const stopMonitor = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      await stopDailyMonitor();
    } finally {
      setState((s) => ({ ...s, isActive: false, loading: false }));
    }
  }, []);

  const setIntervalMinutes = useCallback(async (minutes: number) => {
    if (!INTERVALS.includes(minutes)) return;
    setState((s) => ({ ...s, intervalMinutes: minutes }));
    await setDailyMonitorInterval(minutes);
  }, []);

  const collectNow = useCallback(async () => {
    setState((s) => ({ ...s, error: null }));
    const result = await collectDailyWeatherManually();
    if (result.success) {
      return { success: true as const };
    }
    return { success: false as const, error: result.error || 'Unknown collection error' };
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      await initializeDailyMonitorCoordinator();
      const status = await getMonitorStatus();
      setState((s) => ({
        ...s,
        lastCollectionTime: status.lastCollection,
        lastError: status.lastError,
        totalRecords: status.totalRecords,
        loading: false,
      }));
    } catch {}
  }, []);

  return {
    ...state,
    startMonitor,
    stopMonitor,
    setIntervalMinutes,
    collectNow,
    refreshStatus,
  };
}
