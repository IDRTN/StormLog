const { withAndroidManifest } = require('expo/config-plugins');

const SCHEDULER_SERVICE = 'com.stormlog.scheduler.StormLogSchedulerService';
const HEADLESS_SERVICE = 'com.stormlog.scheduler.StormLogHeadlessTaskService';
const ALARM_RECEIVER = 'com.stormlog.scheduler.StormLogSchedulerAlarmReceiver';
const EXACT_ALARM_PERMISSION_RECEIVER = 'com.stormlog.scheduler.StormLogExactAlarmPermissionReceiver';

function ensureService(application, name, attributes = {}) {
  application.service = application.service || [];
  const existing = application.service.find(service => service.$?.['android:name'] === name);
  if (existing) {
    existing.$ = { ...existing.$, ...attributes };
    return;
  }
  application.service.push({
    $: {
      'android:name': name,
      ...attributes,
    },
  });
}

function ensureReceiver(application, name, attributes = {}, intentFilters = []) {
  application.receiver = application.receiver || [];
  const existing = application.receiver.find(receiver => receiver.$?.['android:name'] === name);
  const receiver = existing || { $: { 'android:name': name } };
  receiver.$ = { ...receiver.$, ...attributes };
  if (intentFilters.length > 0) {
    receiver['intent-filter'] = receiver['intent-filter'] || [];
    for (const filter of intentFilters) {
      const alreadyPresent = receiver['intent-filter'].some(existingFilter =>
        existingFilter.action?.some(action => action.$?.['android:name'] === filter.action)
      );
      if (!alreadyPresent) {
        receiver['intent-filter'].push({
          action: [{ $: { 'android:name': filter.action } }],
        });
      }
    }
  }
  if (!existing) application.receiver.push(receiver);
}

module.exports = function withStormLogScheduler(config) {
  return withAndroidManifest(config, configWithManifest => {
    const application = configWithManifest.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error('StormLog scheduler could not find the Android application manifest entry.');
    }

    ensureService(application, SCHEDULER_SERVICE, {
      'android:enabled': 'true',
      'android:exported': 'false',
      'android:foregroundServiceType': 'location',
      'android:stopWithTask': 'false',
    });

    ensureService(application, HEADLESS_SERVICE, {
      'android:enabled': 'true',
      'android:exported': 'false',
    });

    ensureReceiver(application, ALARM_RECEIVER, {
      'android:enabled': 'true',
      'android:exported': 'false',
    });

    ensureReceiver(application, EXACT_ALARM_PERMISSION_RECEIVER, {
      'android:enabled': 'true',
      'android:exported': 'false',
    }, [
      { action: 'android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED' },
    ]);

    return configWithManifest;
  });
};
