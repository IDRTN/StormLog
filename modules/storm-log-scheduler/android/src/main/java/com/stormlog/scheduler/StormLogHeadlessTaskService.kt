package com.stormlog.scheduler

import android.content.Intent
import android.os.Bundle
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class StormLogHeadlessTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val extras: Bundle = intent?.extras ?: Bundle()
    return HeadlessJsTaskConfig(
      "StormLogDailyMonitorHeadless",
      Arguments.fromBundle(extras),
      120_000,
      true
    )
  }
}
