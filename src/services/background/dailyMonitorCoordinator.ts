import { getNextIntervalBoundary } from '../../util/dateUtils';

export type DailyCollectionMode = 'automatic' | 'manual';
export type DailyCollectionOutcome = 'completed' | 'shared' | 'skipped_recent_automatic';
export type DailyCollectionResult = { success: boolean; error?: string; outcome?: DailyCollectionOutcome };
export type DailyMonitorSnapshot = { isActive: boolean; intervalMinutes: number; loading: boolean; lastCollectionTime: number | null; lastError: string | null };

type AsyncMap = { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<void>; removeItem: (key: string) => Promise<void> };
export type DailyMonitorScheduler = { setTimeout: (callback: () => void, delayMs: number) => unknown; clearTimeout: (timerId: unknown) => void };
export type BackgroundTaskAdapter = { isRegistered: () => Promise<boolean>; register: (intervalMinutes: number) => Promise<void>; unregister: () => Promise<void> };
export type ForegroundServiceAdapter = { start: (intervalMinutes: number) => Promise<{ success: boolean; error?: string }>; stop: () => Promise<void>; isRunning: () => Promise<boolean> };
export type DailyMonitorCoordinatorDependencies = {
  runCollection: () => Promise<DailyCollectionResult>;
  storage: AsyncMap;
  scheduler: DailyMonitorScheduler;
  background: BackgroundTaskAdapter;
  foregroundService?: ForegroundServiceAdapter;
  claimAutomatic?: (attemptAtMs: number, intervalMs: number) => Promise<boolean>;
  now?: () => number;
  getNextDelayMs?: (intervalMinutes: number) => number;
};

export const LAST_AUTOMATIC_COLLECTION_KEY = 'daily_monitor_last_automatic_collection';
export const LAST_AUTOMATIC_ATTEMPT_KEY = 'daily_monitor_last_automatic_attempt';
export const DAILY_MONITOR_ENABLED_EXPORT = 'daily_monitor_enabled';
export const DAILY_MONITOR_INTERVAL_EXPORT = 'daily_monitor_interval';
export const LAST_COLLECTION_KEY_EXPORT = 'daily_monitor_last_collection';
export const LAST_ERROR_EXPORT = 'daily_monitor_last_error';
const VALID_INTERVALS = [5, 10, 15, 30, 60];

function normalizeInterval(minutes: number | null | undefined): number {
  return VALID_INTERVALS.includes(Number(minutes)) ? Number(minutes) : 15;
}

function parseTimestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * One coordinator owns all Daily Monitor collection admission.
 *
 * Android has exactly one authoritative interval clock: the native foreground
 * scheduler. Expo BackgroundFetch is retained only as a watchdog/recovery path.
 * The in-process JS timer is used only when no foreground-service adapter exists
 * (tests / unsupported runtimes). This prevents three independent clocks from
 * racing each other at the same wall-clock boundary.
 */
export class DailyMonitorCoordinator {
  private state: DailyMonitorSnapshot = {
    isActive: false,
    intervalMinutes: 15,
    loading: true,
    lastCollectionTime: null,
    lastError: null,
  };
  private listeners = new Set<(state: DailyMonitorSnapshot) => void>();
  private inFlight: Promise<DailyCollectionResult> | null = null;
  private foregroundTimer: unknown = null;
  private registrationChain: Promise<unknown> = Promise.resolve();
  private registeredInterval: number | null = null;
  private lastAutomaticAttemptMs = 0;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;
  private runtimePromise: Promise<void> | null = null;
  private runtimeReadyInterval: number | null = null;

  constructor(private readonly dependencies: DailyMonitorCoordinatorDependencies) {}

  getState(): Readonly<DailyMonitorSnapshot> {
    return this.state;
  }

