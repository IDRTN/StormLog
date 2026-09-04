package com.stormlog.scheduler

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class StormLogSchedulerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StormLogScheduler")

    Function("start") { intervalMinutes: Int ->
      val context = requireNotNull(appContext.reactContext)
      StormLogAlarmScheduler.start(context, intervalMinutes)

      if (!StormLogAlarmScheduler.hasExactAlarmPermission(context) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        appContext.currentActivity?.startActivity(
          Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
            data = Uri.parse("package:${context.packageName}")
          },
        )
      }
    }

    Function("stop") {
      StormLogAlarmScheduler.stop(requireNotNull(appContext.reactContext))
    }

    Function("isRunning") {
      val context = requireNotNull(appContext.reactContext)
      StormLogAlarmScheduler.hasScheduledAlarm(context)
    }

    Function("hasExactAlarmPermission") {
      StormLogAlarmScheduler.hasExactAlarmPermission(requireNotNull(appContext.reactContext))
    }
  }
}
