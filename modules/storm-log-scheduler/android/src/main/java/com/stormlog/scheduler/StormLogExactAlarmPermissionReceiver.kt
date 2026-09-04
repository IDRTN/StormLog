package com.stormlog.scheduler

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

class StormLogExactAlarmPermissionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    if (intent?.action != "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED") return
    if (!StormLogAlarmScheduler.isEnabled(context)) return
    if (!StormLogAlarmScheduler.hasExactAlarmPermission(context)) return

    try {
      StormLogAlarmScheduler.restore(context)
      android.util.Log.i("StormLogScheduler", "Exact-alarm permission granted; precise schedule re-armed")
    } catch (error: Exception) {
      android.util.Log.e("StormLogScheduler", "Failed to re-arm exact Daily Monitor alarm", error)
    }
  }
}
