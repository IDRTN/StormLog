import { haversineDistance } from '../analysis/windVector';

// ============================================================
// Lightning Coordinator — Single authoritative owner of
// lightning collection and ingestion logic.
//
// Phase 2: Coordinator only.
// No provider implementation, no timers, no UI, no integration.
// ============================================================

// ---- Provider contract (imported from adapter boundary) ----

import type {
  LightningProviderAdapter,
  LightningProviderEvent,
  LightningProviderResult,
} from './lightningProviderAdapter';

// Re-export for consumers that import from this module
export type { LightningProviderAdapter, LightningProviderEvent };

// ---- Database operations (injected from Phase 1 lightningEvents) ----

export type LightningDatabaseOps = {
  insertLightningEvents: (
    events: Array<Record<string, unknown>>,
  ) => Promise<number>;
};

// ---- Coordinator dependencies ----

export type LightningCoordinatorDependencies = {
  adapter: LightningProviderAdapter | null;
  database: LightningDatabaseOps;
  now?: () => number;
  haversine?: (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ) => number;
};

// ---- Collection context ----

export type LightningCollectionContext = {
  location: {
    latitude: number;
    longitude: number;
  };
  stormEventId: number | null;
  reason: 'foreground' | 'background' | 'manual';
  sinceMs?: number;
  untilMs?: number;
};

// ---- Collection result ----

export type LightningCollectionResult = {
  success: boolean;
  providerEventCount: number;
  insertedCount: number;
  skippedCount: number;
  collectionTimestampMs: number;
  querySinceMs: number;
  queryUntilMs: number;
  error?: string;
  backoffUntilMs: number;
};

// ---- Coordinator snapshot ----

export type LightningCoordinatorSnapshot = {
  inFlight: boolean;
  lastSuccessfulCollectionMs: number | null;
  lastAttemptMs: number | null;
  lastResult: LightningCollectionResult | null;
  backoffUntilMs: number;
};

// ---- Defaults ----

const DEFAULT_RADIUS_KM = 50;
const DEFAULT_OVERLAP_MS = 3 * 60 * 1000; // 3 minutes
const DEFAULT_INITIAL_LOOKBACK_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_AUTOMATIC_GATE_MS = 60 * 1000; // 1 minute
const DEFAULT_BACKOFF_MS = 60 * 1000; // 60 seconds
const MAX_EVENT_LATITUDE = 90;
const MAX_EVENT_LONGITUDE = 180;

export class LightningCoordinator {
  private state: LightningCoordinatorSnapshot = {
    inFlight: false,
    lastSuccessfulCollectionMs: null,
    lastAttemptMs: null,
    lastResult: null,
    backoffUntilMs: 0,
  };

  private listeners = new Set<
    (state: LightningCoordinatorSnapshot) => void
  >();

  private inFlightPromise: Promise<LightningCollectionResult> | null = null;

  private lastAutomaticAttemptMs = 0;

  private readonly overlapMs: number;
  private readonly initialLookbackMs: number;
  private readonly automaticGateMs: number;
  private readonly radiusKm: number;
  private readonly optionsNow: (() => number) | undefined;

  constructor(
    private readonly dependencies: LightningCoordinatorDependencies,
    options?: {
      overlapMs?: number;
      initialLookbackMs?: number;
      automaticGateMs?: number;
      radiusKm?: number;
      now?: () => number;
    },
  ) {
    this.overlapMs = options?.overlapMs ?? DEFAULT_OVERLAP_MS;
    this.initialLookbackMs =
      options?.initialLookbackMs ?? DEFAULT_INITIAL_LOOKBACK_MS;
    this.automaticGateMs =
      options?.automaticGateMs ?? DEFAULT_AUTOMATIC_GATE_MS;
    this.radiusKm = options?.radiusKm ?? DEFAULT_RADIUS_KM;
    this.optionsNow = options?.now;
  }

  // ---- Public API ----

  getState(): Readonly<LightningCoordinatorSnapshot> {
    return this.state;
  }

  subscribe(
    listener: (state: LightningCoordinatorSnapshot) => void,
  ): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  collectAutomatic(
    context: Omit<LightningCollectionContext, 'reason'>,
  ): Promise<LightningCollectionResult> {
    return this.collectLightning({
      ...context,
      reason: 'foreground',
    });
  }

  collectManual(
    context: Omit<LightningCollectionContext, 'reason'>,
  ): Promise<LightningCollectionResult> {
    return this.collectLightning({
      ...context,
      reason: 'manual',
    });
  }

