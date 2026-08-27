// ============================================================
// useLightningSummary — Hook for lightning summary data
//
// Phase 6: Fetches summary from database on demand.
// Subscribes to LightningCoordinator for refresh triggers.
// Does NOT create its own polling mechanism.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { getLightningSummary, type LightningSummary } from '../services/lightning/lightningSummaries';
import { getLightningCoordinator } from '../services/lightning/lightningService';

export type LightningSummaryState = {
  summary: LightningSummary | null;
  loading: boolean;
  error: string | null;
  lastRefreshMs: number | null;
};

export function useLightningSummary(
  stormEventId: number | null,
): LightningSummaryState & { refresh: () => void } {
  const [state, setState] = useState<LightningSummaryState>({
    summary: null,
    loading: false,
    error: null,
    lastRefreshMs: null,
  });
  const inFlightRef = useRef(false);

  const loadSummary = useCallback(async () => {
    if (stormEventId == null) {
      setState({ summary: null, loading: false, error: null, lastRefreshMs: null });
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setState(s => ({ ...s, loading: true }));
    try {
      const summary = await getLightningSummary(stormEventId, { nowMs: Date.now() });
      setState({ summary, loading: false, error: null, lastRefreshMs: Date.now() });
    } catch (err: any) {
      setState(s => ({
        ...s,
        loading: false,
        error: err?.message || 'Failed to load lightning summary',
      }));
    } finally {
      inFlightRef.current = false;
    }
  }, [stormEventId]);

  // Subscribe to coordinator state changes for refresh triggers
  useEffect(() => {
    if (stormEventId == null) return;
    const coord = getLightningCoordinator();
    const unsub = coord.subscribe(() => {
      // Re-fetch summary when coordinator state changes (collection completed)
      loadSummary();
    });
    // Initial load
    loadSummary();
    return unsub;
  }, [stormEventId, loadSummary]);

  return {
    ...state,
    refresh: loadSummary,
  };
}
