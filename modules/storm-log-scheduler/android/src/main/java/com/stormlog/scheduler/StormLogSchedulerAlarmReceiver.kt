package com.stormlog.scheduler

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.facebook.react.HeadlessJsTaskService

class StormLogSchedulerAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (!StormLogSchedulerService.isEnabled(context)) {
      cancel(context)
      return
    }

    val intervalMinutes = StormLogSchedulerService.getStoredIntervalMinutes(context)
    val scheduledAt = System.currentTimeMillis()

    try {
      // Repair the authoritative foreground scheduler first. If Android killed
      // the process/service between intervals, the alarm itself resurrects it.
      if (!StormLogSchedulerService.isRunning) {
        StormLogSchedulerService.start(context, intervalMinutes)
      }

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
      if (StormLogSchedulerService.isEnabled(context)) {
        StormLogSchedulerService.scheduleNextAlarm(context, intervalMinutes)
      }
    }
  }

  companion object {
    const val ACTION = "com.stormlog.scheduler.DAILY_MONITOR_ALARM"
    private const val REQUEST_CODE = 41016

    fun pendingIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
      context,
      REQUEST_CODE,
      Intent(context, StormLogSchedulerAlarmReceiver::class.java).apply { action = ACTION },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    fun cancel(context: Context) {
      val alarmManager = context.getSystemService(AlarmManager::class.java)
      alarmManager?.cancel(pendingIntent(context))
    }
  }
}
