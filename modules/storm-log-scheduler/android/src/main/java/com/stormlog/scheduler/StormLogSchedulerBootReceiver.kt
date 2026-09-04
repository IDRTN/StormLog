package com.stormlog.scheduler

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class StormLogSchedulerBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return

    if (!StormLogSchedulerService.isEnabled(context)) {
      android.util.Log.i("StormLogScheduler", "Boot/package recovery skipped because Daily Monitor is disabled")
      return
    }

    val intervalMinutes = StormLogSchedulerService.getStoredIntervalMinutes(context)
    try {
      StormLogSchedulerService.start(context, intervalMinutes)
      android.util.Log.i(
        "StormLogScheduler",
        "Daily Monitor scheduler restored after $action (interval=${intervalMinutes}m)"
      )
    } catch (error: Exception) {
      android.util.Log.e("StormLogScheduler", "Daily Monitor scheduler recovery failed after $action", error)
    }
  }
}
