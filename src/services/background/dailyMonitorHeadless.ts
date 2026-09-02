import { AppRegistry } from 'react-native';

export const STORMLOG_DAILY_MONITOR_HEADLESS_TASK = 'StormLogDailyMonitorHeadless';

AppRegistry.registerHeadlessTask(STORMLOG_DAILY_MONITOR_HEADLESS_TASK, () => async (taskData: unknown) => {
  console.log('[NATIVE-SCHEDULER] Headless Daily Monitor task started:', taskData);
  const { performDailyCollection } = await import('./dailyMonitor');
  const result = await performDailyCollection('automatic');
  console.log('[NATIVE-SCHEDULER] Headless Daily Monitor task finished:', result.success, result.outcome);
  return result;
});
