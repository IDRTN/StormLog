package com.stormlog.scheduler

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Upgrades a running Handler fallback to the exact-alarm path when Android
 * grants SCHEDULE_EXACT_ALARM access from the system settings screen.
 */
class StormLogExactAlarmPermissionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    if (intent?.action != "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED") return

    val alarmManager = context.getSystemService(android.app.AlarmManager::class.java) ?: return
    if (!alarmManager.canScheduleExactAlarms()) return

    val prefs = context.getSharedPreferences(
      "stormlog_daily_monitor_scheduler",
      Context.MODE_PRIVATE
    )
    val intervalMinutes = prefs.getInt("interval_minutes", 15)

    try {
      StormLogSchedulerService.start(context, intervalMinutes)
      android.util.Log.i(
        "StormLogScheduler",
        "Exact-alarm permission granted; scheduler restarted on exact-alarm path"
      )
    } catch (error: Exception) {
      android.util.Log.e(
        "StormLogScheduler",
        "Failed to restart scheduler after exact-alarm permission change",
        error
      )
    }
  }
}