  async collectLightning(
    context: LightningCollectionContext,
  ): Promise<LightningCollectionResult> {
    // 1. In-flight guard
    if (this.inFlightPromise) {
      return this.inFlightPromise;
    }

    // 2. Automatic gate (manual bypasses)
    if (
      context.reason !== 'manual' &&
      !this.automaticGateAllows()
    ) {
      const now = this.now();
      return this.makeResult({
        success: true,
        providerEventCount: 0,
        insertedCount: 0,
        skippedCount: 0,
        collectionTimestampMs: now,
        querySinceMs: now,
        queryUntilMs: now,
      });
    }

    // 3. Provider availability
    if (!this.dependencies.adapter) {
      return this.makeResult({
        success: false,
        providerEventCount: 0,
        insertedCount: 0,
        skippedCount: 0,
        collectionTimestampMs: this.now(),
        querySinceMs: this.now(),
        queryUntilMs: this.now(),
        error: 'No lightning provider adapter configured',
      });
    }

    // 4. Backoff check for automatic calls
    const now = this.now();
    if (
      context.reason !== 'manual' &&
      now < this.state.backoffUntilMs
    ) {
      return this.makeResult({
        success: true,
        providerEventCount: 0,
        insertedCount: 0,
        skippedCount: 0,
        collectionTimestampMs: now,
        querySinceMs: now,
        queryUntilMs: now,
        backoffUntilMs: this.state.backoffUntilMs,
      });
    }

    // 5. Calculate query window
    const { sinceMs, untilMs } = this.calculateWindow(context);

    // 6. Set in-flight state
    this.patchState({ inFlight: true });
    this.lastAutomaticAttemptMs = now;

    this.inFlightPromise = this.executeCollection(
      context,
      sinceMs,
      untilMs,
    )
      .then((result) => {
        this.patchState({
          inFlight: false,
          lastResult: result,
          lastAttemptMs: now,
        });
        if (result.success) {
          this.patchState({
            lastSuccessfulCollectionMs: result.collectionTimestampMs,
          });
          if (result.backoffUntilMs <= now) {
            this.patchState({ backoffUntilMs: 0 });
          }
        }
        if (result.error && result.backoffUntilMs > now) {
          this.patchState({ backoffUntilMs: result.backoffUntilMs });
        }
        return result;
      })
      .catch((error: unknown) => {
        const result: LightningCollectionResult = {
          success: false,
          providerEventCount: 0,
          insertedCount: 0,
          skippedCount: 0,
          collectionTimestampMs: this.now(),
          querySinceMs: sinceMs,
          queryUntilMs: untilMs,
          error: error instanceof Error ? error.message : String(error),
          backoffUntilMs: 0,
        };
        this.patchState({
          inFlight: false,
          lastResult: result,
          lastAttemptMs: now,
        });
        return result;
      })
      .finally(() => {
        this.inFlightPromise = null;
      });

    return this.inFlightPromise;
  }

  /** Reset coordinator state. For testing only. */
  resetState(): void {
    this.state = {
      inFlight: false,
      lastSuccessfulCollectionMs: null,
      lastAttemptMs: null,
      lastResult: null,
      backoffUntilMs: 0,
    };
    this.lastAutomaticAttemptMs = 0;
    this.inFlightPromise = null;
  }

  // ---- Internal ----

  private async executeCollection(
    context: LightningCollectionContext,
    sinceMs: number,
    untilMs: number,
  ): Promise<LightningCollectionResult> {
    const adapter = this.dependencies.adapter!;
    const collectionTimestampMs = this.now();

    let providerResult: LightningProviderResult;
    try {
      providerResult = await adapter.fetchEventsNearPoint(
        context.location.latitude,
        context.location.longitude,
        this.radiusKm,
        sinceMs,
        untilMs,
      );
    } catch (error: unknown) {
      const backoffMs = this.extractBackoffMs(error);
      const backoffUntilMs =
        backoffMs > 0 ? collectionTimestampMs + backoffMs : 0;
      return {
        success: false,
        providerEventCount: 0,
        insertedCount: 0,
        skippedCount: 0,
        collectionTimestampMs,
        querySinceMs: sinceMs,
        queryUntilMs: untilMs,
        error: error instanceof Error ? error.message : String(error),
        backoffUntilMs,
      };
    }

    // Normalize and validate events
    const dbEvents: Array<Record<string, unknown>> = [];
    for (const event of providerResult.events) {
      if (!this.isValidEvent(event)) continue;
      dbEvents.push(this.normalizeEvent(event, context));
    }

    // Insert via database
    let insertedCount = 0;
    if (dbEvents.length > 0) {
      try {
        insertedCount =
          await this.dependencies.database.insertLightningEvents(
            dbEvents,
          );
      } catch (error: unknown) {
        return {
          success: false,
          providerEventCount: providerResult.events.length,
          insertedCount: 0,
          skippedCount: providerResult.events.length,
          collectionTimestampMs,
          querySinceMs: sinceMs,
          queryUntilMs: untilMs,
          error:
            'Database insertion failed: ' +
            (error instanceof Error ? error.message : String(error)),
          backoffUntilMs: 0,
        };
      }
    }

    return {
      success: true,
      providerEventCount: providerResult.events.length,
      insertedCount,
      skippedCount: providerResult.events.length - insertedCount,
      collectionTimestampMs,
      querySinceMs: sinceMs,
      queryUntilMs: untilMs,
      backoffUntilMs: 0,
    };
  }

