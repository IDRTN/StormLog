import { requireOptionalNativeModule } from 'expo-modules-core';

export type WatchCompanionStatus = {
  connected: boolean;
  installed: boolean;
  updateAvailable: boolean;
  nodeId?: string;
  nodeName?: string;
  packageName?: string;
  versionCode?: number;
  versionName?: string;
  protocolVersion?: number;
  latestVersionCode?: number;
  latestVersionName?: string;
};

type StormLogSchedulerNativeModule = {
  start: (intervalMinutes: number) => void;
  stop: () => void;
  isRunning: () => boolean;
  hasExactAlarmPermission: () => boolean;
  getWatchCompanionStatus: () => Promise<WatchCompanionStatus>;
};

const nativeScheduler = requireOptionalNativeModule<StormLogSchedulerNativeModule>('StormLogScheduler');

export function isNativeDailyMonitorSchedulerAvailable(): boolean {
  return nativeScheduler != null;
}

export function startNativeDailyMonitorScheduler(intervalMinutes: number): boolean {
  if (!nativeScheduler) return false;
  nativeScheduler.start(intervalMinutes);
  return true;
}

export function stopNativeDailyMonitorScheduler(): boolean {
  if (!nativeScheduler) return false;
  nativeScheduler.stop();
  return true;
}

export function isNativeDailyMonitorSchedulerRunning(): boolean {
  return nativeScheduler?.isRunning() ?? false;
}

export function hasNativeDailyMonitorExactAlarmPermission(): boolean {
  return nativeScheduler?.hasExactAlarmPermission() ?? false;
}

export async function getWatchCompanionStatus(): Promise<WatchCompanionStatus> {
  if (!nativeScheduler) {
    return {
      connected: false,
      installed: false,
      updateAvailable: false,
    };
  }

  return nativeScheduler.getWatchCompanionStatus();
}