  subscribe(listener: (state: DailyMonitorSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  }

  async initialize(): Promise<void> {
    await this.hydrateState();
    if (this.state.isActive) await this.ensureForegroundRuntime();
  }

  private async initializeForAutomatic(): Promise<void> {
    await this.hydrateState();
  }

  private async hydrateState(): Promise<void> {
    if (this.initialized) return;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = (async () => {
      if (this.initialized) return;
      const [enabled, storedInterval, lastCollection, lastError, lastAttemptStr] = await Promise.all([
        this.readStorage(DAILY_MONITOR_ENABLED_EXPORT),
        this.readStorage(DAILY_MONITOR_INTERVAL_EXPORT),
        this.readStorage(LAST_COLLECTION_KEY_EXPORT),
        this.readStorage(LAST_ERROR_EXPORT),
        this.readStorage(LAST_AUTOMATIC_ATTEMPT_KEY),
      ]);
      const interval = normalizeInterval(storedInterval ? Number(storedInterval) : null);
      const isRegistered = await this.safeIsBackgroundRegistered();
      this.registeredInterval = isRegistered ? interval : null;
      this.lastAutomaticAttemptMs = parseTimestamp(lastAttemptStr);
      this.patchState({
        isActive: enabled === 'true' || isRegistered,
        intervalMinutes: interval,
        lastCollectionTime: lastCollection ? Number(lastCollection) : null,
        lastError,
        loading: false,
      });
      this.initialized = true;
    })();

    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  private async ensureForegroundRuntime(): Promise<void> {
    if (!this.state.isActive) return;
    if (this.runtimePromise) return this.runtimePromise;

    const interval = this.state.intervalMinutes;
    this.runtimePromise = (async () => {
      // BackgroundFetch is a watchdog, not the interval owner.
      await this.registerBackground(interval);

      const foregroundService = this.dependencies.foregroundService;
      if (foregroundService) {
        let running = false;
        try {
          running = await foregroundService.isRunning();
        } catch {
          running = false;
        }

        // Re-entering a screen/hook must not keep restarting or re-arming the
        // native scheduler. Restart only when the service is actually absent or
        // the requested interval changed.
        if (!running || this.runtimeReadyInterval !== interval) {
          await this.startForegroundService(interval);
        }
        this.runtimeReadyInterval = interval;
        this.stopForegroundScheduler();
        return;
      }

      // Unsupported/dev fallback only. Production Android never has two clocks.
      if (this.runtimeReadyInterval !== interval || this.foregroundTimer == null) {
        this.scheduleNext();
      }
      this.runtimeReadyInterval = interval;
    })();

    try {
      await this.runtimePromise;
    } finally {
      this.runtimePromise = null;
    }
  }

  async startMonitor(intervalMinutes?: number): Promise<void> {
    await this.hydrateState();
    const interval = normalizeInterval(intervalMinutes ?? this.state.intervalMinutes);
    const alreadyActiveAtSameInterval = this.state.isActive && this.state.intervalMinutes === interval;

    await this.writeStorage(DAILY_MONITOR_ENABLED_EXPORT, 'true');
    await this.writeStorage(DAILY_MONITOR_INTERVAL_EXPORT, interval.toString());
    this.patchState({ isActive: true, intervalMinutes: interval });

    if (!alreadyActiveAtSameInterval) this.runtimeReadyInterval = null;
    await this.ensureForegroundRuntime();

    // Preserve the established Start Log behavior exactly once. Repeated calls
    // from multiple mounted screens are idempotent and cannot create duplicates.
    if (!alreadyActiveAtSameInterval) {
      const result = await this.collectManual();
      if (!result.success) {
        console.warn('[Coordinator] Initial Start Log collection failed:', result.error);
      }
    }
  }

  async stopMonitor(): Promise<void> {
    await this.hydrateState();
    await this.writeStorage(DAILY_MONITOR_ENABLED_EXPORT, 'false');
    this.patchState({ isActive: false });
    this.runtimeReadyInterval = null;
    this.stopForegroundScheduler();
    await this.unregisterBackground();
    await this.stopForegroundService();
  }

  async setIntervalMinutes(minutes: number): Promise<void> {
    await this.hydrateState();
    const interval = normalizeInterval(minutes);
    if (interval === this.state.intervalMinutes) return;

    await this.writeStorage(DAILY_MONITOR_INTERVAL_EXPORT, interval.toString());
    this.patchState({ intervalMinutes: interval });
    if (!this.state.isActive) return;

    this.runtimeReadyInterval = null;
    this.stopForegroundScheduler();
    await this.ensureForegroundRuntime();
  }

  async collectManual(): Promise<DailyCollectionResult> {
    await this.hydrateState();
    return this.runSharedCollection('manual');
  }

  private async resolveAutomaticClaim(): Promise<((attemptAtMs: number, intervalMs: number) => Promise<boolean>) | null> {
    if (this.dependencies.claimAutomatic) return this.dependencies.claimAutomatic;
    if (!this.dependencies.foregroundService) return null;
    try {
      const module = await import('./dailyMonitorClaim');
      return module.claimAutomaticCollection;
    } catch (error) {
      console.warn('[Coordinator] Atomic automatic claim module unavailable:', error);
      return null;
    }
  }

  private async commitAutomaticSuccess(completedAtMs: number): Promise<void> {
    if (!this.dependencies.foregroundService) return;
    try {
      const module = await import('./dailyMonitorClaim');
      await module.markDailyMonitorCollectionSucceeded(completedAtMs);
    } catch (error) {
      console.warn('[Coordinator] Automatic success gate commit unavailable:', error);
    }
  }

  private async releaseAutomaticLease(): Promise<void> {
    if (!this.dependencies.foregroundService) return;
    try {
      const module = await import('./dailyMonitorClaim');
      await module.releaseAutomaticCollectionLease();
    } catch (error) {
      console.warn('[Coordinator] Automatic lease release unavailable:', error);
    }
  }

  async collectAutomatic(): Promise<DailyCollectionResult> {
    await this.initializeForAutomatic();
    if (!this.state.isActive) {
      return { success: true, outcome: 'skipped_recent_automatic' };
    }
    if (this.inFlight) {
      return this.inFlight.then((result) => ({ ...result, outcome: 'shared' }));
    }

    const nowMs = this.now();
    const intervalMs = this.state.intervalMinutes * 60 * 1000;

    // This local gate reflects a successful/owned attempt only. A failure clears
    // it in recordCollectionResult, so one failed callback cannot burn 15 minutes.
    if (this.lastAutomaticAttemptMs > 0 && nowMs - this.lastAutomaticAttemptMs < intervalMs) {
      return { success: true, outcome: 'skipped_recent_automatic' };
    }

    const claim = await this.resolveAutomaticClaim();
    if (claim) {
      try {
        const claimed = await claim(nowMs, intervalMs);
        if (!claimed) {
          // Cross-process denial can mean either a recent success or a short
          // in-progress lease. Never advance the local interval gate here.
          return { success: true, outcome: 'skipped_recent_automatic' };
        }
      } catch (error) {
        console.warn('[Coordinator] Atomic automatic claim unavailable; using local gate:', error);
      }
    }

    return this.runSharedCollection('automatic', nowMs);
  }

  async registerBackground(intervalMinutes: number): Promise<void> {
    const interval = normalizeInterval(intervalMinutes);
    const operation = this.registrationChain.then(async () => {
      const isRegistered = await this.safeIsBackgroundRegistered();
      if (isRegistered && this.registeredInterval === interval) return;
      if (isRegistered) await this.dependencies.background.unregister();
      await this.dependencies.background.register(interval);
      this.registeredInterval = interval;
    });
    this.registrationChain = operation.catch(() => undefined);
    await operation;
  }

  async unregisterBackground(): Promise<void> {
    const operation = this.registrationChain.then(async () => {
      if (await this.safeIsBackgroundRegistered()) {
        await this.dependencies.background.unregister();
      }
      this.registeredInterval = null;
    });
    this.registrationChain = operation.catch(() => undefined);
    await operation;
  }

  private async safeIsBackgroundRegistered(): Promise<boolean> {
    try {
      return await this.dependencies.background.isRegistered();
    } catch {
      return false;
    }
  }

  private async startForegroundService(intervalMinutes: number): Promise<void> {
    const fs = this.dependencies.foregroundService;
    if (!fs) return;
    try {
      const result = await fs.start(intervalMinutes);
      if (!result.success) {
        this.runtimeReadyInterval = null;
        console.warn('[Coordinator] Foreground service start failed:', result.error);
      }
    } catch (err: any) {
      this.runtimeReadyInterval = null;
      console.warn('[Coordinator] Foreground service start error:', err?.message || String(err));
    }
  }

  private async stopForegroundService(): Promise<void> {
    const fs = this.dependencies.foregroundService;
    if (!fs) return;
    try {
      await fs.stop();
    } catch (err: any) {
      console.warn('[Coordinator] Foreground service stop error:', err?.message || String(err));
    }
  }

  private scheduleNext(): void {
    this.clearForegroundTimer();
    const delayMs = Math.max(1000, this.getNextDelay()(this.state.intervalMinutes) - this.now());
    this.foregroundTimer = this.dependencies.scheduler.setTimeout(() => {
      this.foregroundTimer = null;
      void this.runScheduledCollection().then(() => {
        if (this.state.isActive && !this.dependencies.foregroundService) this.scheduleNext();
      });
    }, delayMs);
  }

  private async runScheduledCollection(): Promise<void> {
    await this.collectAutomatic();
  }

  private stopForegroundScheduler(): void {
    this.clearForegroundTimer();
  }

  private clearForegroundTimer(): void {
    if (this.foregroundTimer != null) {
      this.dependencies.scheduler.clearTimeout(this.foregroundTimer);
      this.foregroundTimer = null;
    }
  }

  private runSharedCollection(mode: DailyCollectionMode, automaticAttemptAt?: number): Promise<DailyCollectionResult> {
    if (this.inFlight) {
      return this.inFlight.then((result) => ({ ...result, outcome: 'shared' }));
    }

    if (mode === 'automatic' && automaticAttemptAt != null) {
      this.lastAutomaticAttemptMs = automaticAttemptAt;
      void this.writeStorage(LAST_AUTOMATIC_ATTEMPT_KEY, automaticAttemptAt.toString());
    }

    this.inFlight = this.dependencies.runCollection().then(
      async (result) => {
        await this.recordCollectionResult(result, mode, automaticAttemptAt);
        return { ...result, outcome: result.outcome ?? 'completed' };
      },
      async (error: unknown) => {
        const result: DailyCollectionResult = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
        await this.recordCollectionResult(result, mode, automaticAttemptAt);
        return result;
      },
    ).finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  private async recordCollectionResult(
    result: DailyCollectionResult,
    mode: DailyCollectionMode,
    automaticAttemptAt?: number,
  ): Promise<void> {
    const completedAt = this.now();
    if (result.success) {
      await this.writeStorage(LAST_COLLECTION_KEY_EXPORT, completedAt.toString());
      await this.removeStorage(LAST_ERROR_EXPORT);
      if (mode === 'automatic') {
        await this.writeStorage(
          LAST_AUTOMATIC_COLLECTION_KEY,
          (automaticAttemptAt ?? completedAt).toString(),
        );
      }
      await this.commitAutomaticSuccess(completedAt);
      this.patchState({ lastCollectionTime: completedAt, lastError: null });
      return;
    }

    const error = result.error || 'Unknown collection error';
    await this.writeStorage(LAST_ERROR_EXPORT, error);

    if (mode === 'automatic') {
      this.lastAutomaticAttemptMs = 0;
      await this.removeStorage(LAST_AUTOMATIC_ATTEMPT_KEY);
      await this.releaseAutomaticLease();
    }

    this.patchState({ lastError: error });
  }

  private getNextDelayMsDefault(intervalMinutes: number): number {
    return getNextIntervalBoundary(intervalMinutes * 60 * 1000) - Date.now();
  }

  private getNextDelay() {
    return this.dependencies.getNextDelayMs
      ?? ((intervalMinutes: number) => this.getNextDelayMsDefault(intervalMinutes));
  }

  private now(): number {
    return (this.dependencies.now ?? Date.now)();
  }

  private patchState(changes: Partial<DailyMonitorSnapshot>): void {
    this.state = { ...this.state, ...changes };
    for (const listener of [...this.listeners]) listener(this.state);
  }

  private async readStorage(key: string): Promise<string | null> {
    try { return await this.dependencies.storage.getItem(key); } catch { return null; }
  }

  private async writeStorage(key: string, value: string): Promise<void> {
    try { await this.dependencies.storage.setItem(key, value); } catch {}
  }

  private async removeStorage(key: string): Promise<void> {
    try { await this.dependencies.storage.removeItem(key); } catch {}
  }
}
