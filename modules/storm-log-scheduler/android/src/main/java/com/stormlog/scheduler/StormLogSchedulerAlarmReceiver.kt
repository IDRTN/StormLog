package com.stormlog.scheduler

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.facebook.react.HeadlessJsTaskService

class StormLogSchedulerAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (!StormLogAlarmScheduler.isEnabled(context)) {
      StormLogAlarmScheduler.stop(context)
      return
    }

    val intervalMinutes = StormLogAlarmScheduler.getStoredIntervalMinutes(context)
    val scheduledAt = System.currentTimeMillis()

    try {
      HeadlessJsTaskService.acquireWakeLockNow(context)
      context.startService(
        Intent(context, StormLogHeadlessTaskService::class.java).apply {
          putExtra("scheduledAt", scheduledAt)
          putExtra("intervalMinutes", intervalMinutes)
          putExtra("source", "alarm_manager")
        },
      )
    } catch (error: Exception) {
      android.util.Log.e("StormLogScheduler", "Alarm collection launch failed", error)
    } finally {
      // Re-arm from the receiver itself. No foreground service or UI process is
      // required to remain alive between observations.
      if (StormLogAlarmScheduler.isEnabled(context)) {
        StormLogAlarmScheduler.scheduleNext(context, intervalMinutes)
      }
    }
  }

  companion object {
    const val ACTION = "com.stormlog.scheduler.DAILY_MONITOR_ALARM"
    const val REQUEST_CODE = 41016

    fun intent(context: Context): Intent =
      Intent(context, StormLogSchedulerAlarmReceiver::class.java).apply { action = ACTION }

    fun pendingIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
      context,
      REQUEST_CODE,
      intent(context),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }
}
