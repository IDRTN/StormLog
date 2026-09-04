// ============================================================
// Lightning Service — Module-level singleton wiring
// ============================================================

import {
  LightningCoordinator,
  type LightningCollectionContext,
  type LightningCollectionResult,
} from './lightningCoordinator';
import { insertLightningEvents } from '../../database/lightningEvents';
import { HttpLightningAdapter } from './providers/httpLightningAdapter';
import type { LightningProviderAdapter } from './lightningProviderAdapter';
import { UsageGuardedLightningAdapter } from './usageGuardedLightningAdapter';
import {
  readLightningUsageSnapshot,
  writeLightningUsageSnapshot,
} from './lightningUsageStore';

const LIGHTNING_PROXY_URL = process.env.EXPO_PUBLIC_STORMLOG_LIGHTNING_URL?.trim() || null;

const rawAdapter: LightningProviderAdapter | null = LIGHTNING_PROXY_URL
  ? new HttpLightningAdapter(LIGHTNING_PROXY_URL)
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

export async function collectLightningAutomatic(
  context: Omit<LightningCollectionContext, 'reason'>,
): Promise<LightningCollectionResult> {
  return coordinator.collectAutomatic(context);
}

export async function collectLightningManual(
  context: Omit<LightningCollectionContext, 'reason'>,
): Promise<LightningCollectionResult> {
  return coordinator.collectManual(context);
}

export function getLightningCoordinator(): LightningCoordinator {
  return coordinator;
}
