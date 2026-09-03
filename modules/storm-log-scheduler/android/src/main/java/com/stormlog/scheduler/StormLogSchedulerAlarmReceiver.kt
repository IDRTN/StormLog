package com.stormlog.scheduler

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.app.AlarmManager
import android.app.PendingIntent
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
          putExtra("source", "alarm_manager")
        }
      )
    } catch (error: Exception) {
      android.util.Log.e("StormLogScheduler", "Alarm collection launch failed", error)
    } finally {
      // One-shot alarms are always re-armed here. Exact permission changes only
      // affect precision; they no longer switch StormLog to an in-process timer.
      StormLogSchedulerService.scheduleNextAlarm(context, intervalMinutes)
    }
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
