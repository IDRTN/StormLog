package com.stormlog.scheduler

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.app.AlarmManager
import android.app.PendingIntent
import android.os.Build
import com.facebook.react.HeadlessJsTaskService

class StormLogSchedulerAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val intervalMinutes = context.getSharedPreferences(
      "stormlog_daily_monitor_scheduler",
      Context.MODE_PRIVATE
    ).getInt("interval_minutes", 15)

    val scheduledAt = intent?.getLongExtra("scheduledAt", System.currentTimeMillis())
      ?: System.currentTimeMillis()

    try {
      HeadlessJsTaskService.acquireWakeLockNow(context)
      context.startService(
        Intent(context, StormLogHeadlessTaskService::class.java).apply {
          putExtra("scheduledAt", scheduledAt)
          putExtra("intervalMinutes", intervalMinutes)
          putExtra("source", "exact_alarm")
        }
      )
    } catch (error: Exception) {
      android.util.Log.e("StormLogScheduler", "Exact-alarm collection launch failed", error)
    }

    StormLogSchedulerService.scheduleNextExactAlarm(context, intervalMinutes)
  }

  companion object {
    const val ACTION = "com.stormlog.scheduler.DAILY_MONITOR_ALARM"
    private const val REQUEST_CODE = 41016

    fun pendingIntent(context: Context): PendingIntent {
      return PendingIntent.getBroadcast(
        context,
        REQUEST_CODE,
        Intent(context, StormLogSchedulerAlarmReceiver::class.java).apply {
          action = ACTION
        },
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }

    fun cancel(context: Context) {
      val alarmManager = context.getSystemService(AlarmManager::class.java)
      alarmManager?.cancel(pendingIntent(context))
    }
  }
}
