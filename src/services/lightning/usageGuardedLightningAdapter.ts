import type {
  LightningProviderAdapter,
  LightningProviderResult,
} from './lightningProviderAdapter';
import {
  applyLightningUsageResponse,
  evaluateLightningUsage,
  type LightningUsageSnapshot,
} from './lightningUsageGuard';

export type LightningUsageStorage = {
  read: (nowMs: number) => Promise<LightningUsageSnapshot>;
  write: (snapshot: LightningUsageSnapshot) => Promise<void>;
};

export class UsageGuardedLightningAdapter implements LightningProviderAdapter {
  readonly providerName: string;

  constructor(
    private readonly inner: LightningProviderAdapter,
    private readonly storage: LightningUsageStorage,
    private readonly now: () => number = Date.now,
  ) {
    this.providerName = inner.providerName;
  }

  async fetchEventsNearPoint(
    latitude: number,
    longitude: number,
    radiusKm: number,
    sinceMs: number,
    untilMs: number,
  ): Promise<LightningProviderResult> {
    const nowMs = this.now();
    const current = await this.storage.read(nowMs);
    const decision = evaluateLightningUsage(current, nowMs);

    if (!decision.allowed) {
      const error = new Error(
        decision.reason === 'reserve_protected'
          ? `Lightning API reserve protected (${Math.round(decision.reserveTokens)} accesses held back)`
          : 'Lightning API temporarily throttled to protect monthly usage',
      ) as Error & { retryAfterMs?: number; usageGuardReason?: string };
      error.retryAfterMs = decision.retryAfterMs;
      error.usageGuardReason = decision.reason;
      throw error;
    }

    const result = await this.inner.fetchEventsNearPoint(
      latitude,
      longitude,
      radiusKm,
      sinceMs,
      untilMs,
    );

    const updated = applyLightningUsageResponse(
      current,
      result.usage ?? {
        costTokens: null,
        periodLimit: null,
        periodRemaining: null,
        periodResetAtMs: null,
        periodType: null,
      },
      this.now(),
    );
    await this.storage.write(updated);
    return result;
  }
}
