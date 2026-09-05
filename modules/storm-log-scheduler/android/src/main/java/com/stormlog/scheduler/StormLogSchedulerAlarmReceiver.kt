package com.stormlog.scheduler

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
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
      // Android background-service limits can reject startService() when the app
      // task/process is gone. Exact alarms are allowed to launch a foreground
      // service, so the headless worker is promoted only for the short collection
      // window and shuts down again when the JS task completes.
      HeadlessJsTaskService.acquireWakeLockNow(context)
      ContextCompat.startForegroundService(
        context,
        Intent(context, StormLogHeadlessTaskService::class.java).apply {
          putExtra("scheduledAt", scheduledAt)
          putExtra("intervalMinutes", intervalMinutes)
          putExtra("source", "alarm_manager")
        },
      )
      StormLogAlarmScheduler.recordAlarmFired(context, scheduledAt)
    } catch (error: Exception) {
      StormLogAlarmScheduler.recordLaunchFailure(context, scheduledAt, error.message ?: error.javaClass.simpleName)
      android.util.Log.e("StormLogScheduler", "Alarm collection launch failed", error)
    } finally {
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