  private calculateWindow(context: LightningCollectionContext): {
    sinceMs: number;
    untilMs: number;
  } {
    const now = this.now();
    const untilMs = context.untilMs != null
      ? Math.min(context.untilMs, now)
      : now;

    if (context.sinceMs != null) {
      return { sinceMs: context.sinceMs, untilMs };
    }

    const lastSuccess = this.state.lastSuccessfulCollectionMs;
    if (lastSuccess != null) {
      return {
        sinceMs: lastSuccess - this.overlapMs,
        untilMs,
      };
    }

    return {
      sinceMs: now - this.initialLookbackMs,
      untilMs,
    };
  }

  private automaticGateAllows(): boolean {
    const now = this.now();
    return now - this.lastAutomaticAttemptMs >= this.automaticGateMs;
  }

  private isValidEvent(event: LightningProviderEvent): boolean {
    if (event.timestamp <= 0) return false;
    if (
      !Number.isFinite(event.latitude) ||
      !Number.isFinite(event.longitude)
    )
      return false;
    if (
      Math.abs(event.latitude) > MAX_EVENT_LATITUDE ||
      Math.abs(event.longitude) > MAX_EVENT_LONGITUDE
    )
      return false;
    return true;
  }

  private normalizeEvent(
    event: LightningProviderEvent,
    context: LightningCollectionContext,
  ): Record<string, unknown> {
    const distance = this.haversine(
      context.location.latitude,
      context.location.longitude,
      event.latitude,
      event.longitude,
    );

    return {
      stormEventId: context.stormEventId,
      providerName: 'lightning_provider',
      providerEventId: event.providerEventId,
      timestamp: event.timestamp,
      eventLatitude: event.latitude,
      eventLongitude: event.longitude,
      providerTerminology: event.providerTerminology,
      classification: event.classification,
      polarity: event.polarity,
      peakCurrentAmperes: event.peakCurrentAmperes,
      multiplicity: event.multiplicity,
      sensorCount: event.sensorCount,
      accuracyKm: event.accuracyKm,
      distanceToObserverKm: distance,
      observerLatitude: context.location.latitude,
      observerLongitude: context.location.longitude,
      ingestedAt: this.now(),
      rawProviderPayload:
        typeof event.rawPayload === 'string'
          ? event.rawPayload
          : event.rawPayload != null
            ? JSON.stringify(event.rawPayload)
            : null,
    };
  }

  private haversine(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const fn = this.dependencies.haversine ?? haversineDistance;
    return fn(lat1, lon1, lat2, lon2);
  }

  private extractBackoffMs(error: unknown): number {
    if (
      error != null &&
      typeof error === 'object' &&
      'retryAfterMs' in error
    ) {
      const val = (error as { retryAfterMs: unknown }).retryAfterMs;
      if (typeof val === 'number' && val > 0) return val;
    }
    if (
      error != null &&
      typeof error === 'object' &&
      'status' in error
    ) {
      if ((error as { status: unknown }).status === 429) {
        return DEFAULT_BACKOFF_MS;
      }
    }
    return 0;
  }

  private makeResult(
    overrides: Partial<LightningCollectionResult>,
  ): LightningCollectionResult {
    return {
      success: false,
      providerEventCount: 0,
      insertedCount: 0,
      skippedCount: 0,
      collectionTimestampMs: this.now(),
      querySinceMs: this.now(),
      queryUntilMs: this.now(),
      backoffUntilMs: 0,
      ...overrides,
    };
  }

  private now(): number {
    return (this.optionsNow ?? this.dependencies.now ?? Date.now)();
  }

  private patchState(
    changes: Partial<LightningCoordinatorSnapshot>,
  ): void {
    this.state = { ...this.state, ...changes };
    for (const listener of [...this.listeners]) {
      listener(this.state);
    }
  }
}
