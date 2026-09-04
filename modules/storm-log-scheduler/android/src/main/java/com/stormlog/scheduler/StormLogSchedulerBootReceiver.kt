package com.stormlog.scheduler

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class StormLogSchedulerBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return

    if (!StormLogAlarmScheduler.isEnabled(context)) {
      android.util.Log.i("StormLogScheduler", "Recovery skipped because Daily Monitor is disabled")
      return
    }

    try {
      StormLogAlarmScheduler.restore(context)
      android.util.Log.i("StormLogScheduler", "Daily Monitor alarm restored after $action")
    } catch (error: Exception) {
      android.util.Log.e("StormLogScheduler", "Daily Monitor alarm recovery failed after $action", error)
    }
  }
}
