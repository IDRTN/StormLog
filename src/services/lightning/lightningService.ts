// ============================================================
// Lightning Service — Module-level singleton wiring
// ============================================================

import {
  LightningCoordinator,
  type LightningCollectionContext,
  type LightningCollectionResult,
} from './lightningCoordinator';
import { insertLightningEvents } from '../../database/lightningEvents';
import { createStormEvent, getActiveStormEvent } from '../../database/stormEvents';
import { HttpLightningAdapter } from './providers/httpLightningAdapter';
import type { LightningProviderAdapter } from './lightningProviderAdapter';
import { UsageGuardedLightningAdapter } from './usageGuardedLightningAdapter';
import {
  readLightningUsageSnapshot,
  writeLightningUsageSnapshot,
} from './lightningUsageStore';
import {
  attachRecentUnassignedLightningToStormEvent,
  getRecentLightningProximity,
} from './lightningSummaries';
import {
  evaluateAutomaticStormStop,
  LIGHTNING_CLEAR_LOOKBACK_MS,
} from '../stormLogs/automaticStormLifecycle';

const LIGHTNING_PROXY_URL = process.env.EXPO_PUBLIC_STORMLOG_LIGHTNING_URL?.trim() || null;
const LIGHTNING_PROXY_TOKEN = process.env.EXPO_PUBLIC_STORMLOG_LIGHTNING_TOKEN?.trim() || null;

const KM_PER_MILE = 1.609344;
export const LIGHTNING_AUTO_START_RADIUS_MILES = 20;
export const LIGHTNING_AUTO_START_RADIUS_KM = LIGHTNING_AUTO_START_RADIUS_MILES * KM_PER_MILE;
export const LIGHTNING_AUTO_START_LOOKBACK_MS = 15 * 60_000;
export const LIGHTNING_TRIGGER_SOURCE = 'LIGHTNING_PROXIMITY';

const rawAdapter: LightningProviderAdapter | null = LIGHTNING_PROXY_URL
  ? new HttpLightningAdapter(LIGHTNING_PROXY_URL, fetch, LIGHTNING_PROXY_TOKEN)
  : null;

const adapter: LightningProviderAdapter | null = rawAdapter
  ? new UsageGuardedLightningAdapter(rawAdapter, {
      read: readLightningUsageSnapshot,
      write: writeLightningUsageSnapshot,
    })
  : null;

const coordinator = new LightningCoordinator({
  adapter,
  database: {
    insertLightningEvents: insertLightningEvents as (events: Array<Record<string, unknown>>) => Promise<number>,
  },
});

export type LightningProviderStatus = {
  configured: boolean;
  providerName: string | null;
};

export function getLightningProviderStatus(): LightningProviderStatus {
  return {
    configured: adapter != null,
    providerName: adapter?.providerName ?? null,
  };
}

export async function getLightningUsageSnapshot() {
  return readLightningUsageSnapshot(Date.now());
}

export async function collectLightning(
  context: LightningCollectionContext,
): Promise<LightningCollectionResult> {
  return coordinator.collectLightning(context);
}

async function evaluateLifecycleAfterFreshLightning(nowMs: number): Promise<void> {
  const active = await getActiveStormEvent();
  if (!active || active.isAutomatic !== true) return;
  const proximity = await getRecentLightningProximity(active.id, {
    nowMs,
    lookbackMs: LIGHTNING_CLEAR_LOOKBACK_MS,
  });
  const outcome = await evaluateAutomaticStormStop({
    lightning: proximity,
    lightningFresh: true,
    nowMs,
  });
  console.log(`[LIGHTNING-AUTO] Lifecycle evaluation: ${outcome}`);
}

/**
 * Automatic collection is also the lightning auto-start/lifecycle integration
 * point. Existing active events always own new lightning rows, including NWS
 * watch/warning events. With no active event, evidence inside 20 miles creates
 * exactly one automatic event. A successful refresh then evaluates the 30-mile
 * sustained-clear stop threshold; failed lightning refreshes never count as an
 * all-clear.
 */
export async function collectLightningAutomatic(
  context: Omit<LightningCollectionContext, 'reason'>,
): Promise<LightningCollectionResult> {
  const activeBefore = await getActiveStormEvent();
  const effectiveEventId = context.stormEventId ?? activeBefore?.id ?? null;
  const result = await coordinator.collectAutomatic({
    ...context,
    stormEventId: effectiveEventId,
  });

  if (!result.success) return result;
  const nowMs = result.collectionTimestampMs;

  if (effectiveEventId == null && result.providerEventCount > 0) {
    const proximity = await getRecentLightningProximity(null, {
      nowMs,
      lookbackMs: LIGHTNING_AUTO_START_LOOKBACK_MS,
    });

    if (
      proximity.count > 0
      && proximity.nearestDistanceKm != null
      && proximity.nearestDistanceKm <= LIGHTNING_AUTO_START_RADIUS_KM
    ) {
      const activeAfterProvider = await getActiveStormEvent();
      if (activeAfterProvider) {
        await attachRecentUnassignedLightningToStormEvent(
          activeAfterProvider.id,
          nowMs - LIGHTNING_AUTO_START_LOOKBACK_MS,
          nowMs,
        );
      } else {
        const eventId = await createStormEvent(
          context.location.latitude,
          context.location.longitude,
          'Automatic Lightning Proximity',
          {
            nwsAlertId: null,
            triggerSource: LIGHTNING_TRIGGER_SOURCE,
            isAutomatic: true,
          },
        );
        await attachRecentUnassignedLightningToStormEvent(
          eventId,
          nowMs - LIGHTNING_AUTO_START_LOOKBACK_MS,
          nowMs,
        );
        console.log(
          `[LIGHTNING-AUTO] Started storm event ${eventId}; nearest recent lightning ` +
          `${(proximity.nearestDistanceKm / KM_PER_MILE).toFixed(1)} mi away`,
        );
      }
    }
  }

  try {
    await evaluateLifecycleAfterFreshLightning(nowMs);
  } catch (error) {
    // Lifecycle prompting is secondary to lightning ingestion. Never turn a
    // successful provider/database refresh into a failed weather cycle.
    console.warn(
      '[LIGHTNING-AUTO] Lifecycle evaluation failed:',
      error instanceof Error ? error.message : String(error),
    );
  }
  return result;
}

export async function collectLightningManual(
  context: Omit<LightningCollectionContext, 'reason'>,
): Promise<LightningCollectionResult> {
  return coordinator.collectManual(context);
}

export function getLightningCoordinator(): LightningCoordinator {
  return coordinator;
}
