import { getNextIntervalBoundary } from '../../util/dateUtils';

export type DailyCollectionMode = 'automatic' | 'manual';

export type DailyCollectionOutcome =
  | 'completed'
  | 'shared'
  | 'skipped_recent_automatic'
  | 'skipped_inactive';

export type DailyCollectionResult = {
  success: boolean;
  error?: string;
  outcome?: DailyCollectionOutcome;
};

export type DailyMonitorSnapshot = {
  isActive: boolean;
  intervalMinutes: number;
  loading: boolean;
  lastCollectionTime: number | null;
  lastError: string | null;
};

type AsyncMap = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export type DailyMonitorScheduler = {
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (timerId: unknown) => void;
};

export type BackgroundTaskAdapter = {
  isRegistered: () => Promise<boolean>;
  register: (intervalMinutes: number) => Promise<void>;
  unregister: () => Promise<void>;
};

export type ForegroundServiceAdapter = {
  start: (intervalMinutes: number) => Promise<{ success: boolean; error?: string }>;
  stop: () => Promise<void>;
  isRunning: () => Promise<boolean>;
};

export type DailyMonitorCoordinatorDependencies = {
  runCollection: () => Promise<DailyCollectionResult>;
  storage: AsyncMap;
  scheduler: DailyMonitorScheduler;
  background: BackgroundTaskAdapter;
  foregroundService?: ForegroundServiceAdapter;
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
const AUTOMATIC_RETRY_COOLDOWN_MS = 60_000;

function normalizeInterval(minutes: number | null | undefined): number {
  return VALID_INTERVALS.includes(Number(minutes)) ? Number(minutes) : 15;
}

function parseTimestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

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
  private lastAutomaticCollectionMs = 0;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;

  constructor(private readonly dependencies: DailyMonitorCoordinatorDependencies) {}

  getState(): Readonly<DailyMonitorSnapshot> {
    return this.state;
  }

  subscribe(listener: (state: DailyMonitorSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = this.initializeInternal();
    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  private async initializeInternal(): Promise<void> {
    if (this.initialized) return;

    const [
      enabled,
      storedInterval,
      lastCollection,
      lastError,
      lastAttemptStr,
      lastAutomaticCollectionStr,
    ] = await Promise.all([
      this.readStorage(DAILY_MONITOR_ENABLED_EXPORT),
      this.readStorage(DAILY_MONITOR_INTERVAL_EXPORT),
      this.readStorage(LAST_COLLECTION_KEY_EXPORT),
      this.readStorage(LAST_ERROR_EXPORT),
      this.readStorage(LAST_AUTOMATIC_ATTEMPT_KEY),
      this.readStorage(LAST_AUTOMATIC_COLLECTION_KEY),
    ]);

    const interval = normalizeInterval(storedInterval ? Number(storedInterval) : null);
    const isRegistered = await this.dependencies.background.isRegistered();
    const isActive = enabled === 'true' || isRegistered;

    this.lastAutomaticAttemptMs = parseTimestamp(lastAttemptStr);
    this.lastAutomaticCollectionMs = parseTimestamp(lastAutomaticCollectionStr);

    this.patchState({
      isActive,
      intervalMinutes: interval,
      lastCollectionTime: lastCollection ? Number(lastCollection) : null,
      lastError,
      loading: false,
    });

    // Mark initialized only after persistent state has been hydrated. This is
    // important for Android headless/background execution, where a brand-new
    // JS process may call collectAutomatic() before the UI ever mounts.
    this.initialized = true;

    if (isActive) {
      this.scheduleNext();
      await this.registerBackground(interval);
      await this.startForegroundService(interval);
    }
  }

  async startMonitor(intervalMinutes?: number): Promise<void> {
    await this.initialize();
    const interval = normalizeInterval(intervalMinutes ?? this.state.intervalMinutes);
    await this.writeStorage(DAILY_MONITOR_ENABLED_EXPORT, 'true');
    await this.writeStorage(DAILY_MONITOR_INTERVAL_EXPORT, interval.toString());
    this.patchState({ isActive: true, intervalMinutes: interval });

    this.scheduleNext();
    await this.registerBackground(interval);
    await this.startForegroundService(interval);
  }

  async stopMonitor(): Promise<void> {
    await this.initialize();
    await this.writeStorage(DAILY_MONITOR_ENABLED_EXPORT, 'false');
    this.patchState({ isActive: false });
    this.stopForegroundScheduler();
    await this.unregisterBackground();
    await this.stopForegroundService();
  }

  async setIntervalMinutes(minutes: number): Promise<void> {
    await this.initialize();
    const interval = normalizeInterval(minutes);
    await this.writeStorage(DAILY_MONITOR_INTERVAL_EXPORT, interval.toString());
    this.patchState({ intervalMinutes: interval });

    if (!this.state.isActive) return;
    this.stopForegroundScheduler();
    this.scheduleNext();
    await this.registerBackground(interval);
    await this.startForegroundService(interval);
  }

  async collectManual(): Promise<DailyCollectionResult> {
    await this.initialize();
    return this.runSharedCollection('manual');
  }

  async collectAutomatic(): Promise<DailyCollectionResult> {
    // Android can invoke either task in a brand-new headless JS process.
    // Hydrate persistent monitor state before applying the automatic gate.
    await this.initialize();

    // A stale Android callback must never restart collection after the user has
    // explicitly disabled the monitor. Registration state alone is not enough
    // to establish that the feature is currently enabled.
    if (!this.state.isActive) {
      return { success: true, outcome: 'skipped_inactive' };
    }

    if (this.inFlight) {
      return this.inFlight.then((result) => ({
        ...result,
        outcome: 'shared',
      }));
    }

    const nowMs = this.now();
    const intervalMs = this.state.intervalMinutes * 60 * 1000;

    // Successful automatic collections define the cadence. Manual "Collect
    // Now" operations deliberately do not move this clock, so field tests of
    // the automatic interval remain trustworthy.
    if (
      this.lastAutomaticCollectionMs > 0 &&
      nowMs - this.lastAutomaticCollectionMs < intervalMs
    ) {
      return { success: true, outcome: 'skipped_recent_automatic' };
    }

    // If the last attempt failed, allow a short recovery retry rather than
    // suppressing automatic monitoring for the entire interval.
    if (
      this.lastAutomaticAttemptMs > 0 &&
      nowMs - this.lastAutomaticAttemptMs < AUTOMATIC_RETRY_COOLDOWN_MS
    ) {
      return { success: true, outcome: 'skipped_recent_automatic' };
    }

    return this.runSharedCollection('automatic', nowMs);
  }

  async registerBackground(intervalMinutes: number): Promise<void> {
    const interval = normalizeInterval(intervalMinutes);
    const operation = this.registrationChain.then(async () => {
      const isRegistered = await this.dependencies.background.isRegistered();
      if (isRegistered && this.registeredInterval === interval) return;

      if (isRegistered) {
        await this.dependencies.background.unregister();
      }
      await this.dependencies.background.register(interval);
      this.registeredInterval = interval;
    });

    this.registrationChain = operation.catch(() => undefined);
    await operation;
  }

  async unregisterBackground(): Promise<void> {
    const operation = this.registrationChain.then(async () => {
      if (await this.dependencies.background.isRegistered()) {
        await this.dependencies.background.unregister();
      }
      this.registeredInterval = null;
    });

    this.registrationChain = operation.catch(() => undefined);
    await operation;
  }

  private async startForegroundService(intervalMinutes: number): Promise<void> {
    const fs = this.dependencies.foregroundService;
    if (!fs) return;
    try {
      // Do not restart an already-running Android foreground service during
      // headless initialization. Repeated stop/start cycles can interrupt the
      // location task and are especially harmful when Android recreates JS.
      if (await fs.isRunning()) return;

      const result = await fs.start(intervalMinutes);
      if (!result.success) {
        console.warn('[Coordinator] Foreground service start failed:', result.error);
      }
    } catch (err: any) {
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

    const intervalMs = this.state.intervalMinutes * 60 * 1000;
    // Only automatic collections establish the automatic cadence. A manual
    // collection may update lastCollectionTime for the UI, but must not delay
    // the next scheduled automatic observation.
    const lastAutomaticAt = this.lastAutomaticCollectionMs;
    const delayMs = lastAutomaticAt > 0
      ? Math.max(1000, intervalMs - (this.now() - lastAutomaticAt))
      : Math.max(1000, this.getNextDelay()(this.state.intervalMinutes) - this.now());

    this.foregroundTimer = this.dependencies.scheduler.setTimeout(() => {
      this.foregroundTimer = null;
      void this.runScheduledCollection().then(() => {
        if (this.state.isActive) this.scheduleNext();
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

  private runSharedCollection(
    mode: DailyCollectionMode,
    automaticAttemptAt?: number,
  ): Promise<DailyCollectionResult> {
    if (this.inFlight) {
      return this.inFlight.then((result) => ({
        ...result,
        outcome: 'shared',
      }));
    }

    if (mode === 'automatic' && automaticAttemptAt != null) {
      this.lastAutomaticAttemptMs = automaticAttemptAt;
      void this.writeStorage(LAST_AUTOMATIC_ATTEMPT_KEY, automaticAttemptAt.toString());
    }

    this.inFlight = this.dependencies
      .runCollection()
      .then(
        async (result) => {
          await this.recordCollectionResult(result, mode, automaticAttemptAt);
          return {
            ...result,
            outcome: result.outcome ?? 'completed',
          };
        },
        async (error: unknown) => {
          const result: DailyCollectionResult = {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
          await this.recordCollectionResult(result, mode, automaticAttemptAt);
          return result;
        },
      )
      .finally(() => {
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
        // Cadence is anchored to the completed collection, not the moment the
        // OS woke the task. This prevents long GPS/API calls from shortening
        // the next interval unexpectedly.
        this.lastAutomaticCollectionMs = completedAt;
        await this.writeStorage(
          LAST_AUTOMATIC_COLLECTION_KEY,
          completedAt.toString(),
        );
      }
      this.patchState({ lastCollectionTime: completedAt, lastError: null });
      return;
    }

    const error = result.error || 'Unknown collection error';
    await this.writeStorage(LAST_ERROR_EXPORT, error);
    this.patchState({ lastError: error });
  }

  private getNextDelayMsDefault(intervalMinutes: number): number {
    return getNextIntervalBoundary(intervalMinutes * 60 * 1000) - Date.now();
  }

  private getNextDelay() {
    return (
      this.dependencies.getNextDelayMs ??
      ((intervalMinutes: number) => this.getNextDelayMsDefault(intervalMinutes))
    );
  }

  private now(): number {
    return (this.dependencies.now ?? Date.now)();
  }

  private patchState(changes: Partial<DailyMonitorSnapshot>): void {
    this.state = { ...this.state, ...changes };
    for (const listener of [...this.listeners]) {
      listener(this.state);
    }
  }

  private async readStorage(key: string): Promise<string | null> {
    try {
      return await this.dependencies.storage.getItem(key);
    } catch {
      return null;
    }
  }

  private async writeStorage(key: string, value: string): Promise<void> {
    try {
      await this.dependencies.storage.setItem(key, value);
    } catch {}
  }

  private async removeStorage(key: string): Promise<void> {
    try {
      await this.dependencies.storage.removeItem(key);
    } catch {}
  }
}
