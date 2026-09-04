import { requireOptionalNativeModule } from 'expo-modules-core';

type StormLogSchedulerNativeModule = {
  start: (intervalMinutes: number) => void;
  stop: () => void;
  isRunning: () => boolean;
  hasExactAlarmPermission: () => boolean;
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
