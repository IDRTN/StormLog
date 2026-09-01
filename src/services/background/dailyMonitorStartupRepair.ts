import {
  initializeDailyMonitorCoordinator,
  getMonitorStatus,
  startDailyMonitor,
  stopDailyMonitor,
} from './dailyMonitor';

/**
 * Repairs a persisted Daily Monitor after a fresh foreground app startup.
 *
 * Android/Expo can preserve a foreground-location task across an APK update
 * while its native foreground-service consumer is left half-initialized. The
 * task can therefore report as registered/running while no location callbacks
 * arrive. Restarting the location task while the app is foregrounded is the
 * documented practical recovery for this class of expo-location failure.
 *
 * This is deliberately a startup-only repair. Background/headless execution
 * must never stop/start the foreground service itself.
 */
export async function repairDailyMonitorAfterStartup(): Promise<void> {
  await initializeDailyMonitorCoordinator();

  const status = await getMonitorStatus();
  if (!status.isActive) return;

  console.log('[DAILY-MONITOR] Repairing persisted foreground runtime after app startup');
  await stopDailyMonitor();
  await startDailyMonitor(15);
  console.log('[DAILY-MONITOR] Startup foreground runtime repair complete');
}
