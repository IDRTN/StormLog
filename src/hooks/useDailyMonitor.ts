import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  performDailyCollection,
  registerBackgroundTask,
  unregisterBackgroundTask,
  isBackgroundTaskRegistered,
  getMonitorStatus,
  DAILY_MONITOR_INTERVAL_KEY,
  DAILY_MONITOR_ENABLED_KEY,
  LAST_COLLECTION_KEY,
  LAST_ERROR_KEY,
} from '../services/background/dailyMonitor';
import { getNextIntervalBoundary, getLocalDateString } from '../util/dateUtils';

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
const MINUTE_MS = 60 * 1000;

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

  // Foreground interval ref — this is what actually drives collection
  const fgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  // Track the last local date we collected on to detect midnight transitions
  const lastCollectedDateRef = useRef<string | null>(null);

  // ============================================================
  // performCollection — runs one cycle of collection, updates UI
  // ============================================================
  const performCollection = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    const today = getLocalDateString(new Date());
    console.log(`[FG-POLL] Collection starting — local date: ${today}`);

    const result = await performDailyCollection();
    const now = Date.now();

    if (result.success) {
      lastCollectedDateRef.current = today;
      await AsyncStorage.setItem(LAST_COLLECTION_KEY, now.toString());
      await AsyncStorage.removeItem(LAST_ERROR_KEY);
    } else {
      await AsyncStorage.setItem(LAST_ERROR_KEY, result.error || 'Unknown error');
    }

    if (mountedRef.current) {
      setState((s) => ({
        ...s,
        lastCollectionTime: result.success ? now : s.lastCollectionTime,
        lastError: result.success ? null : result.error || 'Unknown error',
        error: null,
      }));
    }

    return result;
  }, []);

  // ============================================================
  // scheduleNextCollection — schedules the next collection on a
  // clean interval boundary aligned to local midnight.
  //
  // Instead of setInterval (which anchors to start time and misses
  // ticks when backgrounded), we use setTimeout chaining with
  // boundary-aligned scheduling. This ensures:
  //   1. Collections happen at predictable times (:00, :15, :30, :45)
  //   2. No collection is lost after backgrounding — the next
  //      scheduled time is always computed from "now"
  //   3. Midnight transitions are clean — the next boundary after
  //      midnight naturally belongs to the new calendar day
  // ============================================================
  const scheduleNextCollection = useCallback((intervalMinutes: number) => {
    // Clear any pending timeout
    if (fgTimerRef.current) {
      clearTimeout(fgTimerRef.current);
      fgTimerRef.current = null;
    }

    const intervalMs = intervalMinutes * MINUTE_MS;
    const nextBoundary = getNextIntervalBoundary(intervalMs);
    const delayMs = Math.max(1000, nextBoundary - Date.now()); // at least 1 second
    const nextDate = getLocalDateString(new Date(nextBoundary));

    console.log(`[FG-POLL] Next collection at ${new Date(nextBoundary).toLocaleTimeString()} (local date: ${nextDate}), delay: ${Math.round(delayMs / 1000)}s`);

    fgTimerRef.current = setTimeout(async () => {
      fgTimerRef.current = null;

      // Before collecting, check if we crossed midnight
      const currentDate = getLocalDateString(new Date());
      if (lastCollectedDateRef.current && lastCollectedDateRef.current !== currentDate) {
        console.log(`[FG-POLL] Midnight transition detected: ${lastCollectedDateRef.current} → ${currentDate}`);
      }

      await performCollection();

      // Schedule the next one
      if (mountedRef.current) {
        scheduleNextCollection(intervalMinutes);
      }
    }, delayMs);
  }, [performCollection]);

  // ============================================================
  // startForegroundPolling — the ACTUAL reliable collection.
  // Uses setTimeout chaining aligned to calendar boundaries.
  // ============================================================
  const startForegroundPolling = useCallback((intervalMinutes: number) => {
    console.log(`[FG-POLL] Starting foreground poll every ${intervalMinutes} min (boundary-aligned)`);

    // Clear any existing timer
    if (fgTimerRef.current) {
      clearTimeout(fgTimerRef.current);
      fgTimerRef.current = null;
    }

    // Do an immediate first collection
    performCollection().then(() => {
      // After first collection, schedule the next one on a clean boundary
      if (mountedRef.current) {
        scheduleNextCollection(intervalMinutes);
      }
    });
  }, [performCollection, scheduleNextCollection]);

  const stopForegroundPolling = useCallback(() => {
    if (fgTimerRef.current) {
      clearTimeout(fgTimerRef.current);
      fgTimerRef.current = null;
      console.log('[FG-POLL] Foreground polling stopped');
    }
  }, []);

  // ============================================================
  // On mount: check if monitor was enabled, auto-start if so
  // ============================================================
  useEffect(() => {
    mountedRef.current = true;

    (async () => {
      try {
        const status = await getMonitorStatus();
        const savedInterval = await AsyncStorage.getItem(DAILY_MONITOR_INTERVAL_KEY);
        const savedEnabled = await AsyncStorage.getItem(DAILY_MONITOR_ENABLED_KEY);
        const interval = savedInterval ? parseInt(savedInterval, 10) : 15;
        const wasEnabled = savedEnabled === 'true' || status.isActive;

        console.log(`[INIT] Monitor status: active=${status.isActive}, savedEnabled=${savedEnabled}, interval=${interval}`);

        setState((s) => ({
          ...s,
          isActive: wasEnabled,
          intervalMinutes: INTERVALS.includes(interval) ? interval : 15,
          lastCollectionTime: status.lastCollection,
          lastError: status.lastError,
          totalRecords: status.totalRecords,
          loading: false,
        }));

        if (wasEnabled) {
          console.log('[INIT] Auto-starting foreground polling...');
          startForegroundPolling(INTERVALS.includes(interval) ? interval : 15);
          registerBackgroundTask(INTERVALS.includes(interval) ? interval : 15);
        }
      } catch (error: any) {
        console.error('[INIT] Failed:', error?.message);
        if (mountedRef.current) {
          setState((s) => ({ ...s, loading: false, error: `Init failed: ${error?.message}` }));
        }
      }
    })();

    return () => {
      mountedRef.current = false;
      if (fgTimerRef.current) {
        clearTimeout(fgTimerRef.current);
        fgTimerRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ============================================================
  // startMonitor — called from UI button
  // ============================================================
  const startMonitor = useCallback(async (intervalMinutes?: number) => {
    const interval = intervalMinutes ?? state.intervalMinutes;
    setState((s) => ({ ...s, loading: true, error: null }));

    await AsyncStorage.setItem(DAILY_MONITOR_ENABLED_KEY, 'true');
    await AsyncStorage.setItem(DAILY_MONITOR_INTERVAL_KEY, interval.toString());

    const bgResult = await registerBackgroundTask(interval);
    if (!bgResult.success) {
      console.error('[START] BG registration failed:', bgResult.error);
    }

    startForegroundPolling(interval);

    setState((s) => ({
      ...s,
      isActive: true,
      intervalMinutes: interval,
      loading: false,
    }));

    console.log(`[START] Monitor started: ${interval} min interval`);
  }, [state.intervalMinutes, startForegroundPolling]);

  // ============================================================
  // stopMonitor
  // ============================================================
  const stopMonitor = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));

    await AsyncStorage.setItem(DAILY_MONITOR_ENABLED_KEY, 'false');
    await unregisterBackgroundTask();
    stopForegroundPolling();

    setState((s) => ({
      ...s,
      isActive: false,
      loading: false,
    }));

    console.log('[STOP] Monitor stopped');
  }, [stopForegroundPolling]);

  // ============================================================
  // setIntervalMinutes — restart polling if active
  // ============================================================
  const setIntervalMinutes = useCallback(async (minutes: number) => {
    await AsyncStorage.setItem(DAILY_MONITOR_INTERVAL_KEY, minutes.toString());
    setState((s) => ({ ...s, intervalMinutes: minutes }));

    if (state.isActive) {
      stopForegroundPolling();
      startForegroundPolling(minutes);
      registerBackgroundTask(minutes);
    }
  }, [state.isActive, stopForegroundPolling, startForegroundPolling]);

  // ============================================================
  // collectNow — manual single collection
  // ============================================================
  const collectNow = useCallback(async () => {
    setState((s) => ({ ...s, error: null }));
    const result = await performCollection();
    if (result.success) {
      return { success: true as const };
    } else {
      return { success: false as const, error: result.error || 'Unknown error' };
    }
  }, [performCollection]);

  // ============================================================
  // refreshStatus — re-read from DB/AsyncStorage
  // ============================================================
  const refreshStatus = useCallback(async () => {
    try {
      const status = await getMonitorStatus();
      const savedInterval = await AsyncStorage.getItem(DAILY_MONITOR_INTERVAL_KEY);
      const savedEnabled = await AsyncStorage.getItem(DAILY_MONITOR_ENABLED_KEY);
      const interval = savedInterval ? parseInt(savedInterval, 10) : 15;
      const wasEnabled = savedEnabled === 'true' || status.isActive;
      setState((s) => ({
        ...s,
        isActive: wasEnabled,
        intervalMinutes: INTERVALS.includes(interval) ? interval : 15,
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
