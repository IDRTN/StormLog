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
import { evaluateAutomaticStormStop } from '../stormLogs/automaticStormLifecycle';
import {
  LIGHTNING_AUTO_START_LOOKBACK_MS,
  LIGHTNING_CLEAR_LOOKBACK_MS,
  isLightningAutoStartCandidate,
  kmToMiles,
} from '../stormLogs/automaticStormPolicy';

const LIGHTNING_PROXY_URL = process.env.EXPO_PUBLIC_STORMLOG_LIGHTNING_URL?.trim() || null;
const LIGHTNING_PROXY_TOKEN = process.env.EXPO_PUBLIC_STORMLOG_LIGHTNING_TOKEN?.trim() || null;
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

    if (isLightningAutoStartCandidate(proximity)) {
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
          `${kmToMiles(proximity.nearestDistanceKm)?.toFixed(1)} mi away`,
        );
      }
    }
  }

  try {
    await evaluateLifecycleAfterFreshLightning(nowMs);
  } catch (error) {
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
