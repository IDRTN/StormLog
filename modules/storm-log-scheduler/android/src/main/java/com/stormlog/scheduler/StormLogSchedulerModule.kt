package com.stormlog.scheduler

import android.app.AlarmManager
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
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val alarmManager = context.getSystemService(AlarmManager::class.java)
        if (alarmManager != null && !alarmManager.canScheduleExactAlarms()) {
          appContext.currentActivity?.startActivity(
            Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
              data = Uri.parse("package:${context.packageName}")
            }
          )
        }
      }
      StormLogSchedulerService.start(context, intervalMinutes)
    }

    Function("stop") {
      StormLogSchedulerService.stop(requireNotNull(appContext.reactContext))
    }

    Function("isRunning") {
      StormLogSchedulerService.isRunning
    }
  }
}
