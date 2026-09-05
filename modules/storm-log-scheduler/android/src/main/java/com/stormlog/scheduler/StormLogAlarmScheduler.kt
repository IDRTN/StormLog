package com.stormlog.scheduler

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat

object StormLogAlarmScheduler {
  private const val PREFS = "stormlog_daily_monitor_scheduler"
  private const val INTERVAL_KEY = "interval_minutes"
  private const val ENABLED_KEY = "enabled"
  private const val NEXT_ALARM_AT_KEY = "next_alarm_at"
  private const val LAST_ALARM_FIRED_AT_KEY = "last_alarm_fired_at"
  private const val LAST_LAUNCH_FAILURE_AT_KEY = "last_launch_failure_at"
  private const val LAST_LAUNCH_FAILURE_KEY = "last_launch_failure"
  private const val DEFAULT_INTERVAL_MINUTES = 15
  private const val CHANNEL_ID = "stormlog_daily_monitor"
  private const val NOTIFICATION_ID = 41015

  fun isEnabled(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getBoolean(ENABLED_KEY, false)

  fun getStoredIntervalMinutes(context: Context): Int =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getInt(INTERVAL_KEY, DEFAULT_INTERVAL_MINUTES)
      .coerceAtLeast(1)

  fun hasExactAlarmPermission(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return false
    return alarmManager.canScheduleExactAlarms()
  }

  fun start(context: Context, intervalMinutes: Int) {
    val safeInterval = intervalMinutes.coerceAtLeast(1)
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(ENABLED_KEY, true)
      .putInt(INTERVAL_KEY, safeInterval)
      .apply()

    if (hasExactAlarmPermission(context)) {
      postStatusNotification(context, safeInterval, precise = true)
      scheduleNext(context, safeInterval)
    } else {
      cancelAlarm(context)
      postStatusNotification(context, safeInterval, precise = false)
    }
  }

  fun restore(context: Context) {
    if (!isEnabled(context)) return
    val intervalMinutes = getStoredIntervalMinutes(context)
    if (!hasExactAlarmPermission(context)) {
      cancelAlarm(context)
      postStatusNotification(context, intervalMinutes, precise = false)
      return
    }
    postStatusNotification(context, intervalMinutes, precise = true)
    scheduleNext(context, intervalMinutes)
  }

  fun stop(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(ENABLED_KEY, false)
      .remove(NEXT_ALARM_AT_KEY)
      .apply()
    cancelAlarm(context)
    context.getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION_ID)
  }

  fun scheduleNext(context: Context, intervalMinutes: Int = getStoredIntervalMinutes(context)) {
    if (!isEnabled(context)) {
      cancelAlarm(context)
      return
    }
    if (!hasExactAlarmPermission(context)) {
      cancelAlarm(context)
      postStatusNotification(context, intervalMinutes, precise = false)
      android.util.Log.w("StormLogScheduler", "Exact alarm access missing; precise Daily Monitor schedule not armed")
      return
    }

    val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return
    val safeInterval = intervalMinutes.coerceAtLeast(1)
    val intervalMs = safeInterval.toLong() * 60_000L
    val now = System.currentTimeMillis()
    val nextBoundary = ((now / intervalMs) + 1L) * intervalMs
    val pendingIntent = StormLogSchedulerAlarmReceiver.pendingIntent(context)

    alarmManager.setExactAndAllowWhileIdle(
      AlarmManager.RTC_WAKEUP,
      nextBoundary,
      pendingIntent,
    )

    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putLong(NEXT_ALARM_AT_KEY, nextBoundary)
      .apply()

    android.util.Log.i(
      "StormLogScheduler",
      "Exact alarm armed for $nextBoundary (interval=${safeInterval}m)",
    )
  }

  fun hasScheduledAlarm(context: Context): Boolean {
    if (!isEnabled(context) || !hasExactAlarmPermission(context)) return false
    val pending = PendingIntent.getBroadcast(
      context,
      StormLogSchedulerAlarmReceiver.REQUEST_CODE,
      StormLogSchedulerAlarmReceiver.intent(context),
      PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
    )
    return pending != null
  }

  fun recordAlarmFired(context: Context, firedAt: Long) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putLong(LAST_ALARM_FIRED_AT_KEY, firedAt)
      .remove(LAST_LAUNCH_FAILURE_AT_KEY)
      .remove(LAST_LAUNCH_FAILURE_KEY)
      .apply()
  }

  fun recordLaunchFailure(context: Context, failedAt: Long, message: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putLong(LAST_LAUNCH_FAILURE_AT_KEY, failedAt)
      .putString(LAST_LAUNCH_FAILURE_KEY, message)
      .apply()
  }

  private fun cancelAlarm(context: Context) {
    val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return
    alarmManager.cancel(StormLogSchedulerAlarmReceiver.pendingIntent(context))
  }

  private fun postStatusNotification(context: Context, intervalMinutes: Int, precise: Boolean) {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(
          CHANNEL_ID,
          "StormLog Daily Monitor",
          NotificationManager.IMPORTANCE_LOW,
        ).apply {
          description = "Shows that StormLog automatic field observations are enabled."
          setShowBadge(false)
        },
      )
    }

    val body = if (precise) {
      "Automatic observations enabled — every $intervalMinutes min"
    } else {
      "Exact alarm access required for reliable $intervalMinutes min observations"
    }

    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setContentTitle("StormLog Daily Monitor")
      .setContentText(body)
      .setSmallIcon(android.R.drawable.ic_menu_myplaces)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()

    manager.notify(NOTIFICATION_ID, notification)
  }
}
