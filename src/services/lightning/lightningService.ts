// ============================================================
// Lightning Service — Module-level singleton wiring
//
// Phase 4: Connects LightningCoordinator to real dependencies.
// Exposes convenience functions for callers.
// ============================================================

import { BlitzortungAdapter } from './providers/blitzortungAdapter';
import {
  LightningCoordinator,
  type LightningCollectionContext,
  type LightningCollectionResult,
} from './lightningCoordinator';
import {
  insertLightningEvents,
} from '../../database/lightningEvents';

const adapter = new BlitzortungAdapter();

const coordinator = new LightningCoordinator({
  adapter,
  database: {
    insertLightningEvents: insertLightningEvents as (events: Array<Record<string, unknown>>) => Promise<number>,
  },
});

// ---- Public convenience functions ----

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
